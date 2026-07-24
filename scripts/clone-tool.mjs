#!/usr/bin/env node
/**
 * clone-tool.mjs — CLONAGE d'UI CLIENT par EXCISION du calcul (ADR 0015).
 *
 * Objectif : produire, a partir du HTML d'outil client GELE (reference sha256
 * epinglee au registre), un CLONE dont l'INTERFACE est reprise a l'identique mais
 * dont les FONCTIONS DE CALCUL (science confidentielle, DoD §8) sont SUPPRIMEES.
 * Le calcul part alors de l'iframe vers le serveur via un bridge postMessage
 * (protocole v1, ADR 0015 §Protocole). L'hote React est construit a part
 * (apps/web/src/lib/tool-bridge/*, logiciels/<tool>/page.tsx).
 *
 * PROPRIETES :
 *  - DETERMINISTE / rejouable : on lit la reference gelee (sha256 verifie, echec
 *    dur si mismatch) ; aucune horloge, aucun hasard ; sortie byte-stable
 *    (l'en-tete porte le sha256, PAS une date).
 *  - EXCISION ROBUSTE : suppression des declarations top-level PAR NOM via un
 *    parser a comptage d'accolades qui IGNORE chaines et commentaires (pas de
 *    regex naive). Echec dur si une declaration listee est introuvable.
 *  - CONFIDENTIALITE (DoD §8) : le clone ne doit contenir AUCUN symbole moteur ;
 *    verifie mecaniquement par scripts/audit-excision.mjs (liste partagee ici).
 *
 * NOTE d'ARBITRAGE (rapporte au titulaire) — la liste ADR §Excision est un POINT
 * DE DEPART ; elle etait INSUFFISANTE pour le §8 (elle laissait dans le clone des
 * fonctions science appelees par computeAll : kpCurve, iDelta, geomCase,
 * soilBlend, harmMean, lambdas, bouss*, tassement*, raideur*, ainsi que les tables
 * de calibration KP/KC/LAMB/CF_GIROUD). On EXCISE donc le jeu COMPLET des symboles
 * science (fail-closed « dans le doute, on excise »). Les renderers de DETAIL
 * pas-a-pas (caseSteps/refCapSteps) affichent des intermediaires confidentiels
 * (qce/ple/kp/De/Nq/Nc/Ng/coefficients de courbe) NON couverts par la whitelist et
 * NON declasses par une decision « details-transparents » propre a terzaghi (a la
 * difference de burmister) : ils sont donc EXCISES + remplaces par un renvoi vers
 * le PV scelle (fail-closed). Les verdicts, la synthese, la coupe et les
 * hypotheses (rejeu du state) restent FIDELES.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..'); // scripts/ -> 05-Plateforme

// ---------------------------------------------------------------------------
// Parser robuste : chaines (', ", `) + commentaires (// et /* */) ignores.
// ---------------------------------------------------------------------------

/** Si src[i] ouvre une chaine ou un commentaire, renvoie l'index APRES sa fin ;
 * sinon -1. Gere l'echappement `\` dans les chaines. */
function skipStringOrComment(src, i) {
  const c = src[i];
  if (c === '/' && src[i + 1] === '/') {
    let j = i + 2;
    while (j < src.length && src[j] !== '\n') j++;
    return j;
  }
  if (c === '/' && src[i + 1] === '*') {
    let j = i + 2;
    while (j < src.length && !(src[j] === '*' && src[j + 1] === '/')) j++;
    return Math.min(j + 2, src.length);
  }
  if (c === '"' || c === "'" || c === '`') {
    let j = i + 1;
    while (j < src.length) {
      if (src[j] === '\\') {
        j += 2;
        continue;
      }
      if (src[j] === c) return j + 1;
      j++;
    }
    return src.length;
  }
  return -1;
}

/** A partir de l'index d'un ouvrant `{`/`[`/`(`, renvoie l'index APRES le
 * fermant correspondant, en ne comptant QUE la paire de ce type et en sautant
 * chaines/commentaires. */
function scanBalanced(src, openIdx) {
  const open = src[openIdx];
  const close = open === '{' ? '}' : open === '[' ? ']' : ')';
  let depth = 0;
  let i = openIdx;
  while (i < src.length) {
    const sc = skipStringOrComment(src, i);
    if (sc >= 0) {
      i = sc;
      continue;
    }
    const c = src[i];
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return i + 1;
    }
    i++;
  }
  throw new Error(`Accolade « ${open} » non equilibree depuis l'index ${openIdx}.`);
}

/**
 * Remplace le CONTENU des chaines et commentaires par des espaces (longueur
 * preservee), en gardant le CODE intact. Sert a l'audit : on ne cherche un
 * symbole moteur QUE dans le code executable, jamais dans de la prose (labels,
 * commentaires) — un nom moteur en prose n'est pas du code moteur fuite.
 */
export function stripCommentsAndStrings(code) {
  let out = '';
  let i = 0;
  while (i < code.length) {
    const sc = skipStringOrComment(code, i);
    if (sc >= 0) {
      // Preserve les sauts de ligne (numeros de ligne stables), espace le reste.
      for (let k = i; k < sc; k++) out += code[k] === '\n' ? '\n' : ' ';
      i = sc;
      continue;
    }
    out += code[i];
    i++;
  }
  return out;
}

/**
 * Predicat PARTAGE (generateur <-> audit) : un COMMENTAIRE mentionne-t-il un symbole
 * MOTEUR excise ? Renvoie le symbole capture, sinon null. On raisonne par TOKENS
 * identifiants du commentaire (pas de substring naif) et on ne cible que les noms qui
 * TRAHISSENT REELLEMENT la methode :
 *  - le token doit etre un IDENTIFIANT DISTINCTIF (camelCase, chiffre, `_`/`$`) : on ne
 *    scrute PAS les mots tout-en-minuscules (« tassement », « raideurs », « lambdas ») qui
 *    sont des mots du domaine (la GRANDEUR physique, affichee dans l'UI) et non le CODE
 *    confidentiel — sinon on effacerait de la prose legitime ;
 *  - egalite exacte token===symbole pour les symboles >= 6 car. (doCalc, krLCPC,
 *    burIntegrateMLWithPSC) ; les symboles courts (J0, J1, _P, inv4) sont trop generiques
 *    en prose et restent couverts par l'audit de CODE ;
 *  - PREFIXE : un token distinctif >= 6 car. prefixe d'un symbole >= 8 car. (capture
 *    l'ABREVIATION « burIntegrateML » du propagateur « burIntegrateMLWithPSC »).
 * Cible UNIQUEMENT les commentaires : jamais le code (l'audit de code reste l'arbitre du §8).
 */
function isDistinctiveIdent(t) {
  // Tout ce qui n'est pas purement des minuscules a-z : majuscule (camelCase/sigle),
  // chiffre, `_` ou `$` -> ressemble a un identifiant de code, pas a un mot du domaine.
  return /[^a-z]/.test(t);
}
export function commentMentionsForbidden(commentText, forbiddenSymbols) {
  const tokens = commentText.match(/[A-Za-z_$][\w$]*/g);
  if (!tokens) return null;
  for (const t of tokens) {
    if (!isDistinctiveIdent(t)) continue;
    for (const s of forbiddenSymbols) {
      if (t === s && s.length >= 6) return s;
      if (t.length >= 6 && s.length >= 8 && s.startsWith(t)) return s;
    }
  }
  return null;
}

/**
 * Retire du CODE tout COMMENTAIRE (`//` ou `/* *\/`) mentionnant un symbole moteur
 * excise (cf. commentMentionsForbidden). Ne touche NI le code executable NI les chaines
 * (le nom moteur en prose ne doit pas partir au navigateur — DoD §8). Remplacement
 * neutre pour la syntaxe : bloc `/* *\/` -> une espace (pas de jonction de tokens) ;
 * ligne `//` -> vide (le saut de ligne reste). Deterministe, sans horloge ni hasard.
 */
export function stripForbiddenComments(code, forbiddenSymbols) {
  let out = '';
  let i = 0;
  while (i < code.length) {
    const isComment =
      (code[i] === '/' && (code[i + 1] === '/' || code[i + 1] === '*')) || false;
    const sc = skipStringOrComment(code, i);
    if (sc >= 0) {
      const span = code.slice(i, sc);
      // Seuls les commentaires sont candidats au retrait ; les chaines passent intactes.
      if (isComment && commentMentionsForbidden(span, forbiddenSymbols)) {
        out += code[i + 1] === '*' ? ' ' : '';
      } else {
        out += span;
      }
      i = sc;
      continue;
    }
    out += code[i];
    i++;
  }
  return out;
}

/**
 * Recense les COMMENTAIRES d'un fragment de code qui mentionnent un symbole moteur
 * excise (memes regles que commentMentionsForbidden). Renvoie [{ symbol, sample }].
 * Sert de FILET a l'audit §8 : prouve que stripForbiddenComments a bien nettoye le
 * clone servi (aucun nom de methode confidentielle en prose cote navigateur).
 */
export function scanForbiddenComments(code, forbiddenSymbols) {
  const hits = [];
  let i = 0;
  while (i < code.length) {
    const isComment = code[i] === '/' && (code[i + 1] === '/' || code[i + 1] === '*');
    const sc = skipStringOrComment(code, i);
    if (sc >= 0) {
      if (isComment) {
        const span = code.slice(i, sc);
        const sym = commentMentionsForbidden(span, forbiddenSymbols);
        if (sym) {
          hits.push({
            symbol: sym,
            sample: span.replace(/\s+/g, ' ').trim().slice(0, 80),
          });
        }
      }
      i = sc;
      continue;
    }
    i++;
  }
  return hits;
}

/** Prochain index >= from d'un caractere, en sautant chaines/commentaires. */
function indexOfCode(src, ch, from) {
  let i = from;
  while (i < src.length) {
    const sc = skipStringOrComment(src, i);
    if (sc >= 0) {
      i = sc;
      continue;
    }
    if (src[i] === ch) return i;
    i++;
  }
  return -1;
}

/**
 * Etend `start` vers l'amont pour englober un commentaire d'EN-TETE immediatement
 * adjacent a la declaration (bloc `/* ... *\/` OU suite de lignes `//`), separe
 * seulement par des espaces. Evite d'orpheliner les commentaires qui decrivent la
 * fonction excisee (et qui mentionneraient son nom / sa methode).
 */
function extendStartOverLeadingComment(src, start) {
  let i = start - 1;
  while (i >= 0 && /\s/.test(src[i])) i--;
  if (i < 1) return start;
  // Fin de bloc « */ » ? Remonte jusqu'au « /* » correspondant.
  if (src[i] === '/' && src[i - 1] === '*') {
    let k = i - 2;
    while (k >= 1 && !(src[k - 1] === '/' && src[k] === '*')) k--;
    if (k >= 1 && src[k - 1] === '/' && src[k] === '*') return k - 1;
    return start;
  }
  // Suite de lignes « // » contigues.
  let newStart = start;
  let lineEnd = i;
  while (lineEnd >= 0) {
    let ls = lineEnd;
    while (ls >= 0 && src[ls] !== '\n') ls--;
    const lineStart = ls + 1;
    let p = lineStart;
    while (p <= lineEnd && /\s/.test(src[p])) p++;
    if (src[p] === '/' && src[p + 1] === '/') {
      newStart = lineStart;
      lineEnd = ls - 1;
      while (lineEnd >= 0 && /[ \t\r]/.test(src[lineEnd])) lineEnd--;
    } else break;
  }
  return newStart;
}

/**
 * Localise la declaration top-level `function NAME(...) { ... }` OU
 * `const NAME = { ... };` / `const NAME = [ ... ];`. Renvoie { start, end, kind }
 * (bornes dans src, `end` exclusif ; `start` inclut un commentaire d'en-tete
 * adjacent). Jette si introuvable.
 */
function findDecl(src, name) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Fonction : le nom DOIT etre suivi de `(` (evite excLimit vs excLimitLib).
  const fnRe = new RegExp(`(?<![\\w.$])function\\s+${esc}\\s*\\(`);
  const fnM = fnRe.exec(src);
  if (fnM) {
    const start = extendStartOverLeadingComment(src, fnM.index);
    const parenOpen = indexOfCode(src, '(', fnM.index);
    const parenEnd = scanBalanced(src, parenOpen); // fin de la liste d'arguments
    const bodyOpen = indexOfCode(src, '{', parenEnd);
    if (bodyOpen < 0) throw new Error(`Corps de « ${name} » introuvable.`);
    const end = scanBalanced(src, bodyOpen);
    return { start, end, kind: 'function' };
  }
  // Const objet/tableau.
  const cstRe = new RegExp(`(?<![\\w.$])const\\s+${esc}\\s*=`);
  const cstM = cstRe.exec(src);
  if (cstM) {
    const start = extendStartOverLeadingComment(src, cstM.index);
    const eq = indexOfCode(src, '=', cstM.index);
    // Premier caractere significatif de la valeur.
    let v = eq + 1;
    while (v < src.length) {
      const sc = skipStringOrComment(src, v);
      if (sc >= 0) {
        v = sc;
        continue;
      }
      if (!/\s/.test(src[v])) break;
      v++;
    }
    if (src[v] !== '{' && src[v] !== '[') {
      throw new Error(`Valeur de « const ${name} » non {}/[] (non geree).`);
    }
    let end = scanBalanced(src, v);
    // Consomme un `;` terminal eventuel (+ espaces).
    let k = end;
    while (k < src.length && /\s/.test(src[k])) k++;
    if (src[k] === ';') end = k + 1;
    return { start, end, kind: 'const' };
  }
  throw new Error(
    `Declaration « ${name} » INTROUVABLE dans la reference (structure du moteur modifiee ?).`,
  );
}

/**
 * Localise une AFFECTATION de gestionnaire anonyme
 * `document.getElementById('<id>').onclick = ( ... ) => { ... } ;`. Renvoie
 * { start, end } (bornes dans src, `end` exclusif, `;` terminal inclus). Jette si
 * introuvable. Sert a REECRIRE les handlers 2D de GEOPLAQUE (ps-run/ax-run/tri-run)
 * qui ne sont PAS des declarations nommees (donc hors de findDecl) mais qui APPELLENT
 * les solveurs excises : on remplace le corps par une version async/bridge.
 */
function findOnclickAssignment(src, id) {
  const anchor = `document.getElementById('${id}').onclick`;
  const aIdx = src.indexOf(anchor);
  if (aIdx < 0) {
    throw new Error(
      `Affectation onclick « ${id} » INTROUVABLE (structure de l'outil modifiee ?).`,
    );
  }
  const eq = indexOfCode(src, '=', aIdx + anchor.length);
  if (eq < 0) throw new Error(`« = » introuvable apres onclick ${id}.`);
  const paren = indexOfCode(src, '(', eq + 1);
  if (paren < 0) throw new Error(`Parametres de la fleche ${id} introuvables.`);
  const parenEnd = scanBalanced(src, paren);
  const brace = indexOfCode(src, '{', parenEnd);
  if (brace < 0) throw new Error(`Corps de la fleche ${id} introuvable.`);
  let end = scanBalanced(src, brace);
  let k = end;
  while (k < src.length && /\s/.test(src[k])) k++;
  if (src[k] === ';') end = k + 1;
  return { start: aIdx, end };
}

// ---------------------------------------------------------------------------
// Fragments injectes (JS navigateur — sans backtick ni ${} pour rester litteral)
// ---------------------------------------------------------------------------

/** Tables KP/KC reduites aux LABELS de sol (benins) : les coefficients de courbe ne
 * sont PAS embarques dans le clone (pas de table complete cote client). `buildNote`
 * n'utilise que .lib ; `caseSteps`/`refCapSteps` lisent .f/.c INJECTES AU RUNTIME par
 * mapOutputToR depuis la sortie serveur (cas[].coefCourbeF/C — categorie du calcul, table
 * publiee annexe D/E, ADR 0015 reco A). Objet `const` mais MUTABLE : le mapping ajoute
 * .f/.c a KP[cat]/KC[cat] pour la seule categorie active. */
const KP_LABELS =
  "const KP={argiles:{lib:'Argiles et limons'},sables:{lib:'Sables et graves'},craies:{lib:'Craies'},marnes:{lib:'Marnes et marno-calcaires'},roches:{lib:'Roches altérées'}};";
const KC_LABELS =
  "const KC={argiles:{lib:'Argiles et limons'},sables:{lib:'Sables et graves'},craies:{lib:'Craies'},marnes:{lib:'Marnes et marno-calcaires'},roches:{lib:'Roches altérées'}};";

/** recalc() reecrit : async, passe par le bridge, mappe la sortie whitelistee. */
const RECALC_ASYNC = [
  'async function recalc(){',
  '  var R={ err:null, warn:[], cases:[], refCap:null, ctx:buildCtxFromState(S,null) };',
  "  /* NO-CALC-INITIAL (ADR 0015) : au chargement (ou sur etat vide/invalide) l'outil",
  "     d'origine lance recalc sur un state VIDE (blankState : sondage sans z, B vide).",
  '     On NE contacte PAS le serveur dans ce cas : la validation locale CONSERVEE',
  '     (parsedSondage) rend le message natif « Renseignez… » comme le ferait computeAll,',
  '     puis on sort. Un appel serveur ne part que sur un state PLAUSIBLE (>=1 ligne de',
  '     sondage valide, ou mode labo). Idem : validateInputs() marque les champs. */',
  '  var __rows=(typeof parsedSondage==="function")?parsedSondage(S):[];',
  '  var __labo=(S&&S.essai==="labo");',
  '  if(!__labo && (!__rows || __rows.length===0)){',
  "    var p0=$('tab-verifs'); if(p0) p0.innerHTML='<div class=\"hint\">Renseignez au moins une ligne de sondage valide \\u2014 ou cliquez sur \\u00ab Exemple fictif \\u00bb pour charger un jeu de d\\u00e9monstration.</div>';",
  "    var n0=$('noteView'); if(n0) n0.innerHTML='';",
  "    var np0=$('notePrint'); if(np0) np0.innerHTML='';",
  '    try{ validateInputs(); }catch(e){}',
  '    return;',
  '  }',
  "  var pane=$('tab-verifs'); if(pane) pane.innerHTML='<div class=\"hint\">Calcul en cours…</div>';",
  '  var resp;',
  '  try{ resp = await window.__geofamBridge.calc(JSON.parse(JSON.stringify(S))); }',
  "  catch(e){ renderCalcError(R,{message:'Pont de calcul indisponible : '+((e&&e.message)||e)}); validateInputs(); return; }",
  "  if(!resp || !resp.ok){ renderCalcError(R,(resp&&resp.error)||{message:'Réponse de calcul vide.'}); validateInputs(); return; }",
  '  window.__terzaghiLastCalcResultId = resp.calcResultId || null;',
  '  mapOutputToR(R, resp.output||{erreur:null,warnings:[],cas:[]}, S);',
  "  var coupeSvg=''; try{ coupeSvg=drawCoupe(R); }catch(e){}",
  '  try{ renderVerifs(R); }catch(e){ if(pane) pane.innerHTML=\'<div class="warnbox">Erreur de rendu des vérifications.</div>\'; }',
  "  var note=''; try{ note=buildNote(R); }catch(e){ note='<p>Erreur de rendu de la note.</p>'; }",
  "  var nv=$('noteView'); if(nv) nv.innerHTML=note;",
  "  var np=$('notePrint'); if(np) np.innerHTML=coupeFigure(coupeSvg)+note;",
  '  validateInputs();',
  '  /* GARDE §5 — ERREUR EN BANDE : runTerzaghi renvoie TOUJOURS ok:true et encode les',
  '     erreurs de saisie dans output.erreur (mappe en R.err). resp.ok=true ne suffit donc',
  '     PAS : sur une erreur en bande, la note rendue se reduit au message d erreur. On NE',
  '     capture (et donc on NE scelle) JAMAIS un document d erreur — meme garde que le patron',
  '     burmister (if(out.erreur){ renderCalcError(...); return; } AVANT la capture). La note',
  '     d erreur reste AFFICHEE (rendu ci-dessus) ; seule la capture/scellement est bloquee. */',
  '  if(R.err || (resp.output && resp.output.erreur)){ return; }',
  '  /* Option 3 : sceller le DOCUMENT que l outil vient de rendre (noteView + notePrint),',
  '     APRES le rendu et UNIQUEMENT sur calcul reussi (ni erreur hors bande, filtree plus',
  '     haut, ni erreur en bande, filtree par la garde ci-dessus). */',
  '  __terzaghiCaptureSnapshot();',
  '}',
].join('\n');

/** Bridge postMessage + helpers de mapping (injectes en tete du bloc UI). */
const BRIDGE_AND_SHIM = [
  '/* ===================== BRIDGE + MAPPING (injecté — clone excisé, ADR 0015) ===================== */',
  '/* Runtime bridge cote iframe : correlation par id, source === parent (origine opaque). */',
  '(function(){',
  '  var TOOL_ID="terzaghi", ENGINE_ID="fondation-superficielle";',
  '  var pending=Object.create(null), seq=0;',
  '  var ctx={ engineId:ENGINE_ID, orgSlug:null, projectLabel:null, readOnly:false };',
  '  function post(msg){ try{ window.parent.postMessage(msg,"*"); }catch(e){} }',
  '  window.addEventListener("message", function(ev){',
  '    if(ev.source !== window.parent) return;',
  '    var d=ev.data; if(!d || d.v!==1 || typeof d.type!=="string") return;',
  '    if(d.type==="init"){ ctx=Object.assign(ctx, d.payload||{}); return; }',
  '    if(d.type==="calc:response"){ var p=pending[d.id]; if(!p) return; delete pending[d.id]; p(d.payload||{ok:false,error:{message:"réponse vide"}}); return; }',
  '  });',
  '  window.__geofamBridge={',
  '    calc:function(params){ var id=TOOL_ID+":"+(++seq); return new Promise(function(resolve){ pending[id]=resolve; post({v:1,type:"calc:request",id:id,payload:{engineId:ENGINE_ID,label:(params&&params.projet)||null,params:params}}); }); },',
  '    emitPv:function(calcResultId){ post({v:1,type:"pv:request",payload:{calcResultId:calcResultId}}); },',
  '    /* snapshot:capture (option 3 « sceller le document imprime ») : remonte a l hote le HTML',
  '       rendu (affichage + document imprimable auto-contenu). Sens iframe->hote SEUL,',
  '       fire-and-forget. Contenu = la note deja rendue (grandeurs whitelistees serveur) + coupe',
  '       SVG, jamais de science (le calcul est excise). L hote le scelle sur SON dernier',
  '       calcResultId. Identique au patron roadsens (BURMISTER_BRIDGE_AND_SHIM). */',
  '    snapshot:function(displayHtml,printHtml){ post({v:1,type:"snapshot:capture",payload:{displayHtml:String(displayHtml||""),printHtml:String(printHtml||"")}}); },',
  '    context:function(){ return ctx; }',
  '  };',
  '  /* input:dirty (correctif PV BQ-1) : signale a l hote que l ecran a change apres un calcul',
  '     -> le bouton d emission du PV scelle se desactive jusqu au prochain calcul (evite un PV perime).',
  '     Emission IMMEDIATE (front de montee), NON debouncee : le bouton doit se desactiver des la 1re frappe.',
  '     Throttle ~1/frame par FLAG booleen (aucun delai temporel sur l emission) pour ne pas inonder l hote,',
  '     lui-meme idempotent. Listener DELEGUE au document (capture) : generique, sans connaitre le DOM de l outil.',
  '     Cible input/change uniquement (la donnee A change) — PAS click : naviguer entre onglets de',
  '     resultats ne change pas le calcul affiche (sinon on desactiverait le PV a tort). Un changement de',
  '     mode de calcul sans recalcul reste couvert cote hote : ce mode n a pas de calcResultId. */',
  '  var __geofamDirtyFrame=false;',
  '  function __geofamEmitDirty(){ if(__geofamDirtyFrame) return; __geofamDirtyFrame=true; post({v:1,type:"input:dirty",payload:{toolId:TOOL_ID}}); var __raf=(typeof requestAnimationFrame==="function")?requestAnimationFrame:function(f){setTimeout(f,0);}; __raf(function(){ __geofamDirtyFrame=false; }); }',
  '  document.addEventListener("input", __geofamEmitDirty, true);',
  '  document.addEventListener("change", __geofamEmitDirty, true);',
  '  post({v:1,type:"ready",payload:{toolId:TOOL_ID}});',
  '})();',
  '',
  'var REFCAP_LIB={ELU_F:"ELU fondamental",ELU_A:"ELU accidentel",ELS_C:"ELS (caract. / fréq. / QP)"};',
  'function etatLibClone(code){ for(var i=0;i<ETATS.length;i++){ if(ETATS[i][0]===code) return ETATS[i][1]; } return code; }',
  '',
  "/* Reconstruit le contexte d'affichage X depuis le STATE (rejeu des entrées) +",
  '   les grandeurs benignes renvoyées par le serveur (regime, contraintes de base). */',
  'function buildCtxFromState(S, output){',
  '  var rows=parsedSondage(S);',
  '  var B=num(S.B), L=num(S.L), D=num(S.D), zw=num(S.nappe);',
  '  var eY=num(S.eYoung), nu=num(S.nuSol);',
  '  var labo=(S.essai==="labo");',
  '  var cb=(output&&output.contraintesBase)||{};',
  '  var rd=(output&&output.raideurs&&typeof output.raideurs==="object")?output.raideurs:null;',
  '  return {',
  '    forme:S.forme, B:B, L:L, D:D, essai:S.essai, labo:labo, cat:S.solCat,',
  '    c:num(S.c), phi:num(S.phi), gAv:num(S.gAvant), gAp:num(S.gApres),',
  '    eY:eY, nu:nu, zw:zw, beton:S.beton, cphiOn:!!S.cphiOn,',
  '    talus:!!S.talusOn, beta:num(S.beta), dT:num(S.dTalus), talusDir:S.talusDir,',
  '    profilMode:S.profilMode, rows:rows,',
  '    zmaxSond: rows.length?rows[rows.length-1].z:0,',
  '    regime:(output&&output.regime)||undefined,',
  // Raideurs equivalentes (K_v/K_h/K_θ) issues du serveur (annexe J.3, reco A) ; null si
  // absentes (E/ν non renseignes) -> caseSteps saute la section « Raideurs equivalentes ».
  '    raid: rd,',
  '    u:Number.isFinite(cb.u)?cb.u:NaN, q0:Number.isFinite(cb.q0)?cb.q0:NaN, sv0:Number.isFinite(cb.sv0)?cb.sv0:NaN,',
  '    DeBref:NaN, deFrom:0',
  '  };',
  '}',
  '',
  '/* Nombre fini de la sortie serveur, sinon NaN (affichage « — » cote renderers). */',
  'function svNum(v){ return Number.isFinite(v)?v:NaN; }',
  '/* Injecte les coefficients de courbe k_p/k_c (categorie active) fournis par le',
  '   serveur dans KP/KC (table publiee annexe D/E — ADR 0015 reco A) pour que curveStr',
  '   (local a caseSteps/refCapSteps) substitue la formule. Jamais la table complete : on',
  '   ne renseigne QUE la categorie du calcul, depuis la sortie whitelistee. */',
  'function feedCurveCoeffs(S, f, c){',
  '  if(!Array.isArray(f) || !Array.isArray(c)) return;',
  '  var tbl=(S.essai==="penetro")?KC:KP; var e=tbl[S.solCat];',
  '  if(e) tbl[S.solCat]={ lib:e.lib, f:f.slice(), c:c.slice() };',
  '}',
  '/* Recopie un sous-objet de tassement whitelisté en marquant ok:true (les renderers',
  "   testent .ok). Lecture de cle nommee (l'objet vient deja de la whitelist serveur). */",
  'function tassObj(o){ return (o && typeof o==="object") ? Object.assign({ok:true}, o) : null; }',
  '',
  '/* Mappe la SORTIE whitelistée (contract.ts) vers la forme R attendue par les',
  '   renderers CONSERVÉS (renderVerifs/renderRefCap/caseSteps/refCapSteps). Aucune',
  '   science : lecture de champs whitelistés + rejeu des efforts SAISIS. */',
  'function mapOutputToR(R, output, S){',
  '  R.err = output.erreur || null;',
  '  R.warn = Array.isArray(output.warnings)?output.warnings.slice():[];',
  '  R.ctx = buildCtxFromState(S, output);',
  '  var charges = Array.isArray(S.charges)?S.charges:[];',
  '  R.cases = (Array.isArray(output.cas)?output.cas:[]).map(function(o){',
  '    var ch = charges[o.idx] || {};',
  '    var C = { idx:o.idx, etat:o.etat, lib:etatLibClone(o.etat), notes:[], cat:S.solCat,',
  '      Fz:num(ch.fz), Fx:num(ch.fx)||0, Fy:num(ch.fy)||0, Mx:num(ch.mx)||0, My:num(ch.my)||0,',
  '      invalid: o.invalide ? "Cas de charge rejeté à la saisie (charge nulle ou géométrie invalide)." : null };',
  '    if(C.invalid) return C;',
  '    C.qref = svNum(o.qref); C.qRvd = svNum(o.qRvd); C.Rtot = svNum(o.Rtot);',
  '    C.taux = svNum(o.taux); C.portOk = (typeof o.portanceOk==="boolean")?o.portanceOk:false;',
  '    C.H = Number.isFinite(o.Hd)?o.Hd:0; C.Rhd = svNum(o.Rhd); C.tauxH = svNum(o.tauxH);',
  '    C.glisOk = (typeof o.glissementOk==="boolean")?o.glissementOk:null;',
  '    C.excOk = (typeof o.excOk==="boolean")?o.excOk:null;',
  '    C.excLim = svNum(o.excLim); C.excLimLib = (typeof o.excLimLib==="string")?o.excLimLib:"";',
  // Geometrie effective (Meyerhof) + coefficients de portance/reduction (deroule pas-a-pas).
  '    C.A = svNum(o.A); C.Ap = svNum(o.Ap); C.eB = svNum(o.eB); C.eL = svNum(o.eL);',
  '    C.geom = { exc: svNum(o.exc), Bp: svNum(o.Bp), Lp: svNum(o.Lp), A: svNum(o.A), Ap: svNum(o.Ap) };',
  '    C.delta = svNum(o.delta); C.idel = svNum(o.idel); C.ibet = svNum(o.ibet); C.idb = svNum(o.idb);',
  '    C.hr = svNum(o.hr); C.hrRed = (o.hrRed===true); C.ple = svNum(o.ple); C.De = svNum(o.De); C.DeB = svNum(o.DeB);',
  '    C.kpx = svNum(o.kpx); C.kf = svNum(o.kf); C.kc = svNum(o.kc); C.kp = svNum(o.kp);',
  '    C.qnet = svNum(o.qnet); C.R0 = svNum(o.R0); C.gRv = svNum(o.gRv); C.gRdv = svNum(o.gRdv);',
  '    C.da = svNum(o.da); C.gRh = svNum(o.gRh); C.gRdh = svNum(o.gRdh);',
  '    C.glisMode = (typeof o.glisMode==="string")?o.glisMode:"";',
  '    feedCurveCoeffs(S, o.coefCourbeF, o.coefCourbeC);',
  '    if(o.cphi && typeof o.cphi==="object") C.cphi = o.cphi;',
  // Tassements DETAILLES (un seul present selon la methode) ; repli sur le resume si besoin.
  '    C.tass = tassObj(o.tass); C.elast = tassObj(o.elast); C.schm = tassObj(o.schm); C.oed = tassObj(o.oed);',
  '    if(!C.tass && Number.isFinite(o.tassement)) C.tass={ok:true,sf:o.tassement};',
  '    if(!C.schm && Number.isFinite(o.tassementSchmertmann)) C.schm={ok:true,s:o.tassementSchmertmann};',
  '    if(!C.oed && Number.isFinite(o.tassementOed)) C.oed={ok:true,s:o.tassementOed,zlbl:"la zone d\'influence"};',
  '    if(!C.elast && Number.isFinite(o.tassementElastique)) C.elast={ok:true,s:o.tassementElastique};',
  '    if(Number.isFinite(o.deplacementVertical)) C.dv=o.deplacementVertical;',
  '    return C;',
  '  });',
  '  var cr = output.capaciteReference;',
  '  if(cr && cr.ok){',
  '    feedCurveCoeffs(S, cr.coefCourbeF, cr.coefCourbeC);',
  '    var rf = { ok:true, A:svNum(cr.A), R0:svNum(cr.R0), q0:svNum(cr.q0),',
  '      perML:(typeof cr.perML==="boolean")?cr.perML:(S.forme==="filante"),',
  '      method:(typeof cr.method==="string")?cr.method:"", cat:S.solCat,',
  '      hr:svNum(cr.hr), ple:svNum(cr.ple), De:svNum(cr.De), DeB:svNum(cr.DeB), kpx:svNum(cr.kpx),',
  '      kf:svNum(cr.kf), kc:svNum(cr.kc), kp:svNum(cr.kp), ib:svNum(cr.ib), qnet:svNum(cr.qnet),',
  '      gRdv:svNum(cr.gRdv), qTass:svNum(cr.qTass),',
  '      states:(Array.isArray(cr.states)?cr.states:[]).map(function(s){',
  '        return { etat:s.etat, lib:REFCAP_LIB[s.etat]||s.etat, gRv:s.gRv, Rvd:s.Rvd, qRvd:s.qRvd }; }) };',
  '    rf.tass = tassObj(cr.tass); rf.elast = tassObj(cr.elast); rf.schm = tassObj(cr.schm); rf.oed = tassObj(cr.oed);',
  '    R.refCap = rf;',
  '  } else if(cr) { R.refCap = { ok:false, err:(typeof cr.err==="string")?cr.err:"capacité incalculable" }; }',
  '  else { R.refCap = null; }',
  '  return R;',
  '}',
  '',
  'function renderCalcError(R, err){',
  '  var msg=(err&&err.message)?err.message:"Calcul indisponible.";',
  '  var reason=(err&&err.reason)?" ("+err.reason+")":"";',
  "  var pane=$('tab-verifs'); if(pane) pane.innerHTML='<div class=\"warnbox\" style=\"border-left-color:var(--bad);background:var(--bad-bg)\"><strong>Calcul indisponible</strong><br>'+escH(msg+reason)+'</div>';",
  "  var nv=$('noteView'); if(nv) nv.innerHTML='<p>'+escH(msg)+'</p>';",
  "  try{ var coupe=drawCoupe(R); var np=$('notePrint'); if(np) np.innerHTML=coupeFigure(coupe); }catch(e){}",
  '}',
  '',
  '/* ---- CAPTURE DU DOCUMENT (option 3 « sceller le document imprime ») ----',
  '   Serialise DEUX chaines HTML auto-contenues APRES un calcul reussi (noteView + notePrint',
  '   deja peuples par recalc -> buildNote/coupeFigure). DETERMINISTE : meme sortie serveur =',
  '   meme note rendue = meme HTML capture (aucune horloge, aucun hasard, aucun ordre DOM',
  '   instable). §8 : ne contient QUE des valeurs deja affichees (grandeurs whitelistees',
  '   serveur — p_le etoile, q_ce, k_p, k_c, h_r, D_e, i_delta, q_net, tassements… ADR 0015)',
  '   + coupe SVG ; les',
  '   <script> sont retires, aucun gestionnaire inline ne subsiste et aucune fonction de calcul',
  '   n existe dans le clone (excisee). Patron identique a roadsens (__roadsensCaptureSnapshot). */',
  '/* Clone un noeud et le rend INERTE : retire tout <script> et <button> descendant, tout',
  '   attribut gestionnaire inline on…= (sur le noeud et ses descendants) ET toute URI',
  '   javascript: — conformement a assertInertHtml (apps/api/src/pv/html-guard.ts). Renvoie',
  '   son outerHTML (ou "" si absent). La note Terzaghi et la coupe SVG sont du CONTENU',
  '   statique (buildNote/drawCoupe ne posent aucun handler), ce nettoyage est une garde §8. */',
  'function __terzaghiCloneClean(el){',
  '  if(!el) return "";',
  '  var c=el.cloneNode(true);',
  '  var kill=c.querySelectorAll?c.querySelectorAll("script,button"):[];',
  '  for(var j=0;j<kill.length;j++){ if(kill[j].parentNode) kill[j].parentNode.removeChild(kill[j]); }',
  '  var all=c.querySelectorAll?c.querySelectorAll("*"):[];',
  '  var nodes=[c]; for(var a=0;a<all.length;a++){ nodes.push(all[a]); }',
  '  for(var n=0;n<nodes.length;n++){',
  '    var nd=nodes[n]; if(!nd.attributes) continue;',
  '    for(var k=nd.attributes.length-1;k>=0;k--){',
  '      var att=nd.attributes[k], an=att.name||"", av=att.value||"";',
  '      if(an.length>=2 && an.slice(0,2).toLowerCase()==="on"){ nd.removeAttribute(an); continue; }',
  '      if(/^\\s*javascript:/i.test(av)) nd.removeAttribute(an);',
  '    }',
  '  }',
  '  return c.outerHTML||"";',
  '}',
  '/* Agrege TOUT le CSS de l outil (les .note/.coupe-print… sont stylees par des classes',
  '   globales + var(--…)) dans une chaine reutilisable. */',
  'function __terzaghiCollectStyles(){',
  '  var styles="";',
  '  var sl=document.querySelectorAll("style");',
  '  for(var i=0;i<sl.length;i++){ styles += (sl[i].textContent||"") + "\\n"; }',
  '  return styles;',
  '}',
  '/* Document IMPRIMABLE auto-contenu = #notePrint (coupe SVG + note, deja assemble par',
  '   recalc : coupeFigure(coupeSvg)+note), avec TOUT le CSS de l outil inline. Les regles de',
  '   la coupe (.coupe-print…) vivent dans @media print : on les PROMEUT a l ecran pour que le',
  '   document reste CONSULTABLE (apercu de la note) tout en restant fidele a l impression',
  '   (les regles @media print d origine sont conservees telles quelles). */',
  'function __terzaghiSerializePrintable(){',
  '  var styles=__terzaghiCollectStyles();',
  '  styles += "\\n#notePrint{display:block !important}\\n"',
  '    + ".coupe-print{margin:0 0 16px;break-inside:avoid}\\n"',
  '    + ".coupe-print-title{font-weight:600;font-size:12px;margin-bottom:6px;color:#232E33}\\n"',
  '    + ".coupe-print svg{display:block;width:100%;max-width:540px;height:auto;margin:0 auto}\\n"',
  '    + ".coupe-print .legend{display:flex;gap:16px;flex-wrap:wrap;justify-content:center;margin-top:6px;font-size:10px}\\n";',
  '  var np=__terzaghiCloneClean(document.getElementById("notePrint"));',
  '  return "<!doctype html><html lang=\\"fr\\"><head><meta charset=\\"utf-8\\">"',
  '    + "<meta name=\\"viewport\\" content=\\"width=device-width, initial-scale=1\\">"',
  '    + "<title>Terzaghi \\u2014 Note de v\\u00e9rification (NF P 94-261)</title>"',
  '    + "<style>" + styles + "</style></head><body>"',
  '    + np',
  '    + "</body></html>";',
  '}',
  '/* APERCU auto-contenu de la note consultable (#noteView, l onglet « Note de calcul »),',
  '   pour l iframe du panneau de detail. Meme patron : CSS agrege + enveloppe <!doctype>',
  '   (sans quoi l outerHTML nu de #noteView perd ses styles — var(--…) non definies dans l',
  '   iframe sandbox de l onglet Calculs). BORNE a la note (pas de coupe) : c est le',
  '   displayHtml. */',
  'function __terzaghiSerializeDisplay(){',
  '  var styles=__terzaghiCollectStyles();',
  '  styles += "\\n#noteView{display:block !important}\\n";',
  '  var nv=__terzaghiCloneClean(document.getElementById("noteView"));',
  '  return "<!doctype html><html lang=\\"fr\\"><head><meta charset=\\"utf-8\\">"',
  '    + "<meta name=\\"viewport\\" content=\\"width=device-width, initial-scale=1\\">"',
  '    + "<title>Terzaghi \\u2014 Aper\\u00e7u de la note</title>"',
  '    + "<style>" + styles + "</style></head><body>"',
  '    + nv',
  '    + "</body></html>";',
  '}',
  '/* Emet snapshot:capture APRES le rendu (jamais avant). displayHtml = note consultable',
  '   (#noteView, stylee) ; printHtml = document imprimable auto-contenu (#notePrint = coupe',
  '   + note). Garde : ne fait rien si le pont n expose pas snapshot. */',
  'function __terzaghiCaptureSnapshot(){',
  '  try{',
  '    if(!window.__geofamBridge || typeof window.__geofamBridge.snapshot!=="function") return;',
  '    var displayHtml=__terzaghiSerializeDisplay();',
  '    var printHtml=__terzaghiSerializePrintable();',
  '    window.__geofamBridge.snapshot(displayHtml, printHtml);',
  '  }catch(e){}',
  '}',
  '/* =================== FIN BRIDGE + MAPPING =================== */',
].join('\n');

// ---------------------------------------------------------------------------
// Configuration par outil
// ---------------------------------------------------------------------------

/**
 * Symboles MOTEUR (science confidentielle) SUPPRIMES du clone. Sert de source de
 * verite unique a scripts/audit-excision.mjs (verification mecanique du §8).
 * Les fermetures internes elasticRaid / IzAt disparaissent avec leurs parents
 * (computeAll / tassementSchmertmann) ; on les liste quand meme pour l'audit.
 */
const TERZAGHI_ENGINE_SYMBOLS = [
  'computeAll',
  'elasticRaid',
  'IzAt',
  'integ',
  'integLin',
  'nodesFor',
  'harmMean',
  'harmMeanStep',
  'qceCalc',
  'deCalcP',
  'pleStar',
  'deStart',
  'deCalc',
  'kpCurve',
  'kcCalc',
  'kpCalc',
  'soilBlend',
  'iDelta',
  'iBeta',
  'geomCase',
  'excLimit',
  'excLimitLib',
  'hrCalc',
  'lambdas',
  'tassement',
  'gammaEffF',
  'cphiCalc',
  'raideurs',
  'newmarkCorner',
  'boussRect',
  'boussCirc',
  'boussStrip',
  'boussIz',
  'qcAt',
  'tassementOed',
  'cfGiroud',
  'tassementElastique',
  'schmParams',
  'tassementSchmertmann',
  'raideurMenardKv',
  'raideurSchmertmannKv',
  'gazetasFromKv',
  'etatLib',
  'gammaRv',
];

// ===========================================================================
// BURMISTER / ROADSENS (chaussees, methode rationnelle AGEROUTE 2015)
// ---------------------------------------------------------------------------
// Le HTML burmister est PLUS MONOLITHIQUE que terzaghi : `doCalc()` (excisé)
// CALCULE (propagateur Burmister multi-couche + lois de fatigue LCPC), ASSEMBLE
// l'objet global `_D` ET appelle `renderRes` (qui appelle `renderDetails`). On
// EXCISE le propagateur + la calibration LCPC + `doCalc`, et on REECRIT `runCalc`
// (async, bridge) : la sortie serveur WHITELISTEE (BurmisterOutputSchema) est
// remappee vers `_D` + l'argument de `renderRes`, puis les renderers CONSERVES
// (renderRes/renderDetails/sectionSVG/rCat/renderL/rTS…) rendent A L'IDENTIQUE.
//
// ARBITRAGE d'EXCISION (fail-closed, ADR 0015 §Excision) :
//  - CONFIDENTIEL (excisé + interdit à l'audit) : `burIntegrateMLWithPSC` (le
//    propagateur, exigence dure §8) + ses internes (_P/_P0/_mul42/inv4/matmul4/
//    matmul4x2/J0/J1), la calibration de fatigue LCPC (krLCPC/shLCPC/ksLCPC) et
//    l'orchestrateur `doCalc` ; + la TABLE de calibration matériaux (`M` : e6/s6/
//    b/kc/sn/Sh/kd/E10) — RÉDUITE aux seuls champs d'affichage {n,E,ν,bit,rig,c}
//    (les tables de calage ne partent JAMAIS au navigateur).
//  - PUBLIC (conservé) : calcNE/neC/tmjaC (la formule NE = 365·TMJA·C·CAM… est
//    IMPRIMÉE dans le volet Trafic ; C1-C8/T5-TEX = classification AGEROUTE
//    publique) ; uRisk/invNorm/U_RISK (quantile loi normale, textbook) ;
//    ifaceAuto/applyGntAuto (Tab. 68 / fiche GNT p.79, normatif public, ne lisent
//    que les drapeaux bit/rig) ; tous les renderers, la coupe SVG, le catalogue.
//    La NE AUTORITAIRE du verdict vient du SERVEUR (output.NE) ; calcNE ne sert
//    qu'à la PRÉVISUALISATION live du volet Trafic (rTS). [Réversible : si le
//    titulaire veut un §8 plus strict, renommer calcNE→calcNEClone comme etatLib.]
//
// RÉSIDUS FERMÉS (§8) affichés « — » côté clone (intermédiaires NON whitelistés) :
//   renderDetails l.1566 stC/stG (composantes collée/glissante par couche traitée)
//   et l.1578 axe/mid (décomposition ε_z par couche granulaire) ; la famille est le
//   libellé NU d'allowlist (sans le discriminant Kmix « §x.y, K=… ») — redaction
//   assumée (FUITE #1). Le VERDICT et toutes les résistances restent FIDÈLES.
// ===========================================================================

/** Symboles MOTEUR (science confidentielle) SUPPRIMES + INTERDITS a l'audit. */
const BURMISTER_ENGINE_SYMBOLS = [
  'burIntegrateMLWithPSC',
  '_P',
  '_P0',
  '_mul42',
  'inv4',
  'matmul4',
  'matmul4x2',
  'J0',
  'J1',
  'krLCPC',
  'shLCPC',
  'ksLCPC',
  'doCalc',
];

/**
 * Referentiel materiaux RÉDUIT aux champs d'AFFICHAGE (fail-closed) : nom, module
 * E, coefficient de Poisson ν, drapeaux bit/rig (catégorie publique), couleur c
 * (coupe SVG / catalogue). Les COEFFICIENTS DE CALAGE de fatigue (e6/s6/b/kc/sn/
 * Sh/kd/E10) sont RETIRÉS : la table de calibration ne part jamais au navigateur.
 * `upL` (choix matériau) recopie E/ν, `renderL`/`sectionSVG`/`rCat`/`ifaceAuto`/
 * `applyGntAuto` lisent n/c/bit/rig — aucun consommateur CONSERVÉ ne lit e6/b/kc.
 */
const BURMISTER_M_DISPLAY = [
  'const M={',
  "  BBSG1:{n:'BBSG classe 1  (E = 1 512 MPa \\u2014 T.54)',E:1512,nu:.45,bit:1,c:'#15171a'},",
  "  BBSG2:{n:'BBSG classe 2/3  (E = 1 896 MPa \\u2014 T.54)',E:1896,nu:.45,bit:1,c:'#2b2f33'},",
  "  BBTM:{n:'BB Tr\\u00e8s Mince (BBTM)',E:2500,nu:.45,bit:1,c:'#3a4046'},",
  "  BBM:{n:'BB Mince (BBM)',E:2500,nu:.45,bit:1,c:'#474e55'},",
  "  GB2:{n:'Grave Bitume GB2',E:2588,nu:.45,bit:1,c:'#3f617f'},",
  "  GB3:{n:'Grave Bitume GB3',E:2588,nu:.45,bit:1,c:'#2e4a63'},",
  "  EME2:{n:'EME2',E:6151,nu:.45,bit:1,c:'#1d6b6b'},",
  "  GL1:{n:'Lat\\u00e9rite GL1',E:200,nu:.35,c:'#e0a23a'},",
  "  GL2:{n:'Lat\\u00e9rite GL2',E:400,nu:.35,c:'#c1622b'},",
  "  GLli:{n:'Lat\\u00e9rite litho-stabilis\\u00e9e',E:400,nu:.35,c:'#cf8a44'},",
  "  GLa:{n:'Lat\\u00e9rite am\\u00e9lior\\u00e9e (GLa)',E:400,nu:.35,c:'#d8b94e'},",
  "  GLc1:{n:'Lat\\u00e9rite ciment GLc1',E:2500,nu:.25,rig:1,c:'#a99339'},",
  "  GLc2:{n:'Lat\\u00e9rite ciment GLc2',E:3000,nu:.25,rig:1,c:'#7c6526'},",
  "  GNT1:{n:'GNT1',E:600,nu:.35,c:'#e0c887'},",
  "  GNT2:{n:'GNT2',E:600,nu:.35,c:'#d4b76e'},",
  "  GC3:{n:'Grave Ciment GC-T3',E:23000,nu:.25,rig:1,c:'#8fa58c'},",
  "  SC2:{n:'Sable Ciment SC-T2',E:12000,nu:.25,rig:1,c:'#9db4c2'},",
  "  BQc:{n:'Banco-coquillage (BQc)',E:10000,nu:.25,rig:1,c:'#cdb48a'},",
  "  BC5:{n:'B\\u00e9ton BC5',E:35000,nu:.25,rig:1,c:'#e8e8de'},",
  "  BC2:{n:'B\\u00e9ton Maigre BC2',E:20000,nu:.25,rig:1,c:'#d6d6cd'},",
  "  BC5g:{n:'B\\u00e9ton BC5 (dalle goujonn\\u00e9e)',E:35000,nu:.25,rig:1,c:'#e8e8de'},",
  '};',
].join('\n');

/**
 * rFT (onglet « Paramètres ») RÉÉCRIT : l'original affichait la TABLE DE CALIBRATION
 * de fatigue ÉDITABLE (e6/b/kc/s6 par matériau) — table de calage qui ne part pas
 * au navigateur (fail-closed). Le clone liste les matériaux (bitumineux / traités)
 * et renvoie vers « Détails calcul » où les coefficients LCPC EFFECTIFS (kθ/SN/kc/
 * 1-b/kr/ks) du matériau DIMENSIONNANT sont affichés depuis la SORTIE SERVEUR
 * (ADR 0014). RÉSIDU DOCUMENTÉ : l'édition d'override ε₆/σ₆ (public, contrat
 * `load.fatigueOverrides`) n'est pas ré-exposée ici — table de fatigue servie par
 * le serveur = évolution ultérieure si le titulaire veut la fidélité complète.
 */
const BURMISTER_RFT = [
  'function rFT(){',
  '  function _rows(pred){ var out=""; for(var k in M){ if(!M.hasOwnProperty(k)) continue; var v=M[k]; if(!pred(v)) continue;',
  '    out+=\'<tr><td>\'+_esc(v.n)+\'</td><td colspan="3" style="font-size:10.5px;color:var(--color-text-secondary)">Param\\u00e8tres de fatigue appliqu\\u00e9s c\\u00f4t\\u00e9 serveur (catalogue AGEROUTE) \\u2014 voir \\u00ab D\\u00e9tails calcul \\u00bb</td></tr>\'; } return out; }',
  "  var b=document.getElementById('fbt'); if(b) b.innerHTML=_rows(function(v){return v.bit;});",
  "  var r=document.getElementById('frt'); if(r) r.innerHTML=_rows(function(v){return v.rig;});",
  '}',
].join('\n');

/** runCalc() RÉÉCRIT : async, garde no-calc-initial, bridge, mapping serveur -> _D. */
const BURMISTER_RUNCALC = [
  'async function runCalc(){',
  '  /* NO-CALC-INITIAL (ADR 0015) : etat vide/invalide -> message natif, AUCUN appel',
  '     serveur. Burmister ne recalcule PAS au chargement (init = renderL/rTS/…), mais',
  '     un clic « Calculer » sur une structure invalide ne doit pas solliciter le serveur. */',
  '  if(!plausibleBurmister()){ renderNeedInput(); return; }',
  "  /* Module GNT automatique : l'outil d'origine (doCalc) applique applyGntAuto AVANT",
  '     de calculer et affiche les E resolus. On fait de meme LOCALEMENT (fonction publique',
  '     conservee) puis on envoie les E RESOLUS (gntAuto non transmis) : le serveur calcule',
  '     sur ces memes E -> equivalence preservee, affichage fidele. */',
  '  try{ if(typeof cp!=="undefined" && cp && cp.gntAuto && typeof applyGntAuto==="function"){ applyGntAuto(); if(typeof renderL==="function") renderL(); } }catch(e){}',
  "  var btn=document.getElementById('btnc');",
  '  if(btn){ btn.disabled=true; btn.innerHTML=\'<span class="spin"></span>Calcul Burmister\\u2026\'; }',
  '  var resp;',
  '  try{ resp = await window.__geofamBridge.calc(buildBurmisterInput()); }',
  "  catch(e){ renderCalcError({message:'Pont de calcul indisponible : '+((e&&e.message)||e)}); _restoreCalcBtn(); return; }",
  "  if(!resp || !resp.ok){ renderCalcError((resp&&resp.error)||{message:'R\\u00e9ponse de calcul vide.'}); _restoreCalcBtn(); return; }",
  '  window.__roadsensLastCalcResultId = resp.calcResultId || null;',
  '  var out = resp.output || {};',
  '  if(out.erreur){ renderCalcError({message:out.erreur}); _restoreCalcBtn(); return; }',
  '  try{ buildDFromOutput(out); renderRes(rArgFromOutput(out)); }',
  "  catch(e){ var el=document.getElementById('resout'); if(el) el.innerHTML='<div class=\"note note-a\" style=\"margin-top:1rem\"><strong>Erreur de rendu :</strong> '+_esc(e&&e.message)+'</div>'; _restoreCalcBtn(); _gotoResults(); return; }",
  '  _restoreCalcBtn(); _gotoResults();',
  '  /* Option 3 : sceller le DOCUMENT que l outil vient de rendre (pane-r + pane-d).',
  '     APRES le rendu, uniquement sur calcul reussi (ce bloc n est pas atteint sur erreur). */',
  '  __roadsensCaptureSnapshot();',
  '}',
].join('\n');

/** loadPreset() RÉÉCRIT : identique a l'original, `doCalc()` (interdit) remplace par
 * `runCalc()` (async) ; la note du cas de validation est rendue APRES le calcul. */
const BURMISTER_LOADPRESET = [
  "function loadPreset(id){var sel=document.getElementById('presetSel');if(sel)sel.value=id||'';var note=document.getElementById('presetNote');",
  " if(!id){nid=1;ly=[{id:nid++,mat:'BBSG1',h:.08,E:1512,nu:.45,ifc:'auto'},{id:nid++,mat:'GB2',h:.30,E:2588,nu:.45,ifc:'auto'},{id:nid++,mat:'GNT1',h:.15,E:400,nu:.35,ifc:'auto'}];pf={cls:'PF3',E:120,nu:.35};cp.neForce=null;cp.gntAuto=true;cp.r='auto';cp.sh='auto';syncPresetUI();renderL();if(note)note.innerHTML='';return;}",
  ' var p=PRESETS.find(function(x){return x.id===id;});if(!p)return;',
  " nid=1;ly=p.ly.map(function(L){var m=M[L[0]];return{id:nid++,mat:L[0],h:L[1]/100,E:(L[2]!=null?L[2]:m.E),nu:m.nu,ifc:'auto'};});",
  ' pf={cls:p.pf,E:(PFM[p.pf]||{E:120}).E,nu:.35};',
  " cp.neForce=p.ne;cp.gntAuto=false;cp.r='auto';cp.sh='auto';",
  ' syncPresetUI();renderL();',
  ' Promise.resolve(runCalc()).then(function(){ if(note)note.innerHTML=buildPresetNote(p); });',
  " document.querySelectorAll('.tbtn').forEach(function(x){x.classList.remove('on');});",
  " document.querySelectorAll('.pane').forEach(function(x){x.classList.remove('on');});",
  " var rb=document.querySelector('[data-tab=\"r\"]');if(rb)rb.classList.add('on');",
  " var rp=document.getElementById('pane-r');if(rp)rp.classList.add('on');}",
].join('\n');

/** Bridge postMessage (côté iframe) + helpers de mapping sortie serveur -> _D/renderRes. */
const BURMISTER_BRIDGE_AND_SHIM = [
  '/* ===================== BRIDGE + MAPPING (injecté — clone excisé, ADR 0015) ===================== */',
  '(function(){',
  '  var TOOL_ID="roadsens", ENGINE_ID="chaussee-burmister";',
  '  var pending=Object.create(null), seq=0;',
  '  var ctx={ engineId:ENGINE_ID, orgSlug:null, projectLabel:null, readOnly:false };',
  '  function post(msg){ try{ window.parent.postMessage(msg,"*"); }catch(e){} }',
  '  window.addEventListener("message", function(ev){',
  '    if(ev.source !== window.parent) return;',
  '    var d=ev.data; if(!d || d.v!==1 || typeof d.type!=="string") return;',
  '    if(d.type==="init"){ ctx=Object.assign(ctx, d.payload||{}); return; }',
  '    if(d.type==="calc:response"){ var p=pending[d.id]; if(!p) return; delete pending[d.id]; p(d.payload||{ok:false,error:{message:"réponse vide"}}); return; }',
  '  });',
  '  window.__geofamBridge={',
  '    calc:function(params){ var id=TOOL_ID+":"+(++seq); return new Promise(function(resolve){ pending[id]=resolve; post({v:1,type:"calc:request",id:id,payload:{engineId:ENGINE_ID,label:(params&&params.projet)||null,params:params}}); }); },',
  '    emitPv:function(calcResultId){ post({v:1,type:"pv:request",payload:{calcResultId:calcResultId}}); },',
  '    /* snapshot:capture (option 3 « sceller le document imprime ») : remonte a l hote le',
  '       HTML rendu (affichage + document imprimable auto-contenu). Sens iframe->hote SEUL,',
  '       fire-and-forget. Contenu = donnees deja rendues (whitelistees serveur) + SVG, jamais',
  '       de science (le calcul est excise). L hote le scelle sur SON dernier calcResultId. */',
  '    snapshot:function(displayHtml,printHtml){ post({v:1,type:"snapshot:capture",payload:{displayHtml:String(displayHtml||""),printHtml:String(printHtml||"")}}); },',
  '    context:function(){ return ctx; }',
  '  };',
  '  /* input:dirty (correctif PV BQ-1) : signale a l hote que l ecran a change apres un calcul',
  '     -> le bouton d emission du PV scelle se desactive jusqu au prochain calcul (evite un PV perime).',
  '     Emission IMMEDIATE (front de montee), NON debouncee : le bouton doit se desactiver des la 1re frappe.',
  '     Throttle ~1/frame par FLAG booleen (aucun delai temporel sur l emission) pour ne pas inonder l hote,',
  '     lui-meme idempotent. Listener DELEGUE au document (capture) : generique, sans connaitre le DOM de l outil.',
  '     Cible input/change uniquement (la donnee A change) — PAS click : naviguer entre onglets de',
  '     resultats ne change pas le calcul affiche (sinon on desactiverait le PV a tort). Un changement de',
  '     mode de calcul sans recalcul reste couvert cote hote : ce mode n a pas de calcResultId. */',
  '  var __geofamDirtyFrame=false;',
  '  function __geofamEmitDirty(){ if(__geofamDirtyFrame) return; __geofamDirtyFrame=true; post({v:1,type:"input:dirty",payload:{toolId:TOOL_ID}}); var __raf=(typeof requestAnimationFrame==="function")?requestAnimationFrame:function(f){setTimeout(f,0);}; __raf(function(){ __geofamDirtyFrame=false; }); }',
  '  document.addEventListener("input", __geofamEmitDirty, true);',
  '  document.addEventListener("change", __geofamEmitDirty, true);',
  '  post({v:1,type:"ready",payload:{toolId:TOOL_ID}});',
  '})();',
  '',
  '/* ---- CAPTURE DU DOCUMENT (option 3 « sceller le document imprime ») ----',
  '   Serialise DEUX chaines HTML auto-contenues APRES un calcul reussi (pane-r/pane-d',
  '   deja rendus par renderRes -> renderDetails). DETERMINISTE : meme sortie serveur =',
  '   meme DOM rendu = meme HTML capture (aucune horloge, aucun hasard). §8 : ne contient',
  '   QUE des valeurs deja affichees (whitelistees serveur) + SVG ; les <script> sont retires',
  '   et aucune fonction de calcul n existe dans le clone (excisee). */',
  '/* PICTOGRAMMES SVG (FX-3b, fidelite des glyphes) — voir __roadsensCloneClean : la',
  '   webfont Tabler ne charge PAS sous la CSP du document capture (default-src none,',
  '   pas de font-src) -> cases vides la ou l outil client montre une icone. On embarque',
  '   les paths (Tabler, open-source, viewBox 24, trait) des SEULES icones presentes dans',
  '   les zones capturees (.hd/#resout/pane-d) : road (logo), calculator (etat vide),',
  '   circle-check / circle-x (verdict). §8 : SVG inerte (aucun script/handler). */',
  'var __ROADSENS_TI_PATHS={',
  '  "road":["M4 19l4 -14","M20 19l-4 -14","M12 5l0 2","M12 10l0 2","M12 15l0 2"],',
  '  "calculator":["M4 3m0 2a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2z","M8 7m0 1a1 1 0 0 1 1 -1h6a1 1 0 0 1 1 1v1a1 1 0 0 1 -1 1h-6a1 1 0 0 1 -1 -1z","M8 14l0 .01","M12 14l0 .01","M16 14l0 .01","M8 17l0 .01","M12 17l0 .01","M16 17l0 .01"],',
  '  "circle-check":["M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0","M9 12l2 2l4 -4"],',
  '  "circle-x":["M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0","M10 10l4 4m0 -4l-4 4"]',
  '};',
  '/* <i class="ti ti-XXX" style="…"> -> <svg> inline equivalent. Le style d origine est',
  '   reporte APRES les defauts (font-size -> 1em ; color -> currentColor via stroke) pour',
  '   qu il prime (taille/couleur/alignement fideles). Icone inconnue -> "" (le <i> sera',
  '   retire, sans laisser de case vide). */',
  'function __roadsensIconSvg(cls, style){',
  '  var mm=/ti-([a-z0-9-]+)/.exec(String(cls||""));',
  '  var P=mm?__ROADSENS_TI_PATHS[mm[1]]:null;',
  '  if(!P) return "";',
  '  var d=""; for(var q=0;q<P.length;q++){ d+=\'<path d="\'+P[q]+\'"></path>\'; }',
  '  return \'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;width:1em;height:1em;vertical-align:middle;flex-shrink:0;\'+String(style||"")+\'">\'+d+\'</svg>\';',
  '}',
  '/* Clone un noeud, lui ajoute .printable si demande, retire tout <script> descendant,',
  '   renvoie son outerHTML (ou "" si absent). */',
  'function __roadsensCloneClean(el, addPrintable){',
  '  if(!el) return "";',
  '  var c=el.cloneNode(true);',
  '  if(addPrintable && c.classList) c.classList.add("printable");',
  '  var scr=c.querySelectorAll?c.querySelectorAll("script"):[];',
  '  for(var j=0;j<scr.length;j++){ if(scr[j].parentNode) scr[j].parentNode.removeChild(scr[j]); }',
  '  /* Retire la chrome interactive .resbar (barre de controle avec bouton d impression,',
  '     non imprimee par l outil) — evite de reintroduire des handlers et fidelise le document. */',
  '  var rb=c.querySelectorAll?c.querySelectorAll(".resbar"):[];',
  '  for(var r=0;r<rb.length;r++){ if(rb[r].parentNode) rb[r].parentNode.removeChild(rb[r]); }',
  '  /* FX-3a : retire la chrome interactive (bouton « Calculer » .btnc du header et tout',
  '     <button> d action) — le document capture est DOCUMENTAIRE, pas interactif. Les',
  '     zones capturees (.hd/#resout/pane-d) ne contiennent aucun <button> porteur d une',
  '     valeur affichee (les controles de saisie sont dans pane-s, non capture). */',
  '  var bt=c.querySelectorAll?c.querySelectorAll("button"):[];',
  '  for(var b2=0;b2<bt.length;b2++){ if(bt[b2].parentNode) bt[b2].parentNode.removeChild(bt[b2]); }',
  '  /* GARDE §8 : retire TOUT attribut gestionnaire inline on…= (sur le noeud et ses',
  '     descendants) ET toute URI javascript: — le document capture doit etre INERTE,',
  '     conformement a assertInertHtml (apps/api/src/pv/html-guard.ts). */',
  '  var all=c.querySelectorAll?c.querySelectorAll("*"):[];',
  '  var nodes=[c]; for(var a=0;a<all.length;a++){ nodes.push(all[a]); }',
  '  for(var n=0;n<nodes.length;n++){',
  '    var nd=nodes[n]; if(!nd.attributes) continue;',
  '    for(var k=nd.attributes.length-1;k>=0;k--){',
  '      var att=nd.attributes[k], an=att.name||"", av=att.value||"";',
  '      if(an.length>=2 && an.slice(0,2).toLowerCase()==="on"){ nd.removeAttribute(an); continue; }',
  '      if(/^\\s*javascript:/i.test(av)) nd.removeAttribute(an);',
  '    }',
  '  }',
  '  /* FX-3b : remplace chaque <i class="ti …"> par un pictogramme SVG inline equivalent',
  '     (glyphe auto-suffisant sous CSP sans font-src). Collecte AVANT mutation car',
  '     outerHTML invalide le noeud remplace. Icone inconnue -> retiree (pas de case vide). */',
  '  var ics=c.querySelectorAll?c.querySelectorAll("i.ti"):[];',
  '  var iarr=[]; for(var ic2=0;ic2<ics.length;ic2++){ iarr.push(ics[ic2]); }',
  '  for(var ix=0;ix<iarr.length;ix++){ var iel=iarr[ix]; if(!iel.parentNode) continue;',
  '    var isvg=__roadsensIconSvg(iel.className||"", (iel.getAttribute?iel.getAttribute("style"):"")||"");',
  '    if(isvg){ iel.outerHTML=isvg; } else { iel.parentNode.removeChild(iel); } }',
  '  return c.outerHTML||"";',
  '}',
  '/* Document IMPRIMABLE auto-contenu = en-tete .hd + zones .printable (pane-r + pane-d),',
  '   avec TOUT le CSS de l outil inline (styles ecran + regles @media print) -> impression',
  '   identique HORS de l app. On ajoute une seule regle ecran (.pane.printable{display:block})',
  '   pour que le document reste aussi CONSULTABLE a l ecran (les .pane sont display:none par defaut). */',
  'function __roadsensSerializePrintable(){',
  '  var styles="";',
  '  var sl=document.querySelectorAll("style");',
  '  for(var i=0;i<sl.length;i++){ styles += (sl[i].textContent||"") + "\\n"; }',
  '  styles += "\\n.pane.printable{display:block !important}\\n";',
  '  var hd=__roadsensCloneClean(document.querySelector(".hd"), false);',
  '  var pr=__roadsensCloneClean(document.getElementById("pane-r"), true);',
  '  var pd=__roadsensCloneClean(document.getElementById("pane-d"), true);',
  '  return "<!doctype html><html lang=\\"fr\\"><head><meta charset=\\"utf-8\\">"',
  '    + "<meta name=\\"viewport\\" content=\\"width=device-width, initial-scale=1\\">"',
  '    + "<title>ROADSENS \\u2014 Rapport de v\\u00e9rification Burmister</title>"',
  '    + "<style>" + styles + "</style></head><body><main class=\\"app\\">"',
  '    + hd + pr + pd',
  '    + "</main></body></html>";',
  '}',
  '/* FX-2 : APERCU auto-contenu du panneau de resultats (#resout), BORNE a resout',
  '   (ni pane-r ni pane-d). Meme patron que __roadsensSerializePrintable : on agrege',
  '   TOUT le CSS de l outil (les cartes de #resout sont stylees par des classes globales',
  '   .card/.note/.metric… + var(--…)) et on enveloppe dans un document <!doctype>. Sans',
  '   cela, l outerHTML NU de #resout perdait ses styles (var(--…) non definies dans l',
  '   iframe sandbox de l onglet Calculs) et rendait en texte decompose. */',
  'function __roadsensSerializeDisplay(){',
  '  var styles="";',
  '  var sl=document.querySelectorAll("style");',
  '  for(var i=0;i<sl.length;i++){ styles += (sl[i].textContent||"") + "\\n"; }',
  '  var ro=__roadsensCloneClean(document.getElementById("resout"), false);',
  '  return "<!doctype html><html lang=\\"fr\\"><head><meta charset=\\"utf-8\\">"',
  '    + "<meta name=\\"viewport\\" content=\\"width=device-width, initial-scale=1\\">"',
  '    + "<title>ROADSENS \\u2014 Aper\\u00e7u des r\\u00e9sultats</title>"',
  '    + "<style>" + styles + "</style></head><body><main class=\\"app\\">"',
  '    + ro',
  '    + "</main></body></html>";',
  '}',
  '/* Emet snapshot:capture APRES le rendu (jamais avant). displayHtml = document',
  '   auto-contenu du panneau de resultats (resout, stylé) ; printHtml = rapport',
  '   imprimable auto-contenu (.hd + pane-r + pane-d). */',
  'function __roadsensCaptureSnapshot(){',
  '  try{',
  '    if(!window.__geofamBridge || typeof window.__geofamBridge.snapshot!=="function") return;',
  '    var displayHtml=__roadsensSerializeDisplay();',
  '    var printHtml=__roadsensSerializePrintable();',
  '    window.__geofamBridge.snapshot(displayHtml, printHtml);',
  '  }catch(e){}',
  '}',
  '',
  "/* Echappement HTML minimal (messages d'erreur). */",
  'function _esc(s){ return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }',
  '/* Nombre fini de la sortie serveur, sinon NaN (affichage « — » côté renderers). */',
  'function _bn(v){ return (v===null||v===undefined||(typeof v==="number"&&(isNaN(v)||!isFinite(v))))?NaN:+v; }',
  '/* kPa (sortie serveur) -> MPa (unité interne des renderers ; ils ré-appliquent ×1000). */',
  'function _kpa2mpa(v){ return (v==null||isNaN(v))?NaN:(+v)/1000; }',
  '/* Fin du paquet lié (bitEnd) : 1er indice non lié — recalculé depuis le STATE via les',
  '   drapeaux bit/rig CONSERVÉS de M (aucune science ; classification de matériau publique). */',
  'function bitEndFromState(){ var be=ly.length; for(var i=0;i<ly.length;i++){ var m=M[ly[i].mat]; if(m&&!m.bit&&!m.rig){ be=i; break; } } return be; }',
  '',
  '/* PLAUSIBILITÉ (no-calc-initial) : bornes du contrat (Modulus/Poisson/Thickness). */',
  'function plausibleBurmister(){',
  '  if(typeof ly==="undefined" || !Array.isArray(ly) || ly.length<1) return false;',
  '  for(var i=0;i<ly.length;i++){ var l=ly[i]; if(!l) return false;',
  '    if(!(isFinite(l.E)&&+l.E>=1&&+l.E<=60000)) return false;',
  '    if(!(isFinite(l.nu)&&+l.nu>=0.1&&+l.nu<=0.5)) return false;',
  '    if(!(isFinite(l.h)&&+l.h>=0.001&&+l.h<=2)) return false; }',
  '  if(!(typeof pf!=="undefined"&&pf&&isFinite(pf.E)&&+pf.E>=1&&+pf.E<=60000)) return false;',
  '  if(!(isFinite(pf.nu)&&+pf.nu>=0.1&&+pf.nu<=0.5)) return false;',
  '  if(!(typeof cp!=="undefined"&&cp&&isFinite(cp.p)&&+cp.p>0&&isFinite(cp.a)&&+cp.a>0)) return false;',
  '  return true;',
  '}',
  '',
  '/* STATE (ly/pf/tr/cp) -> BurmisterInputSchema (nombres bornés ; overrides r/sh/ks',
  "   'auto' ou valeur ; iface imposée -> ifaceAuto=true ; NE direct -> neForce). Les E",
  '   GNT auto sont déjà résolus par runCalc (gntAuto NON transmis). */',
  'function buildBurmisterInput(){',
  '  var layers=ly.map(function(l){ var o={mat:String(l.mat),E:+l.E,nu:+l.nu,h:+l.h}; if(l.ifc&&l.ifc!=="auto") o.iface=l.ifc; return o; });',
  '  var subgrade={ E:+pf.E, nu:+pf.nu }; if(pf.cls) subgrade.cls=String(pf.cls);',
  '  var traffic={ T:+tr.T, C:+tr.C, N:+tr.N, tau:+tr.tau, dir:+tr.dir, tv:+tr.tv };',
  '  var load={ p:+cp.p, a:+cp.a, d:+cp.d };',
  '  if(cp.r!=null) load.r=(cp.r==="auto")?"auto":+cp.r;',
  '  if(cp.sh!=null) load.sh=(cp.sh==="auto")?"auto":+cp.sh;',
  '  if(cp.ks!=null) load.ks=(cp.ks==="auto")?"auto":+cp.ks;',
  '  if(ly.some(function(l){return l.ifc&&l.ifc!=="auto";})) load.ifaceAuto=true;',
  '  if(cp.neForce!=null && isFinite(cp.neForce) && +cp.neForce>0) load.neForce=+cp.neForce;',
  '  var inp={ layers:layers, subgrade:subgrade, traffic:traffic, load:load };',
  '  var pj=(typeof S!=="undefined"&&S&&S.projet)?S.projet:null; if(pj) inp.projet=String(pj);',
  '  return inp;',
  '}',
  '',
  '/* SORTIE WHITELISTÉE (BurmisterOutputSchema) -> objet global `_D` attendu par',
  '   renderDetails ET par renderRes (via rArgFromOutput). Aucune science : lecture de',
  '   champs whitelistés + rejeu du STATE. Les intermédiaires NON whitelistés (stC/stG,',
  '   axe/mid ε_z) restent `undefined` -> les renderers affichent « — » (résidu fermé). */',
  'function buildDFromOutput(out){',
  '  var det=out.details||{};',
  '  var fat=out.fatigue||null;',
  '  var orn=out.ornierage||null;',
  '  var ph2=out.fatiguePhase2||null;',
  '  var inv=out.fatigueInverse||null;',
  '  var useRig = fat ? (fat.rigide===true) : false;',
  '  /* etRequis (affiché renderDetails l.1518) DÉRIVÉ sans champ supplémentaire :',
  '     bitumineux -> fatigue.requis (= useRig||etReq, or useRig=false) ; mixte -> ph2.requis',
  '     (= D.etReq) ; rigide/semi-rigide/inverse/granulaire -> false (ε_t non exigé). */',
  '  var etReq;',
  '  if(fat && useRig===false) etReq = (fat.requis===true);',
  '  else if(ph2) etReq = (ph2.requis===true);',
  '  else etReq = false;',
  '  var s0={ sz:_kpa2mpa(det.sigmaZ_r0), sr:_kpa2mpa(det.sigmaR_r0) };',
  '  var sd2={ sz:_kpa2mpa(det.sigmaZ_d2), sr:_kpa2mpa(det.sigmaR_d2) };',
  '  var bz={ sz:_kpa2mpa(det.sigmaZ_psc_kpa), sr:_kpa2mpa(det.sigmaR_psc_kpa) };',
  '  var rigL=(Array.isArray(out.couchesTraitees)?out.couchesTraitees:[]).map(function(r){',
  '    return { i:(_bn(r.couche)>=1?r.couche-1:0), mode:r.mode, st:_bn(r.valeur), adm:_bn(r.admissible), stC:undefined, stG:undefined }; });',
  '  var ezL=(Array.isArray(out.couchesGranulaires)?out.couchesGranulaires:[]).map(function(r){',
  '    return { i:(_bn(r.couche)>=1?r.couche-1:0), val:_bn(r.valeur), axe:undefined, mid:undefined }; });',
  '  var gq = (Array.isArray(out.couchesGranulaires)&&out.couchesGranulaires.length) ? (out.couchesGranulaires[0].requis===true) : false;',
  '  _D={',
  '    NE:_bn(out.NE), H_bit:_bn(out.epaisseurLiee), H_tot:_bn(out.epaisseurTotale),',
  '    E1:(isFinite(det.E1_pond)?+det.E1_pond:0), nu1:(isFinite(det.nu1_pond)?+det.nu1_pond:0),',
  '    Eref:(isFinite(det.E_psc)?+det.E_psc:0), nuRef:(isFinite(det.nu_psc)?+det.nu_psc:0),',
  '    et:(fat&&fat.valeur!=null?+fat.valeur:null), etA:(fat&&fat.admissible!=null?+fat.admissible:null),',
  '    et0:(det.epsilonT_r0!=null?+det.epsilonT_r0:null), etM:(det.epsilonT_d2!=null?+det.epsilonT_d2:null),',
  '    s0:s0, sd2:sd2, bz:bz,',
  '    ez:_bn(orn?orn.valeur:det.epsilonZ), ez0:(det.epsilonZ_axe!=null?+det.epsilonZ_axe:null), ezM:(det.epsilonZ_mid!=null?+det.epsilonZ_mid:null),',
  '    ezA:_bn(orn?orn.admissible:det.epsilonZ_adm),',
  '    passT:(fat?fat.ok===true:true), passZ:(orn?orn.ok===true:false), PASS:(out.conforme===true), hasBit:!!fat,',
  '    e6:(fat&&fat.referenceCatalogue!=null)?+fat.referenceCatalogue:Infinity,',
  '    ub:(det.ub!=null?+det.ub:null), ukc:(det.kc!=null?+det.kc:null), usn:(det.sn!=null?+det.sn:null), ukth:(det.ktheta!=null?+det.ktheta:null), sig:(useRig?1:0),',
  '    kr:(det.kr!=null?+det.kr:null), sh:(det.sh_cm!=null?+det.sh_cm:null), ks:(det.ks!=null?+det.ks:null),',
  // adm_r50 (et_adm/st_adm a r=50 %, kr=1) SERVI par le serveur (BurmisterOutputSchema.details.adm_r50)
  // -> AFFICHE tel quel par renderDetails (patchText remplace la RE-DERIVATION cliente e50 par d.adm50 ;
  // condition §8 titulaire : toute valeur AFFICHEE vient du serveur, jamais d'un recalcul navigateur).
  '    adm50:(det.adm_r50!=null?+det.adm_r50:null),',
  '    be:bitEndFromState(), ezL:ezL, gq:gq,',
  '    et2:(ph2?_bn(ph2.valeur):null), et2A:(ph2?_bn(ph2.admissible):null), et2i:(ph2&&_bn(ph2.couche)>=1?ph2.couche-1:-1),',
  '    st2:(inv?_bn(inv.valeur):null), st2A:(inv?_bn(inv.admissible):null), st2i:(inv&&_bn(inv.couche)>=1?inv.couche-1:-1),',
  '    rEff:(isFinite(det.risque_pct)?+det.risque_pct:0), fam:(typeof out.famille==="string"?out.famille:""), etReq:etReq, rigL:rigL,',
  '    lys:JSON.parse(JSON.stringify(ly)),',
  '    pfs:{cls:pf.cls,E:pf.E,nu:pf.nu},',
  '    cps:{p:cp.p,a:cp.a,d:cp.d,r:cp.r},',
  '    trs:{T:tr.T,C:tr.C,N:tr.N,tau:tr.tau}',
  '  };',
  '  return _D;',
  '}',
  '',
  '/* Argument de renderRes (mêmes noms que la déstructuration l.1334) — lu depuis `_D`',
  '   déjà reconstruit (buildDFromOutput doit précéder). */',
  'function rArgFromOutput(out){',
  '  var d=_D;',
  '  return { NE:d.NE, H_bit:d.H_bit, H_tot:d.H_tot, E1_eq:d.E1, nu1_eq:d.nu1,',
  '    et_val:d.et, et_adm:d.etA, et_r0:d.et0, et_rd2:d.etM, s0:d.s0, sd2:d.sd2,',
  '    ez_val:d.ez, ez_adm:d.ezA, passT:d.passT, passZ:d.passZ, PASS:d.PASS, hasBit:d.hasBit,',
  '    sig:d.sig, ezL:d.ezL, gq:d.gq, et2_val:d.et2, et2_adm:d.et2A, et2_i:d.et2i,',
  '    st2_val:d.st2, st2_adm:d.st2A, st2_i:d.st2i, fam:d.fam, etReq:d.etReq, rigL:d.rigL };',
  '}',
  '',
  '/* NO-CALC-INITIAL : structure invalide -> message local, AUCUN appel serveur. */',
  'function renderNeedInput(){',
  "  var el=document.getElementById('resout');",
  '  if(el) el.innerHTML=\'<div class="note note-a" style="margin-top:1rem">Renseignez une structure valide (couches avec E, \\u03bd, h) et la plateforme support avant de lancer le calcul.</div>\';',
  "  var d=document.getElementById('detout'); if(d) d.innerHTML='';",
  '}',
  "/* Erreur métier (402/403) ou de pont -> zone résultats (fidélité : affichée par l'outil). */",
  'function renderCalcError(err){',
  '  var msg=(err&&err.message)?err.message:"Calcul indisponible.";',
  '  var reason=(err&&err.reason)?" ("+err.reason+")":"";',
  "  var el=document.getElementById('resout');",
  '  if(el) el.innerHTML=\'<div class="note note-a" style="margin-top:1rem"><strong>Calcul indisponible.</strong><br>\'+_esc(msg+reason)+\'</div>\';',
  "  var d=document.getElementById('detout'); if(d) d.innerHTML='';",
  '}',
  'function _restoreCalcBtn(){',
  "  var btn=document.getElementById('btnc');",
  '  if(btn){ btn.disabled=false; btn.innerHTML=\'<i class="ti ti-calculator" style="font-size:16px"></i>Calculer\'; }',
  '}',
  'function _gotoResults(){',
  "  document.querySelectorAll('.tbtn').forEach(function(x){x.classList.remove('on');});",
  "  document.querySelectorAll('.pane').forEach(function(x){x.classList.remove('on');});",
  "  var rb=document.querySelector('[data-tab=\"r\"]'); if(rb) rb.classList.add('on');",
  "  var rp=document.getElementById('pane-r'); if(rp) rp.classList.add('on');",
  '}',
  '/* =================== FIN BRIDGE + MAPPING =================== */',
].join('\n');

// ===========================================================================
// GEOPLAQUE — radier / plaque sur sol multicouche (EF), 4 solveurs (ADR 0015).
// ---------------------------------------------------------------------------
// L'outil est un EDITEUR CAO plein ecran (canvas, tool-rail 11 outils, ligne de
// commande, onglets Modele/Sol/Proprietes/Resultats/2D, carto isovaleurs). On
// CONSERVE la couche CAO INTEGRALE et on EXCISE les 4 solveurs EF + toute la
// science d'assemblage / integration / algebre dense :
//   - solveModel (radier ACM) · solvePlaneStrain (bande) · solveAxi (annulaire) ·
//     solveTriRaft (DKT) ; solveDense (LU), inv/transpose/matMul (algebre) ;
//   - noyaux de tassement Steinbrenner/Boussinesq (steinG/cornerSettle/rectSettle/
//     strip*) et axisymetriques (ellipKE/I1I3axi/fCircAxi/sAnn*/cornerAxi) ;
//   - matrices elementaires (beamKe/annKe/dktKe/buildACM) et maillage triangulaire
//     (triArea/earClip/refine1to4/meshPoly/_triBary/_distribTri).
// Les 4 modes passent par le bridge avec un engineId DIFFERENT (liste FERMEE
// {radier, plane-strain, axi, tri-raft} = slugs du dispatch tenant). Le rendu
// carto/2D est REBRANCHE sur les structures SERVEUR whitelistees : grilles 48x48
// re-echantillonnees (champs/champDeflexion) et profils 97 points (plane/axi) —
// JAMAIS de valeurs nodales, d'indices de nœuds ni de connectivite de maillage.
//
// UNITE E (frontiere contrat) : l'outil d'origine STOCKE E en kPa (raft 1e7,
// couches 2e4, 2D 3e7 ; affiche /1000 en MPa cf. printReport). Le contrat serveur
// attend des MPa (cf. en-tete des contrats radier/axi et l'ancien adaptateur React
// `E: num(f.E, 30000)` sur un formulaire en MPa). buildRadierInput/_layersMPa/les
// handlers 2D DIVISENT donc E par 1000 (kPa->MPa) — pure reconciliation d'unite de
// SAISIE, aucune science. Consequence : la sortie serveur des tassements est en
// mm-echelle (piege d'unite deja tranche, memoire radier-units).
//
// AFFICHAGE = COPIE DE L'OUTIL CLIENT (decision titulaire 15/07, re-confirmee 17/07 ;
// RENVERSE la decision « physiquement juste » du 01/07) : le clone REPREND A L'IDENTIQUE
// les expressions d'affichage de GEOPLAQUE_V10, DEFAUTS COMPRIS. Les tassements sont donc
// AFFICHES AVEC le x1000 de l'outil d'origine (sur-rapport « ne pas corriger » : on COPIE)
// — refreshResults l.2560/2595, printReport l.1330/1353, panneaux 2D ps/ax/tri (wMax*1000)
// et legendes de profils (wmm=v*1000). La VALEUR NUMERIQUE serveur reste inchangee ; SEULE
// la couche d'affichage du clone applique le x1000. Les distorsions/rotations/pentes sont
// rendues CRUES (ratio1 + valeur brute « rad », sans conversion) comme l'outil client. Les
// autres grandeurs (moments/reactions/EI/ratios) sont rendues telles quelles.
// La FIDELITE DE LA GRILLE (carto : champs/champDeflexion) reste INCHANGEE = valeurs
// serveur brutes (aucun x1000 sur les cellules ; seules les legendes texte suivent l'outil).
//
// MASQUAGES §8 assumes cote clone (exception #54 + intermediaires non whitelistes) :
//   - localisations de nœuds (S max/S min/β max, segments *At) -> marqueurs critiques
//     et notes de localisation OMIS (drawCritical reduit au couple de charges
//     whiteliste worstLoadPair, coords SAISIES) ;
//   - « Nœuds de calcul » N et « nt triangles » (compte de maillage) -> non affiches ;
//   - tableau COMPLET des paires de charges voisines (loadPairs.edges) -> seule la
//     pire paire whitelistee (worstLoadPair) est affichee ;
//   - « Nœuds plastifies » (plastNodes) -> non affiche (hors whitelist).
//   Ces ecarts sont documentes (audit geoplaque-ecarts-ui-v2 E5/E15/E16/E30/F14) ;
//   leur re-exposition = decision titulaire + expert (hors perimetre de ce clone).
// ===========================================================================

/** Symboles MOTEUR (science EF confidentielle) SUPPRIMES + INTERDITS a l'audit. */
const GEOPLAQUE_ENGINE_SYMBOLS = [
  'solveModel',
  'solvePlaneStrain',
  'solveAxi',
  'solveTriRaft',
  'solveDense',
  'buildACM',
  'inv',
  'transpose',
  'matMul',
  'steinG',
  'cornerSettle',
  'rectSettle',
  'stripFactor',
  'stripEdgeCum',
  'stripSettle',
  'beamKe',
  'ellipKE',
  'I1I3axi',
  'fCircAxi',
  'sAnnDepth',
  'sAnnSurf',
  'cornerAxi',
  'annKe',
  'dktKe',
  'triArea',
  'earClip',
  'refine1to4',
  'meshPoly',
  '_triBary',
  '_distribTri',
];

/** Bridge multi-mode + helpers de mapping (injecte apres l'ancre du bloc UI). */
const GEOPLAQUE_BRIDGE_AND_SHIM = [
  '/* ===================== BRIDGE (multi-mode) + MAPPING (injecté — clone excisé, ADR 0015) ===================== */',
  '(function(){',
  '  var TOOL_ID="geoplaque";',
  '  var pending=Object.create(null), seq=0;',
  '  var ctx={ engineId:"radier", orgSlug:null, projectLabel:null, readOnly:false };',
  '  function post(msg){ try{ window.parent.postMessage(msg,"*"); }catch(e){} }',
  '  window.addEventListener("message", function(ev){',
  '    if(ev.source !== window.parent) return;',
  '    var d=ev.data; if(!d || d.v!==1 || typeof d.type!=="string") return;',
  '    if(d.type==="init"){ ctx=Object.assign(ctx, d.payload||{}); return; }',
  '    if(d.type==="calc:response"){ var p=pending[d.id]; if(!p) return; delete pending[d.id]; p(d.payload||{ok:false,error:{message:"réponse vide"}}); return; }',
  '  });',
  '  /* calc(engineId, params) : engineId choisi par le MODE (liste fermée validée côté hôte',
  "     via engineAllowlist ; l'hôte rejette tout id hors liste sans appeler l'API). */",
  '  window.__geofamBridge={',
  '    calc:function(engineId, params){ var id=TOOL_ID+":"+(++seq); return new Promise(function(resolve){ pending[id]=resolve; post({v:1,type:"calc:request",id:id,payload:{engineId:engineId,label:(params&&params.projet)||null,params:params}}); }); },',
  '    emitPv:function(calcResultId){ post({v:1,type:"pv:request",payload:{calcResultId:calcResultId}}); },',
  '    context:function(){ return ctx; }',
  '  };',
  '  /* input:dirty (correctif PV BQ-1) : signale a l hote que l ecran a change apres un calcul',
  '     -> le bouton d emission du PV scelle se desactive jusqu au prochain calcul (evite un PV perime).',
  '     Emission IMMEDIATE (front de montee), NON debouncee : le bouton doit se desactiver des la 1re frappe.',
  '     Throttle ~1/frame par FLAG booleen (aucun delai temporel sur l emission) pour ne pas inonder l hote,',
  '     lui-meme idempotent. Listener DELEGUE au document (capture) : generique, sans connaitre le DOM de l outil.',
  '     Cible input/change uniquement (la donnee A change) — PAS click : naviguer entre onglets de',
  '     resultats ne change pas le calcul affiche (sinon on desactiverait le PV a tort). Un changement de',
  '     mode de calcul sans recalcul reste couvert cote hote : ce mode n a pas de calcResultId. */',
  '  var __geofamDirtyFrame=false;',
  '  function __geofamEmitDirty(){ if(__geofamDirtyFrame) return; __geofamDirtyFrame=true; post({v:1,type:"input:dirty",payload:{toolId:TOOL_ID}}); var __raf=(typeof requestAnimationFrame==="function")?requestAnimationFrame:function(f){setTimeout(f,0);}; __raf(function(){ __geofamDirtyFrame=false; }); }',
  '  document.addEventListener("input", __geofamEmitDirty, true);',
  '  document.addEventListener("change", __geofamEmitDirty, true);',
  '  post({v:1,type:"ready",payload:{toolId:TOOL_ID}});',
  '})();',
  '',
  '/* --- helpers de mapping (aucune science : lecture de champs whitelistés + rejeu du STATE) --- */',
  'function _esc(s){ return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }',
  'function _gerr(e){ if(!e) return "Réponse de calcul vide."; if(typeof e==="string") return e; var m=e.message||"Calcul indisponible."; var r=e.reason?(" ("+e.reason+")"):""; return _esc(m+r); }',
  'function _gn(v){ return (v===null||v===undefined||(typeof v==="number"&&(isNaN(v)||!isFinite(v))))?NaN:+v; }',
  "/* kPa (saisie interne de l'outil) -> MPa (frontière du contrat serveur). */",
  'function _E(v){ var n=+v; return isFinite(n)? n/1000 : n; }',
  "/* Couches -> forme contrat (E converti kPa->MPa) ; nom omis (echo d'affichage). */",
  'function _layersMPa(){ return (state.layers||[]).map(function(l){ return { zBase:+l.zBase, E:_E(l.E), nu:+l.nu }; }); }',
  "/* Suffixe « équilibre ✓ / x % » identique à l'outil d'origine. */",
  'function _eqSuffix(total,react){ var eqp=total?Math.abs(react-total)/Math.abs(total)*100:0; return "  ("+(eqp<0.01?"équilibre ✓":eqp.toFixed(2)+" %")+")"; }',
  '',
  '/* Champ client -> clé de carte serveur (contrat radier `champs`). */',
  'var CHAMP_KEY={ w:"deflexion", p:"reaction", Mx:"momentX", My:"momentY", Mxy:"momentXY", kr:"raideur", tx:"rotationX", ty:"rotationY", slope:"pente" };',
  "/* Table marching-squares (identique à l'outil d'origine). */",
  'var MS_TBL={1:[["L","B"]],2:[["B","R"]],3:[["L","R"]],4:[["R","T"]],5:[["L","B"],["R","T"]],6:[["B","T"]],7:[["L","T"]],8:[["L","T"]],9:[["B","T"]],10:[["B","R"],["L","T"]],11:[["R","T"]],12:[["L","R"]],13:[["B","R"]],14:[["L","B"]]};',
  '',
  "/* Echantillonnage bilinéaire d'une grille RÉGULIÈRE serveur (cols×rows) ; null hors",
  '   contour (les cellules serveur hors radier sont déjà null). Aucune topologie EF. */',
  'function sampleGrid(g,gx,gy){',
  '  var cols=g.cols, rows=g.rows, V=g.vals;',
  '  var i=Math.floor(gx), j=Math.floor(gy);',
  '  if(i<0)i=0; if(j<0)j=0; if(i>cols-2)i=cols-2; if(j>rows-2)j=rows-2;',
  '  var v00=V[j*cols+i], v10=V[j*cols+i+1], v11=V[(j+1)*cols+i+1], v01=V[(j+1)*cols+i];',
  '  if(v00==null||v10==null||v11==null||v01==null){',
  '    var near=null,bd=1e9,cand=[[i,j],[i+1,j],[i+1,j+1],[i,j+1]];',
  '    for(var c=0;c<4;c++){ var vv=V[cand[c][1]*cols+cand[c][0]]; if(vv!=null){ var dd=Math.abs(cand[c][0]-gx)+Math.abs(cand[c][1]-gy); if(dd<bd){bd=dd;near=vv;} } }',
  '    return near;',
  '  }',
  '  var u=gx-i, v=gy-j;',
  '  return (1-u)*(1-v)*v00+u*(1-v)*v10+u*v*v11+(1-u)*v*v01;',
  '}',
  '',
  '/* STATE (rafts/loads/springs/layers) -> RadierInputSchema (E kPa->MPa). opts déjà',
  '   assemblé par doSolve (mesh + options ; 0 = inactif, accepté par le contrat). */',
  'function buildRadierInput(opts){',
  '  var inp={ rafts:(state.rafts||[]).map(function(rf){ return { pts:rf.pts.map(function(p){return {x:+p.x,y:+p.y};}), E:_E(rf.E), nu:+rf.nu, e:+rf.e }; }),',
  '    pointLoads:(state.pointLoads||[]).map(function(l){ var r={x:+l.x,y:+l.y,Fz:+l.Fz}; if(l.Mx!=null)r.Mx=+l.Mx; if(l.My!=null)r.My=+l.My; return r; }),',
  '    lineLoads:(state.lineLoads||[]).map(function(l){ return {x1:+l.x1,y1:+l.y1,x2:+l.x2,y2:+l.y2,q:+l.q}; }),',
  '    areaLoads:(state.areaLoads||[]).map(function(l){ return {x1:+l.x1,y1:+l.y1,x2:+l.x2,y2:+l.y2,q:+l.q,on:l.on}; }),',
  '    pointSprings:(state.pointSprings||[]).map(function(s){ return {x:+s.x,y:+s.y,k:+s.k}; }),',
  '    layers:_layersMPa(), opts:opts };',
  '  var ls=(state.lineSprings||[]).map(function(s){ return {x1:+s.x1,y1:+s.y1,x2:+s.x2,y2:+s.y2,k:+s.k}; });',
  '  if(ls.length) inp.lineSprings=ls;',
  '  var pj=(state.project&&state.project.title)||null; if(pj) inp.projet=String(pj);',
  '  return inp;',
  '}',
  '',
  '/* SORTIE whitelistée (RadierOutputSchema) -> `state.results` attendu par les renderers',
  '   CONSERVÉS (refreshResults/printReport/drawCritical/bakeField/drawContours). On',
  '   reconstruit `diag` à partir des SCALAIRES whitelistés (jamais de champ nodal ni de',
  '   localisation *At). Les grilles `champs`/`champDeflexion` alimentent la carto. */',
  'function mapRadierOutput(out, opts){',
  '  var wp=out.worstLoadPair||null;',
  '  var diag={',
  '    wMax:_gn(out.wMax), wMin:_gn(out.wMin), diff:_gn(out.diff),',
  '    slopeMax:_gn(out.slopeMax), tiltMax:_gn(out.tiltMax),',
  '    betaIntra:_gn(out.betaIntra), interBeta:_gn(out.betaInter), interDiff:_gn(out.interDiff),',
  '    betaGov:_gn(out.betaGov), nRafts:(out.nRafts|0),',
  '    txMax:_gn(out.txMax), tyMax:_gn(out.tyMax),',
  '    wMaxAt:null, wMinAt:null, betaGovAt:null, interEnds:null,',
  '    loadPairs: wp ? { worst:{ beta:_gn(wp.beta), ds:_gn(wp.ds), L:_gn(wp.L), ki:wp.ki, kj:wp.kj, p1:wp.p1||null, p2:wp.p2||null }, edges:[], n:0 } : null',
  '  };',
  '  var warnings=Array.isArray(out.warnings)?out.warnings.slice():[];',
  "  var overCap=warnings.some(function(w){ return /poinçonnement|capacité de l'interface/i.test(w); });",
  '  return {',
  '    diag:diag, warnings:warnings, overCap:overCap,',
  '    totalLoad:_gn(out.totalLoad), sumReact:_gn(out.sumReact),',
  '    pMin:_gn(out.pMin), pMax:_gn(out.pMax), mxMax:_gn(out.mxMax), myMax:_gn(out.myMax), mxyMax:_gn(out.mxyMax),',
  '    sumWink:(out.sumWink==null?null:_gn(out.sumWink)), sumSpr:(out.sumSpr==null?null:_gn(out.sumSpr)),',
  '    winkOn:(out.sumWink!=null), sprOn:(out.sumSpr!=null),',
  '    nSpr:(state.pointSprings||[]).length, nLine:(state.lineSprings||[]).filter(function(l){return (+l.k||0)>0;}).length,',
  '    decolNodes:(out.decolNodes==null?null:(out.decolNodes|0)),',
  '    foundOn:(opts.foundD>0), foundD:opts.foundD||0,',
  '    dipOn:((opts.dipX||0)!==0||(opts.dipY||0)!==0), dipX:opts.dipX||0, dipY:opts.dipY||0,',
  '    recOn:((opts.sigV0||0)>0 && (opts.kRec||1)>1), sigV0:opts.sigV0||0, kRec:opts.kRec||1,',
  '    champs:out.champs||null, champDeflexion:out.champDeflexion||null,',
  '    field:"w", showCrit:undefined, bakeReady:false, grid:null, isoLevels:[]',
  '  };',
  '}',
  '',
  '/* PLAUSIBILITÉ (no-calc-initial) : au moins une plaque valide + au moins une charge.',
  "   Sans quoi on N'APPELLE PAS le serveur (message local, comme le garde du handler). */",
  'function plausibleGeoplaque(){',
  '  if(!Array.isArray(state.rafts) || state.rafts.length<1) return false;',
  '  for(var i=0;i<state.rafts.length;i++){ var rf=state.rafts[i]; if(!rf||!Array.isArray(rf.pts)||rf.pts.length<3) return false; if(!(isFinite(rf.E)&&+rf.E>0)) return false; }',
  '  if(!Array.isArray(state.layers) || state.layers.length<1) return false;',
  '  var hasLoad=(state.pointLoads||[]).some(function(l){return (+l.Fz||0)!==0||(+l.Mx||0)!==0||(+l.My||0)!==0;})',
  '    || (state.lineLoads||[]).some(function(l){return (+l.q||0)!==0;})',
  '    || (state.areaLoads||[]).some(function(l){return (+l.q||0)!==0;});',
  '  return hasLoad;',
  '}',
  'function renderNeedModel(){',
  '  var b=document.getElementById("resbody"); if(b) b.innerHTML=\'<div class="empty">Dessine au moins une plaque (outil R) et une charge, puis lance le calcul.</div>\';',
  '}',
  'function renderCalcErrorMain(msg){',
  '  var b=document.getElementById("resbody");',
  '  if(b) b.innerHTML=\'<div class="empty" style="color:var(--err)"><b>Calcul indisponible.</b><br>\'+_esc(msg)+\'</div>\';',
  '}',
  '/* =================== FIN BRIDGE + MAPPING =================== */',
].join('\n');

/** doSolve() RÉÉCRIT : async, bridge (engineId radier), mapping serveur -> state.results. */
const GEOPLAQUE_DOSOLVE = [
  'async function doSolve(){',
  '  if(!plausibleGeoplaque()){ spin(false); renderNeedModel(); switchPane("results"); return; }',
  "  var _excD=parseFloat(document.getElementById('opt-exc-d').value)||0, _excG=parseFloat(document.getElementById('opt-exc-g').value)||0;",
  '  var opts={ mesh:parseFloat(document.getElementById("meshsize").value)||0.8, decol:document.getElementById("opt-decol").checked,',
  '    qLim:parseFloat(document.getElementById("opt-qlim").value)||0,',
  '    sigV0:_excD*_excG, kRec:parseFloat(document.getElementById("opt-exc-k").value)||1,',
  '    foundD:_excD,',
  '    kWink:parseFloat(document.getElementById("opt-wink").value)||0,',
  '    winkDecol:document.getElementById("opt-wink-decol").checked, pLimWink:parseFloat(document.getElementById("opt-wink-plim").value)||0,',
  '    ffG0:parseFloat(document.getElementById("opt-ff-g0").value)||0, ffGx:parseFloat(document.getElementById("opt-ff-gx").value)||0, ffGy:parseFloat(document.getElementById("opt-ff-gy").value)||0,',
  '    dipX:parseFloat(document.getElementById("opt-dip-x").value)||0, dipY:parseFloat(document.getElementById("opt-dip-y").value)||0 };',
  '  var b=document.getElementById("resbody"); if(b) b.innerHTML=\'<div class="empty">Calcul en cours…</div>\';',
  '  var resp;',
  '  try{ resp=await window.__geofamBridge.calc("radier", buildRadierInput(opts)); }',
  '  catch(e){ spin(false); renderCalcErrorMain("Pont de calcul indisponible : "+((e&&e.message)||e)); switchPane("results"); return; }',
  '  spin(false);',
  '  if(!resp||!resp.ok){ renderCalcErrorMain(_gerr(resp&&resp.error)); switchPane("results"); return; }',
  '  var out=resp.output||{};',
  '  if(out.erreur){ renderCalcErrorMain(out.erreur); switchPane("results"); return; }',
  '  window.__geoplaqueLastCalcResultId=resp.calcResultId||null;',
  '  var R=mapRadierOutput(out, opts); R.field="w"; state.results=R;',
  '  try{ bakeField("w"); }catch(e){}',
  '  switchPane("results"); refreshResults();',
  '  toast("Calcul terminé",3000,"ok");',
  '  try{ draw(); }catch(e){}',
  '}',
].join('\n');

/** runSolve() RÉÉCRIT : lance doSolve async (spinner) ; doSolve gère ses propres erreurs. */
const GEOPLAQUE_RUNSOLVE = [
  'function runSolve(){ spin(true,"Calcul serveur…"); Promise.resolve().then(doSolve).catch(function(e){ spin(false); toast("Calcul impossible : "+((e&&e.message)||e),4500,"err"); }); }',
].join('\n');

/** bakeField() RÉÉCRIT : cuit UNE tuile depuis la grille RÉGULIÈRE serveur (champs 48×48),
 * échantillonnage bilinéaire ; défensif si le canvas 2D est indisponible (jsdom/test). */
const GEOPLAQUE_BAKEFIELD = [
  'function bakeField(f){',
  '  var R=state.results; if(!R) return;',
  '  var champs=R.champs||{};',
  '  var g=champs[CHAMP_KEY[f]] || (f==="w"?R.champDeflexion:null);',
  '  R.field=f;',
  '  if(!g || !g.vals){ R.bakeReady=false; R.grid=null; bakeTiles=[]; try{ drawLegend(f); }catch(e){} return; }',
  '  R.grid=g;',
  '  var mn=isFinite(g.vMin)?g.vMin:0, mx=isFinite(g.vMax)?g.vMax:mn+1;',
  '  if(mn===mx){ mx=mn+1; }',
  '  if(isSignedField(f)){ var vmax=Math.max(Math.abs(mn),Math.abs(mx))||1; mn=-vmax; mx=vmax; }',
  '  R.fmin=mn; R.fmax=mx;',
  '  R.isoLevels=[]; for(var k=1;k<iso.n;k++) R.isoLevels.push(mn+(mx-mn)*k/iso.n);',
  '  R.bakeScale=view.scale;',
  '  bakeTiles=[];',
  '  try{',
  '    var cmap=cmapFor(f);',
  '    var dpr=Math.max(1,window.devicePixelRatio||1), SS=2, CAP=2048;',
  '    var BW=Math.min(CAP,Math.max(64,Math.round((g.x1-g.x0)*view.scale*dpr*SS)));',
  '    var BH=Math.min(CAP,Math.max(64,Math.round((g.y1-g.y0)*view.scale*dpr*SS)));',
  '    var cvs=document.createElement("canvas"); cvs.width=BW; cvs.height=BH;',
  '    var bx=cvs.getContext("2d"); if(!bx){ R.bakeReady=false; drawLegend(f); return; }',
  '    var img=bx.createImageData(BW,BH); var data=img.data;',
  '    for(var py=0;py<BH;py++){',
  '      var wy=g.y1-(py+0.5)/BH*(g.y1-g.y0);',
  '      var gyf=(g.y1>g.y0)?((wy-g.y0)/(g.y1-g.y0)*(g.rows-1)):0;',
  '      for(var px=0;px<BW;px++){',
  '        var idx=(py*BW+px)*4;',
  '        var wx=g.x0+(px+0.5)/BW*(g.x1-g.x0);',
  '        var gxf=(g.x1>g.x0)?((wx-g.x0)/(g.x1-g.x0)*(g.cols-1)):0;',
  '        var val=sampleGrid(g,gxf,gyf);',
  '        if(val==null){ data[idx+3]=0; continue; }',
  '        var t=(val-R.fmin)/(R.fmax-R.fmin);',
  '        if(iso.bands){ t=(Math.floor(Math.max(0,Math.min(0.999999,t))*iso.n)+0.5)/iso.n; }',
  '        var rgb=cmap(t);',
  '        data[idx]=rgb[0]; data[idx+1]=rgb[1]; data[idx+2]=rgb[2]; data[idx+3]=235;',
  '      }',
  '    }',
  '    bx.putImageData(img,0,0);',
  '    bakeTiles.push({canvas:cvs,X0:g.x0,Y0:g.y0,X1:g.x1,Y1:g.y1});',
  '    R.bakeReady=true;',
  '  }catch(e){ R.bakeReady=false; }',
  '  try{ drawLegend(f); }catch(e){}',
  '}',
].join('\n');

/** drawContours() RÉÉCRIT : marching squares sur la grille RÉGULIÈRE serveur (R.grid). */
const GEOPLAQUE_DRAWCONTOURS = [
  'function drawContours(R){',
  '  if(!R.isoLevels||!R.isoLevels.length||!R.grid) return;',
  '  var g=R.grid, cols=g.cols, rows=g.rows, V=g.vals;',
  '  var path=new Path2D();',
  '  function cw(gx,gy){ return { x:g.x0+gx/(cols-1)*(g.x1-g.x0), y:g.y0+gy/(rows-1)*(g.y1-g.y0) }; }',
  '  for(var j=0;j<rows-1;j++){ for(var i=0;i<cols-1;i++){',
  '    var c00=V[j*cols+i], c10=V[j*cols+i+1], c11=V[(j+1)*cols+i+1], c01=V[(j+1)*cols+i];',
  '    if(c00==null||c10==null||c11==null||c01==null) continue;',
  '    var lo=Math.min(c00,c10,c11,c01), hi=Math.max(c00,c10,c11,c01);',
  '    for(var li=0;li<R.isoLevels.length;li++){ var L=R.isoLevels[li];',
  '      if(L<lo||L>hi) continue;',
  '      var ci=(c00>=L?1:0)|(c10>=L?2:0)|(c11>=L?4:0)|(c01>=L?8:0);',
  '      var segs=MS_TBL[ci]; if(!segs) continue;',
  '      var pOn=function(e){ var t,a,b;',
  '        if(e==="B"){ t=(L-c00)/(c10-c00); a=cw(i,j); b=cw(i+1,j); }',
  '        else if(e==="R"){ t=(L-c10)/(c11-c10); a=cw(i+1,j); b=cw(i+1,j+1); }',
  '        else if(e==="T"){ t=(L-c01)/(c11-c01); a=cw(i,j+1); b=cw(i+1,j+1); }',
  '        else { t=(L-c00)/(c01-c00); a=cw(i,j); b=cw(i,j+1); }',
  '        if(!isFinite(t)) t=0; return w2s(a.x+(b.x-a.x)*t, a.y+(b.y-a.y)*t); };',
  '      for(var s=0;s<segs.length;s++){ var pa=pOn(segs[s][0]), pb=pOn(segs[s][1]); path.moveTo(pa.x,pa.y); path.lineTo(pb.x,pb.y); }',
  '    }',
  '  }}',
  '  ctx.save(); ctx.lineJoin="round"; ctx.lineCap="round";',
  '  ctx.strokeStyle="rgba(255,255,255,.32)"; ctx.lineWidth=2.6; ctx.stroke(path);',
  '  ctx.strokeStyle="rgba(12,14,18,.62)"; ctx.lineWidth=1; ctx.stroke(path);',
  '  ctx.restore();',
  '}',
].join('\n');

/** drawCritical() RÉÉCRIT : réduit au couple de charges whitelisté (worstLoadPair, coords
 * SAISIES). Les marqueurs S max/S min/β max et segments *At (localisations de nœuds EF)
 * sont OMIS — exception §8 #54 (masquage acté). */
const GEOPLAQUE_DRAWCRITICAL = [
  'function drawCritical(){',
  '  var R=state.results; if(!R||!R.diag||R.showCrit===false) return;',
  '  var d=R.diag;',
  '  if(d.loadPairs && d.loadPairs.worst && d.loadPairs.worst.p1 && d.loadPairs.worst.p2){',
  '    var w=d.loadPairs.worst, A=w.p1, B=w.p2;',
  '    var a=w2s(A.x,A.y), b=w2s(B.x,B.y);',
  '    ctx.save(); ctx.strokeStyle="#c98cff"; ctx.lineWidth=2; ctx.setLineDash([7,4]);',
  '    ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke(); ctx.setLineDash([]);',
  '    var mx=(a.x+b.x)/2, my=(a.y+b.y)/2, txt="P"+w.ki+"–P"+w.kj+" · "+ratio1(w.beta);',
  '    ctx.font="bold 10.5px "+getCss("--mono");',
  '    var tw=ctx.measureText(txt).width;',
  '    ctx.fillStyle="rgba(13,15,18,.82)"; ctx.fillRect(mx-tw/2-5,my-9,tw+10,16);',
  '    ctx.fillStyle="#c98cff"; ctx.textAlign="center"; ctx.fillText(txt,mx,my+3); ctx.textAlign="left";',
  '    ctx.restore();',
  '  }',
  '}',
].join('\n');

/** refreshResults() RÉÉCRIT : rend cartographie + EC7 + synthèse depuis les SCALAIRES
 * whitelistés (jamais de champ nodal ni de localisation de nœud). Tassements AVEC ×1000
 * (COPIE de l'affichage de l'outil client, défaut de sur-rapport inclus — décision
 * titulaire 15/07 re-confirmée 17/07 ; cf. en-tête UNITE E). Masquages §8 documentés inline. */
const GEOPLAQUE_REFRESHRESULTS = [
  'function refreshResults(){',
  '  var b=document.getElementById("resbody"); var R=state.results;',
  '  if(!R || !R.diag){ if(b && !(R&&R.__err)) b.innerHTML=\'<div class="empty">Lance un calcul pour afficher les résultats.</div>\'; return; }',
  '  var fields=[["w","Tassement"],["slope","Distorsion |∇w|"],["tx","Rotation θx"],["ty","Rotation θy"],["p","Réaction"],["kr","Coef. réaction"],["Mx","Moment Mx"],["My","Moment My"],["Mxy","Moment Mxy"]];',
  '  var h=\'<div class="secth">Cartographie</div><div class="res-field">\';',
  '  fields.forEach(function(fn){ h+=\'<button data-f="\'+fn[0]+\'" class="\'+(R.field===fn[0]?"on":"")+\'">\'+fn[1]+\'</button>\'; });',
  '  h+="</div>";',
  '  h+=\'<label class="toggle" style="margin:4px 0 2px"><input type="checkbox" id="opt-iso" \'+(iso.lines?"checked":"")+\'> Lignes d\\u2019isovaleurs</label>\';',
  '  h+=\'<label class="toggle" style="margin:2px 0"><input type="checkbox" id="opt-bands" \'+(iso.bands?"checked":"")+\'> Remplissage par plages (paliers)</label>\';',
  '  h+=\'<label class="field" style="display:flex;align-items:center;gap:8px;margin:4px 0 2px"><span style="margin:0;flex:1">Nombre de niveaux</span><select id="opt-nlev" style="width:78px">\'+[6,8,10,12,16,20,24].map(function(v){return \'<option value="\'+v+\'" \'+(iso.n===v?"selected":"")+\'>\'+v+\'</option>\';}).join("")+\'</select></label>\';',
  '  h+=\'<label class="toggle" style="margin:6px 0 2px"><input type="checkbox" id="opt-crit" \'+(R.showCrit===false?"":"checked")+\'> Marquer le couple de charges le plus défavorable</label>\';',
  '  var d=R.diag;',
  '  var wmaxmm=d.wMax*1000, diffmm=d.diff*1000;',
  '  var betaGov=d.betaGov, tilt=d.tiltMax;',
  '  h+=\'<div class="secth" style="margin-top:14px">Vérifications · EC7 annexe H</div>\';',
  '  h+=chk("Tassement total max", wmaxmm.toFixed(1)+" mm", lvlSettle(wmaxmm), "repère \\u2248 50 mm pour fondations isolées");',
  '  h+=chk("Tassement différentiel", diffmm.toFixed(1)+" mm", lvlDiff(diffmm), "repère \\u2248 20 mm entre appuis adjacents");',
  '  h+=chk("Distorsion angulaire β", ratio1(betaGov)+"  ("+betaGov.toExponential(1)+" rad)", lvlBeta(betaGov), "rotation relative · limite ELS \\u2248 1/500, ELU \\u2248 1/150");',
  '  h+=chk("Inclinaison d\\u2019ensemble ϖ", ratio1(tilt), tilt<=1/500?"ok":tilt<=1/150?"warn":"bad", "basculement rigide (séparé de la distorsion) · visible vers 1/500");',
  '  if(d.nRafts>1) h+=chk("Distorsion entre plaques", ratio1(d.interBeta)+"  · Δs "+(d.interDiff*1000).toFixed(1)+" mm", lvlBeta(d.interBeta), "rotation relative entre centres de plaques voisines");',
  '  var lp=d.loadPairs;',
  '  if(lp && lp.worst){ var w=lp.worst;',
  '    h+=chk("Distorsion entre charges (max)", ratio1(w.beta)+"  · Δs "+(w.ds*1000).toFixed(1)+" mm / "+w.L.toFixed(2)+" m", lvlBeta(w.beta), "colonnes adjacentes les plus défavorables : charge "+w.ki+" \\u2194 "+w.kj); }',
  '  h+=\'<div class="secth" style="margin-top:16px">Synthèse</div>\';',
  "  var st=function(a,v){ return '<div class=\"stat\"><span>'+a+'</span><b>'+v+'</b></div>'; };",
  '  if(d.nRafts>1) h+=st("Plaques modélisées", d.nRafts);',
  '  h+=st("Tassement max / min", wmaxmm.toFixed(1)+" / "+(d.wMin*1000).toFixed(1)+" mm");',
  '  h+=st("Rotation θx max", d.txMax.toExponential(2)+" rad  ("+ratio1(d.txMax)+")");',
  '  h+=st("Rotation θy max", d.tyMax.toExponential(2)+" rad  ("+ratio1(d.tyMax)+")");',
  '  h+=st("Pente locale max |∇w|", d.slopeMax.toExponential(2)+" rad  ("+ratio1(d.slopeMax)+")");',
  '  h+=st("Réaction p (min/max)", sci(R.pMin)+" / "+sci(R.pMax)+" kPa");',
  '  h+=st("|Mx| / |My| max", (R.mxMax).toFixed(1)+" / "+(R.myMax).toFixed(1)+" kN·m/ml");',
  '  h+=st("|Mxy| max (torsion)", (R.mxyMax).toFixed(1)+" kN·m/ml");',
  '  h+=st("Charge appliquée Σ", (R.totalLoad).toFixed(0)+" kN");',
  '  h+=st("Σ réactions sol", (R.sumReact).toFixed(0)+" kN");',
  '  if(R.winkOn) h+=st("Σ réaction Winkler", (R.sumWink).toFixed(0)+" kN");',
  '  if(R.sprOn) h+=st("Σ réaction ressorts", (R.sumSpr).toFixed(0)+" kN  ("+(R.nSpr?R.nSpr+" pont.":"")+(R.nSpr&&R.nLine?" + ":"")+(R.nLine?R.nLine+" lin.":"")+")");',
  '  if(R.winkOn||R.sprOn){ var tot=R.sumReact+(R.sumWink||0)+(R.sumSpr||0); var res=R.totalLoad?100*(R.totalLoad-tot)/R.totalLoad:0;',
  '    h+=st("Σ résistances (équilibre)", tot.toFixed(0)+" kN  ("+(res>=0?"+":"")+res.toFixed(2)+" %)"); }',
  '  if(R.decolNodes!=null) h+=st("Nœuds décollés", R.decolNodes);',
  '  if(R.foundOn) h+=st("Cote d\\u2019assise D", (R.foundD).toFixed(2)+" m");',
  '  if(R.dipOn) h+=st("Pendage stratigraphie", "∂/∂x "+(R.dipX).toFixed(2)+" · ∂/∂y "+(R.dipY).toFixed(2)+" m/m");',
  '  if(R.recOn) h+=st("Recompression (fond de fouille)", "σv0 "+(R.sigV0).toFixed(0)+" kPa · k "+(R.kRec).toFixed(2));',
  '  if(R.overCap) h+=\'<div style="margin-top:10px;padding:9px 11px;border:1px solid var(--err);border-radius:7px;background:rgba(239,106,90,.10);color:var(--err);font-size:11px;line-height:1.45"><b>⚠ Capacité de l\\u2019interface dépassée (poinçonnement)</b> — la réaction requise excède q_lim sans équilibre admissible. Résultats à considérer comme non valides. Augmenter q_lim, élargir la fondation ou réduire la charge.</div>\';',
  '  h+=\'<p style="font-size:10.5px;color:var(--ink-dim);margin-top:10px;line-height:1.5">θx = ∂w/∂y (rotation autour de X), θy = −∂w/∂x (autour de Y). La distorsion β est la pente résiduelle après retrait du plan moyen (basculement) de chaque plaque ; l\\u2019inclinaison ϖ est ce basculement. Valeurs limites indicatives (EC7 annexe H) : à confronter au type de structure portée. Hypothèses : plaque mince de Kirchhoff, sol élastique linéaire (Steinbrenner + Boussinesq, substratum rigide). Fondation supposée posée en surface ; la recompression d\\u2019un fond de fouille est modélisable (k = E_ur/E₀), mais pour le sol vierge la pression nette et le facteur de profondeur ne sont pas appliqués (tassement conservatif si encastrée). Appuis additionnels (Winkler, ressorts ponctuels et linéiques) en parallèle du sol, linéaires-élastiques.</p>\';',
  '  b.innerHTML=h;',
  '  b.querySelectorAll("button[data-f]").forEach(function(btn){ btn.onclick=function(){ bakeField(btn.dataset.f); refreshResults(); draw(); }; });',
  '  var cb=document.getElementById("opt-crit"); if(cb) cb.onchange=function(){ R.showCrit=cb.checked; draw(); };',
  '  var ci=document.getElementById("opt-iso"); if(ci) ci.onchange=function(){ iso.lines=ci.checked; draw(); };',
  '  var cba=document.getElementById("opt-bands"); if(cba) cba.onchange=function(){ iso.bands=cba.checked; bakeField(R.field); draw(); };',
  '  var nl=document.getElementById("opt-nlev"); if(nl) nl.onchange=function(){ iso.n=parseInt(nl.value,10)||12; bakeField(R.field); draw(); };',
  '}',
].join('\n');

/** psPlot() RÉÉCRIT : trace 3 bandes depuis les profils SERVEUR (97 pts, plane-strain). */
const GEOPLAQUE_PSPLOT = [
  'function psPlot(R){',
  '  var pr=R.profils||{}; var wD=pr.deflexion, mD=pr.moment, pD=pr.reaction;',
  '  if(!wD||!wD.x||!wD.x.length) return "";',
  '  var W=300,H=210,pad=26,gap=14,ph=(H-2*pad-2*gap)/3;',
  '  var X=wD.x, xmin=X[0], xmax=X[X.length-1];',
  '  var sx=function(x){ return pad+(x-xmin)/((xmax-xmin)||1)*(W-2*pad); };',
  '  function band(xs,arr,top,col,label,unit){ var mn=Math.min.apply(null,arr),mx=Math.max.apply(null,arr); if(mx-mn<1e-12){mx+=1;mn-=1;}',
  '    var pdv=(mx-mn)*0.12; mn-=pdv; mx+=pdv; var sy=function(v){ return top+ph-(v-mn)/((mx-mn)||1)*ph; };',
  '    var dd=""; for(var i=0;i<arr.length;i++){ dd+=(i?"L":"M")+sx(xs[i]).toFixed(1)+","+sy(arr[i]).toFixed(1); }',
  '    var zeroY=(mn<0&&mx>0)?sy(0):null;',
  '    return \'<g><rect x="\'+pad+\'" y="\'+top+\'" width="\'+(W-2*pad)+\'" height="\'+ph+\'" fill="rgba(255,255,255,.02)" stroke="var(--line,#333)" stroke-width=".5"/>\'',
  '      +(zeroY!==null?\'<line x1="\'+pad+\'" y1="\'+zeroY.toFixed(1)+\'" x2="\'+(W-pad)+\'" y2="\'+zeroY.toFixed(1)+\'" stroke="var(--ink-dim,#789)" stroke-width=".5" stroke-dasharray="3 2"/>\':"")',
  '      +\'<path d="\'+dd+\'" fill="none" stroke="\'+col+\'" stroke-width="1.6"/>\'',
  '      +\'<text x="\'+(pad+2)+\'" y="\'+(top+11)+\'" fill="\'+col+\'" font-size="10" font-family="var(--mono)">\'+label+\'</text>\'',
  '      +\'<text x="\'+(W-pad-2)+\'" y="\'+(top+11)+\'" fill="var(--ink-dim,#789)" font-size="9" text-anchor="end" font-family="var(--mono)">\'+(Math.max(Math.abs(mn),Math.abs(mx))).toFixed(0)+" "+unit+\'</text></g>\'; }',
  '  var s=\'<svg viewBox="0 0 \'+W+\' \'+H+\'" style="width:100%;margin-top:12px;background:transparent" xmlns="http://www.w3.org/2000/svg">\';',
  '  var wmm=wD.v.map(function(v){ return v*1000; });',
  '  s+=band(wD.x,wmm,pad,"#5ea9ff","tassement w","mm");',
  '  if(mD&&mD.v) s+=band(mD.x,mD.v,pad+ph+gap,"#ffb454","moment M","kN·m/m");',
  '  if(pD&&pD.v) s+=band(pD.x,pD.v,pad+2*(ph+gap),"#3fb6a8","réaction p","kPa");',
  '  s+=\'<text x="\'+(W/2)+\'" y="\'+(H-4)+\'" fill="var(--ink-dim,#789)" font-size="9" text-anchor="middle" font-family="var(--mono)">x (m) — 0 \\u2192 \'+xmax.toFixed(1)+\'</text>\';',
  '  s+="</svg>"; return s;',
  '}',
].join('\n');

/** axiPlot() RÉÉCRIT : trace 4 bandes radiales depuis les profils SERVEUR (axi). */
const GEOPLAQUE_AXIPLOT = [
  'function axiPlot(R){',
  '  var pr=R.profils||{}; var wD=pr.deflexion, mrD=pr.momentR, mtD=pr.momentT, pD=pr.reaction;',
  '  if(!wD||!wD.x||!wD.x.length) return "";',
  '  var W=300,H=255,pad=26,gap=12,ph=(H-2*pad-3*gap)/4;',
  '  var X=wD.x, xmax=X[X.length-1]||1;',
  '  var sx=function(x){ return pad+x/xmax*(W-2*pad); };',
  '  function band(xs,arr,top,col,label,unit){ var mn=Math.min.apply(null,arr),mx=Math.max.apply(null,arr); if(mx-mn<1e-12){mx+=1;mn-=1;}',
  '    var pdv=(mx-mn)*0.12; mn-=pdv; mx+=pdv; var sy=function(v){ return top+ph-(v-mn)/((mx-mn)||1)*ph; };',
  '    var dd=""; for(var i=0;i<arr.length;i++){ dd+=(i?"L":"M")+sx(xs[i]).toFixed(1)+","+sy(arr[i]).toFixed(1); }',
  '    var zeroY=(mn<0&&mx>0)?sy(0):null;',
  '    return \'<g><rect x="\'+pad+\'" y="\'+top+\'" width="\'+(W-2*pad)+\'" height="\'+ph+\'" fill="rgba(255,255,255,.02)" stroke="var(--line,#333)" stroke-width=".5"/>\'',
  '      +(zeroY!==null?\'<line x1="\'+pad+\'" y1="\'+zeroY.toFixed(1)+\'" x2="\'+(W-pad)+\'" y2="\'+zeroY.toFixed(1)+\'" stroke="var(--ink-dim,#789)" stroke-width=".5" stroke-dasharray="3 2"/>\':"")',
  '      +\'<path d="\'+dd+\'" fill="none" stroke="\'+col+\'" stroke-width="1.6"/>\'',
  '      +\'<text x="\'+(pad+2)+\'" y="\'+(top+11)+\'" fill="\'+col+\'" font-size="10" font-family="var(--mono)">\'+label+\'</text>\'',
  '      +\'<text x="\'+(W-pad-2)+\'" y="\'+(top+11)+\'" fill="var(--ink-dim,#789)" font-size="9" text-anchor="end" font-family="var(--mono)">\'+(Math.max(Math.abs(mn),Math.abs(mx))).toFixed(0)+" "+unit+\'</text></g>\'; }',
  '  var s=\'<svg viewBox="0 0 \'+W+\' \'+H+\'" style="width:100%;margin-top:12px;background:transparent" xmlns="http://www.w3.org/2000/svg">\';',
  '  var wmm=wD.v.map(function(v){ return v*1000; });',
  '  s+=band(wD.x,wmm,pad,"#5ea9ff","tassement w","mm");',
  '  if(mrD&&mrD.v) s+=band(mrD.x,mrD.v,pad+ph+gap,"#ffb454","moment M_r","kN·m/m");',
  '  if(mtD&&mtD.v) s+=band(mtD.x,mtD.v,pad+2*(ph+gap),"#c58cf0","moment M_t","kN·m/m");',
  '  if(pD&&pD.v) s+=band(pD.x,pD.v,pad+3*(ph+gap),"#3fb6a8","réaction p","kPa");',
  '  s+=\'<text x="\'+(W/2)+\'" y="\'+(H-3)+\'" fill="var(--ink-dim,#789)" font-size="9" text-anchor="middle" font-family="var(--mono)">r (m) — axe 0 \\u2192 bord \'+xmax.toFixed(1)+\'</text>\';',
  '  s+="</svg>"; return s;',
  '}',
].join('\n');

/** triMeshSvg() RÉÉCRIT : rend la grille RÉGULIÈRE serveur (champDeflexion 48×48) en
 * cellules colorées (jet) — le MOTIF de tassement, JAMAIS le maillage triangulaire réel
 * (P/tris/N/nt confidentiels, décision design-sûr + titulaire). */
const GEOPLAQUE_TRIMESHSVG = [
  'function triMeshSvg(R){',
  '  var g=R.champDeflexion; if(!g||!g.vals||!g.vals.length) return \'<div class="empty" style="margin-top:10px">Carte indisponible.</div>\';',
  '  var W=300,Hh=240,pad=10;',
  '  var sc=Math.min((W-2*pad)/((g.x1-g.x0)||1),(Hh-2*pad-16)/((g.y1-g.y0)||1));',
  '  var sx=function(x){ return pad+(x-g.x0)*sc; }, sy=function(y){ return (Hh-16)-pad-(y-g.y0)*sc; };',
  '  var wmn=isFinite(g.vMin)?g.vMin:0, wmx=isFinite(g.vMax)?g.vMax:wmn+1, rng=(wmx-wmn)||1;',
  '  var jetc=function(t){ t=Math.max(0,Math.min(1,t)); var r=Math.max(0,Math.min(1,1.5-Math.abs(4*t-3))),gg=Math.max(0,Math.min(1,1.5-Math.abs(4*t-2))),bb=Math.max(0,Math.min(1,1.5-Math.abs(4*t-1)));',
  '    return "rgb("+Math.round(255*r)+","+Math.round(255*gg)+","+Math.round(255*bb)+")"; };',
  '  var cols=g.cols, rows=g.rows, cwx=(g.x1-g.x0)/(cols-1), cwy=(g.y1-g.y0)/(rows-1);',
  '  var s=\'<svg viewBox="0 0 \'+W+\' \'+Hh+\'" style="width:100%;margin-top:12px;background:transparent" xmlns="http://www.w3.org/2000/svg">\';',
  '  for(var j=0;j<rows;j++){ for(var i=0;i<cols;i++){ var v=g.vals[j*cols+i]; if(v==null) continue;',
  '    var x=g.x0+i*cwx-cwx/2, y=g.y0+j*cwy-cwy/2;',
  '    var rx=sx(x), ry=sy(y+cwy);',
  "    s+='<rect x=\"'+rx.toFixed(1)+'\" y=\"'+ry.toFixed(1)+'\" width=\"'+(cwx*sc+0.6).toFixed(1)+'\" height=\"'+(cwy*sc+0.6).toFixed(1)+'\" fill=\"'+jetc((v-wmn)/rng)+'\" />'; } }",
  '  s+=\'<text x="\'+(W/2)+\'" y="\'+(Hh-3)+\'" fill="var(--ink-dim,#789)" font-size="9" text-anchor="middle" font-family="var(--mono)">tassement — bleu \'+(wmn*1000).toFixed(1)+\' mm \\u2192 rouge \'+(wmx*1000).toFixed(1)+\' mm · grille d\\u2019affichage 48×48</text>\';',
  '  s+="</svg>"; return s;',
  '}',
].join('\n');

/** init() RÉÉCRIT : identique à l'original SAUF l'auto-test ACM (buildACM excisé) retiré. */
const GEOPLAQUE_INIT = [
  'function init(){',
  '  resize();',
  '  state.project={title:"",client:"",ref:"",author:""};',
  '  state.layers=[{name:"Couche 1",zBase:-10,E:2e4,nu:0.33},{name:"Couche 2",zBase:-30,E:5e4,nu:0.33}];',
  '  state.rafts=[];state.pointLoads=[];state.lineLoads=[];state.areaLoads=[];state.pointSprings=[];state.lineSprings=[];',
  '  state.sel=null;state.results=null;',
  '  refreshAll(); zoomFit();',
  '  updateGridStep();',
  '  draw();',
  '  bindProjectFields();',
  '}',
].join('\n');

/** printReport() RÉÉCRIT : note imprimable depuis les SCALAIRES whitelistés (pas de champ
 * nodal, pas de localisation *At, pas de N/edges/plastNodes — masquages §8 documentés). */
const GEOPLAQUE_PRINTREPORT = [
  'function printReport(){',
  '  var R=state.results;',
  '  var esc=function(s){ return String(s).replace(/[&<>]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;"}[c];}); };',
  '  var num=function(v,dd){ dd=(dd==null?2:dd); return (v==null||!isFinite(v))?"—":(+v).toFixed(dd); };',
  '  var P=state.project||{title:"",client:"",ref:"",author:""};',
  '  var fig=""; try{ fig=cv.toDataURL("image/png"); }catch(e){}',
  '  var rafts=state.rafts.map(function(rf,i){ var xs=rf.pts.map(function(p){return p.x;}),ys=rf.pts.map(function(p){return p.y;});',
  '    var bb=num(Math.min.apply(null,xs))+" – "+num(Math.max.apply(null,xs))+" × "+num(Math.min.apply(null,ys))+" – "+num(Math.max.apply(null,ys));',
  '    return "<tr><td>R"+(i+1)+"</td><td>"+rf.pts.length+" sommets</td><td>"+bb+"</td><td>"+(rf.E/1000).toFixed(0)+" MPa</td><td>"+rf.nu+"</td><td>"+num(rf.e)+" m</td></tr>"; }).join("");',
  '  var pl=state.pointLoads.map(function(p,i){ return "<tr><td>P"+(i+1)+"</td><td>"+num(p.x)+" ; "+num(p.y)+"</td><td>"+num(p.Fz,0)+" kN</td><td>"+num(p.Mx,0)+" / "+num(p.My,0)+" kN·m</td></tr>"; }).join("");',
  '  var ll=state.lineLoads.map(function(l,i){ return "<tr><td>L"+(i+1)+"</td><td>"+num(l.x1)+";"+num(l.y1)+" → "+num(l.x2)+";"+num(l.y2)+"</td><td>"+num(l.q,0)+" kN/ml</td></tr>"; }).join("");',
  '  var al=state.areaLoads.map(function(a,i){ return "<tr><td>A"+(i+1)+"</td><td>"+num(a.x1)+";"+num(a.y1)+" → "+num(a.x2)+";"+num(a.y2)+"</td><td>"+num(a.q,0)+" kPa</td><td>"+(a.on==="soil"?"sol (ext.)":"plaque")+"</td></tr>"; }).join("");',
  '  var spr=state.pointSprings.map(function(s,i){ return "<tr><td>K"+(i+1)+"</td><td>"+num(s.x)+" ; "+num(s.y)+"</td><td>"+num(s.k,0)+" kN/m</td></tr>"; }).join("");',
  '  var lspr=state.lineSprings.map(function(l,i){ return "<tr><td>KL"+(i+1)+"</td><td>"+num(l.x1)+";"+num(l.y1)+" → "+num(l.x2)+";"+num(l.y2)+"</td><td>"+num(l.k,0)+" kN/m/m</td></tr>"; }).join("");',
  '  var ly=state.layers.map(function(c,i){ return "<tr><td>"+esc(c.name||("Couche "+(i+1)))+"</td><td>"+num(c.zBase,1)+" m</td><td>"+(c.E/1000).toFixed(0)+" MPa</td><td>"+c.nu+"</td></tr>"; }).join("");',
  '  var resHtml=\'<p style="color:#a33">Aucun calcul effectué — lance le calcul avant d\\u2019imprimer pour inclure les résultats.</p>\';',
  '  if(R && R.diag){ var d=R.diag; var wmaxmm=d.wMax*1000, diffmm=d.diff*1000;',
  '    var verdict=function(l){ return {ok:\'<b style="color:#1a7f37">CONFORME</b>\',warn:\'<b style="color:#b07a12">ATTENTION</b>\',bad:\'<b style="color:#b3261e">DÉPASSEMENT</b>\'}[l]; };',
  '    var decol=document.getElementById("opt-decol").checked;',
  '    resHtml=""',
  '    +"<h2>Vérifications — Eurocode 7, annexe H</h2>"',
  '    +\'<table class="chk">\'',
  '    +"<tr><th>Critère</th><th>Valeur</th><th>Repère</th><th>Verdict</th></tr>"',
  '    +"<tr><td>Tassement total max</td><td>"+wmaxmm.toFixed(1)+" mm</td><td>≈ 50 mm</td><td>"+verdict(lvlSettle(wmaxmm))+"</td></tr>"',
  '    +"<tr><td>Tassement différentiel</td><td>"+diffmm.toFixed(1)+" mm</td><td>≈ 20 mm</td><td>"+verdict(lvlDiff(diffmm))+"</td></tr>"',
  '    +"<tr><td>Distorsion angulaire β (rotation relative)</td><td>"+ratio1(d.betaGov)+" ("+d.betaGov.toExponential(1)+" rad)</td><td>ELS 1/500 · ELU 1/150</td><td>"+verdict(lvlBeta(d.betaGov))+"</td></tr>"',
  '    +"<tr><td>Inclinaison d\\u2019ensemble ϖ (basculement)</td><td>"+ratio1(d.tiltMax)+"</td><td>visible ≈ 1/500</td><td>"+verdict(d.tiltMax<=1/500?"ok":d.tiltMax<=1/150?"warn":"bad")+"</td></tr>"',
  '    +(d.nRafts>1?"<tr><td>Distorsion entre plaques</td><td>"+ratio1(d.interBeta)+" · Δs "+(d.interDiff*1000).toFixed(1)+" mm</td><td>ELS 1/500</td><td>"+verdict(lvlBeta(d.interBeta))+"</td></tr>":"")',
  '    +(d.loadPairs&&d.loadPairs.worst?"<tr><td>Distorsion entre charges (max) — P"+d.loadPairs.worst.ki+"↔P"+d.loadPairs.worst.kj+"</td><td>"+ratio1(d.loadPairs.worst.beta)+" · Δs "+(d.loadPairs.worst.ds*1000).toFixed(1)+" mm / "+d.loadPairs.worst.L.toFixed(2)+" m</td><td>ELS 1/500 · ELU 1/150</td><td>"+verdict(lvlBeta(d.loadPairs.worst.beta))+"</td></tr>":"")',
  '    +"</table>"',
  '    +"<h2>Synthèse des résultats</h2>"',
  '    +\'<table class="syn">\'',
  '    +(d.nRafts>1?"<tr><td>Plaques modélisées</td><td>"+d.nRafts+"</td></tr>":"")',
  '    +"<tr><td>Tassement max / min</td><td>"+wmaxmm.toFixed(1)+" / "+(d.wMin*1000).toFixed(1)+" mm</td></tr>"',
  '    +"<tr><td>Tassement différentiel</td><td>"+diffmm.toFixed(1)+" mm</td></tr>"',
  '    +"<tr><td>Rotation θx max</td><td>"+d.txMax.toExponential(2)+" rad ("+ratio1(d.txMax)+")</td></tr>"',
  '    +"<tr><td>Rotation θy max</td><td>"+d.tyMax.toExponential(2)+" rad ("+ratio1(d.tyMax)+")</td></tr>"',
  '    +"<tr><td>Pente locale max |∇w|</td><td>"+d.slopeMax.toExponential(2)+" rad ("+ratio1(d.slopeMax)+")</td></tr>"',
  '    +"<tr><td>Réaction du sol p (min / max)</td><td>"+num(R.pMin,1)+" / "+num(R.pMax,1)+" kPa</td></tr>"',
  '    +"<tr><td>Moment |Mx| / |My| max</td><td>"+(R.mxMax).toFixed(1)+" / "+(R.myMax).toFixed(1)+" kN·m/ml</td></tr>"',
  '    +"<tr><td>Moment de torsion |Mxy| max</td><td>"+(R.mxyMax).toFixed(1)+" kN·m/ml</td></tr>"',
  '    +"<tr><td>Charge verticale appliquée Σ</td><td>"+(R.totalLoad).toFixed(0)+" kN</td></tr>"',
  '    +"<tr><td>Réaction du sol Σ</td><td>"+(R.sumReact).toFixed(0)+" kN</td></tr>"',
  '    +(R.winkOn?"<tr><td>Réaction lit de Winkler Σ</td><td>"+(R.sumWink).toFixed(0)+" kN</td></tr>":"")',
  '    +(R.sprOn?"<tr><td>Réaction ressorts additionnels Σ</td><td>"+(R.sumSpr).toFixed(0)+" kN · "+R.nSpr+" ponctuel(s)"+(R.nLine?(" + "+R.nLine+" linéique(s)"):"")+"</td></tr>":"")',
  '    +(decol&&R.decolNodes!=null?"<tr><td>Décollement</td><td>"+R.decolNodes+" nœud(s) décollé(s)</td></tr>":"")',
  '    +(R.foundOn?"<tr><td>Cote d\\u2019assise (fondation en profondeur)</td><td>D = "+(R.foundD).toFixed(2)+" m</td></tr>":"")',
  '    +(R.dipOn?"<tr><td>Stratigraphie non horizontale (§2.3.1)</td><td>pendage ∂/∂x = "+(R.dipX).toFixed(3)+" · ∂/∂y = "+(R.dipY).toFixed(3)+" m/m</td></tr>":"")',
  '    +(R.recOn?"<tr><td>Recompression (fond de fouille)</td><td>σv0 = "+(R.sigV0).toFixed(0)+" kPa · k = E_ur/E0 = "+(R.kRec).toFixed(2)+"</td></tr>":"")',
  '    +"</table>";',
  '  }',
  '  var win=window.open("","_blank");',
  '  if(!win){ toast("Autorise les fenêtres pop-up pour imprimer",3800,"err"); return; }',
  '  win.document.write(\'<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>\'+(P.title?esc(P.title)+" — ":"")+\'Note de calcul — GEOPLAQUE</title>\'',
  "    +'<style>@page{margin:16mm}body{font-family:system-ui,Segoe UI,Roboto,sans-serif;color:#111;font-size:12px;line-height:1.5;max-width:900px;margin:0 auto;padding:10px}h1{font-size:18px;margin:0 0 2px}h2{font-size:13px;border-bottom:1px solid #ccc;padding-bottom:3px;margin:18px 0 8px}table{border-collapse:collapse;width:100%;margin:6px 0}th,td{border:1px solid #ccc;padding:4px 7px;text-align:left;font-size:11px}th{background:#f2f2f2}.meta{color:#555;font-size:11px}img{max-width:100%;border:1px solid #ddd;border-radius:4px;margin:6px 0}.note{font-size:10.5px;color:#555;margin-top:10px}</style></head><body>'",
  '    +"<h1>Note de calcul — GEOPLAQUE</h1>"',
  '    +\'<p class="meta">\'+(P.title?"Projet : "+esc(P.title)+" · ":"")+(P.client?"Client : "+esc(P.client)+" · ":"")+(P.ref?"Affaire : "+esc(P.ref)+" · ":"")+(P.author?"Auteur : "+esc(P.author):"")+"</p>"',
  '    +(fig?\'<img src="\'+fig+\'" alt="Modèle">\':"")',
  '    +(rafts?"<h2>Plaques (radiers)</h2><table><tr><th>#</th><th>Sommets</th><th>Emprise X × Y (m)</th><th>E</th><th>ν</th><th>e</th></tr>"+rafts+"</table>":"")',
  '    +(pl?"<h2>Charges ponctuelles</h2><table><tr><th>#</th><th>X ; Y</th><th>Fz</th><th>Mx / My</th></tr>"+pl+"</table>":"")',
  '    +(ll?"<h2>Charges linéiques</h2><table><tr><th>#</th><th>Segment</th><th>q</th></tr>"+ll+"</table>":"")',
  '    +(al?"<h2>Charges réparties</h2><table><tr><th>#</th><th>Emprise</th><th>q</th><th>Appliquée sur</th></tr>"+al+"</table>":"")',
  '    +(spr?"<h2>Ressorts ponctuels</h2><table><tr><th>#</th><th>X ; Y</th><th>k</th></tr>"+spr+"</table>":"")',
  '    +(lspr?"<h2>Ressorts linéiques</h2><table><tr><th>#</th><th>Segment</th><th>k</th></tr>"+lspr+"</table>":"")',
  '    +"<h2>Profil de sol</h2><table><tr><th>Couche</th><th>Base z</th><th>E</th><th>ν</th></tr>"+ly+"</table>"',
  '    +resHtml',
  '    +\'<p class="note">Calcul et cartographie exécutés côté serveur (méthode éléments finis confidentielle). Localisations de nœuds et détail complet des paires de charges non reportés (grandeurs de méthode). Le PV scellé émis depuis la plateforme fait référence.</p>\'',
  '    +"</body></html>");',
  '  win.document.close();',
  '}',
].join('\n');

/** Handler ps-run RÉÉCRIT : async, bridge (plane-strain). Tassements AVEC ×1000 (copie client). */
const GEOPLAQUE_PSRUN = [
  "document.getElementById('ps-run').onclick=async function(){",
  '  var out=document.getElementById("ps-out");',
  '  var loads=(document.getElementById("ps-loads").value||"").split("\\n").map(function(s){return s.trim();}).filter(Boolean).map(function(line){ var m=line.split(/[\\s,;]+/).map(parseFloat); return {x:m[0]||0,P:m[1]||0}; }).filter(function(l){return l.P;});',
  '  var Bw=parseFloat(document.getElementById("ps-b").value)||10, e=parseFloat(document.getElementById("ps-e").value)||0.5;',
  '  var E=parseFloat(document.getElementById("ps-E").value)||3e7, nu=parseFloat(document.getElementById("ps-nu").value)||0.2;',
  '  var q=parseFloat(document.getElementById("ps-q").value)||0;',
  '  var ne=parseInt(document.getElementById("ps-ne").value)||60, decol=document.getElementById("ps-decol").checked;',
  '  var foundD=parseFloat(document.getElementById("opt-exc-d").value)||0;',
  '  if(q===0 && !loads.length){ out.innerHTML=\'<div class="empty">Renseigne au moins une charge (répartie ou ponctuelle).</div>\'; return; }',
  '  var opts={ Bw:Bw, e:e, E:_E(E), nu:nu, decol:decol };',
  '  if(foundD>0) opts.foundD=foundD; if(ne) opts.ne=ne; if(q!==0) opts.q=q; if(loads.length) opts.loads=loads;',
  '  var payload={ layers:_layersMPa(), opts:opts }; var pj=(state.project&&state.project.title)||null; if(pj) payload.projet=String(pj);',
  '  out.innerHTML=\'<div class="empty">Calcul en cours…</div>\';',
  '  var resp; try{ resp=await window.__geofamBridge.calc("plane-strain", payload); }',
  '  catch(err){ out.innerHTML=\'<div class="empty" style="color:var(--err)">Pont de calcul indisponible : \'+_gerr(err)+"</div>"; return; }',
  '  if(!resp||!resp.ok){ out.innerHTML=\'<div class="empty" style="color:var(--err)">\'+_gerr(resp&&resp.error)+"</div>"; return; }',
  '  var R=resp.output||{}; if(R.erreur){ out.innerHTML=\'<div class="empty" style="color:var(--err)">\'+_esc(R.erreur)+"</div>"; return; }',
  '  window.__geoplaqueLastCalcResultId=resp.calcResultId||null;',
  "  var st=function(a,v){ return '<div class=\"stat\"><span>'+a+'</span><b>'+v+'</b></div>'; };",
  '  var h=st("Tassement max / min",(R.wMax*1000).toFixed(1)+" / "+(R.wMin*1000).toFixed(1)+" mm");',
  '  h+=st("Tassement différentiel",(R.diff*1000).toFixed(1)+" mm");',
  '  h+=st("Moment max (+/−)",(R.mMax).toFixed(1)+" / "+(R.mMin).toFixed(1)+" kN·m/m");',
  '  h+=st("Réaction sol max",(R.pMax).toFixed(1)+" kPa");',
  '  h+=st("Charge / réaction Σ",(R.totalLoad).toFixed(0)+" / "+(R.sumReact).toFixed(0)+" kN/m"+_eqSuffix(R.totalLoad,R.sumReact));',
  '  if(foundD>0) h+=st("Cote d\\u2019assise D",(R.z0).toFixed(2)+" m");',
  '  if(decol) h+=st("Décollement",(R.decolN)+" nœud(s)");',
  '  h+=st("Rigidité D (E·e³/12(1−ν²))",(R.EI).toExponential(2)+" kN·m");',
  '  out.innerHTML=h+psPlot(R);',
  '}',
].join('\n');

/** Handler ax-run RÉÉCRIT : async, bridge (axi ; clé opts = `o`). Tassements AVEC ×1000 (copie client). */
const GEOPLAQUE_AXRUN = [
  "document.getElementById('ax-run').onclick=async function(){",
  '  var out=document.getElementById("ax-out");',
  '  var Rr=parseFloat(document.getElementById("ax-r").value)||6, e=parseFloat(document.getElementById("ax-e").value)||0.4;',
  '  var E=parseFloat(document.getElementById("ax-E").value)||3e7, nu=parseFloat(document.getElementById("ax-nu").value)||0.2;',
  '  var q=parseFloat(document.getElementById("ax-q").value)||0, Pc=parseFloat(document.getElementById("ax-pc").value)||0;',
  '  var ne=parseInt(document.getElementById("ax-ne").value)||50, foundD=parseFloat(document.getElementById("opt-exc-d").value)||0;',
  '  if(q===0 && Pc===0){ out.innerHTML=\'<div class="empty">Renseigne une charge (répartie ou centrale).</div>\'; return; }',
  '  var o={ R:Rr, e:e, E:_E(E), nu:nu }; if(q!==0) o.q=q; if(Pc!==0) o.Pc=Pc; if(ne) o.ne=ne; if(foundD>0) o.foundD=foundD;',
  '  var payload={ layers:_layersMPa(), o:o }; var pj=(state.project&&state.project.title)||null; if(pj) payload.projet=String(pj);',
  '  out.innerHTML=\'<div class="empty">Calcul en cours…</div>\';',
  '  var resp; try{ resp=await window.__geofamBridge.calc("axi", payload); }',
  '  catch(err){ out.innerHTML=\'<div class="empty" style="color:var(--err)">Pont de calcul indisponible : \'+_gerr(err)+"</div>"; return; }',
  '  if(!resp||!resp.ok){ out.innerHTML=\'<div class="empty" style="color:var(--err)">\'+_gerr(resp&&resp.error)+"</div>"; return; }',
  '  var R=resp.output||{}; if(R.erreur){ out.innerHTML=\'<div class="empty" style="color:var(--err)">\'+_esc(R.erreur)+"</div>"; return; }',
  '  window.__geoplaqueLastCalcResultId=resp.calcResultId||null;',
  "  var st=function(a,v){ return '<div class=\"stat\"><span>'+a+'</span><b>'+v+'</b></div>'; };",
  '  var h=st("Tassement centre / bord",(R.wc*1000).toFixed(1)+" / "+(R.wEdge*1000).toFixed(1)+" mm");',
  '  h+=st("Tassement différentiel",(R.diff*1000).toFixed(1)+" mm");',
  '  h+=st("Moment radial M_r max",(R.mrMax).toFixed(1)+" kN·m/m");',
  '  h+=st("Moment tangentiel M_t max",(R.mtMax).toFixed(1)+" kN·m/m");',
  '  h+=st("Réaction sol max",(R.pMax).toFixed(1)+" kPa");',
  '  h+=st("Charge / réaction Σ",(R.totalLoad).toFixed(0)+" / "+(R.sumReact).toFixed(0)+" kN"+_eqSuffix(R.totalLoad,R.sumReact));',
  '  if(foundD>0) h+=st("Cote d\\u2019assise D",(R.z0).toFixed(2)+" m");',
  '  out.innerHTML=h+axiPlot(R);',
  '}',
].join('\n');

/** Handler tri-run RÉÉCRIT : async, bridge (tri-raft). Carte = champDeflexion 48×48. */
const GEOPLAQUE_TRIRUN = [
  "document.getElementById('tri-run').onclick=async function(){",
  '  var out=document.getElementById("tri-out");',
  '  if(!state.rafts.length){ out.innerHTML=\'<div class="empty">Aucune plaque. Dessine une plaque dans l\\u2019onglet Modèle.</div>\'; return; }',
  '  var target=parseFloat(document.getElementById("tri-target").value)||1, e=parseFloat(document.getElementById("tri-e").value)||0.5;',
  '  var E=parseFloat(document.getElementById("tri-E").value)||3e7, nu=parseFloat(document.getElementById("tri-nu").value)||0.2;',
  '  var q=parseFloat(document.getElementById("tri-q").value)||0, foundD=parseFloat(document.getElementById("opt-exc-d").value)||0;',
  '  var anyLoad=q!==0 || state.pointLoads.length || state.lineLoads.length || state.areaLoads.some(function(a){return a.on!=="soil";});',
  '  if(!anyLoad){ out.innerHTML=\'<div class="empty">Aucune charge : ajoute des charges (onglet Modèle) ou une charge répartie q.</div>\'; return; }',
  '  var opts={ target:target, e:e, E:_E(E), nu:nu }; if(q!==0) opts.q=q; if(foundD>0) opts.foundD=foundD;',
  '  var payload={ rafts:state.rafts.map(function(rf){ return { pts:rf.pts.map(function(p){return {x:+p.x,y:+p.y};}) }; }),',
  '    pointLoads:state.pointLoads.map(function(l){ return {x:+l.x,y:+l.y,Fz:+l.Fz}; }),',
  '    lineLoads:state.lineLoads.map(function(l){ return {x1:+l.x1,y1:+l.y1,x2:+l.x2,y2:+l.y2,q:+l.q}; }),',
  '    areaLoads:state.areaLoads.map(function(l){ return {x1:+l.x1,y1:+l.y1,x2:+l.x2,y2:+l.y2,q:+l.q,on:l.on}; }),',
  '    layers:_layersMPa(), opts:opts }; var pj=(state.project&&state.project.title)||null; if(pj) payload.projet=String(pj);',
  '  out.innerHTML=\'<div class="empty">Calcul en cours…</div>\';',
  '  var resp; try{ resp=await window.__geofamBridge.calc("tri-raft", payload); }',
  '  catch(err){ out.innerHTML=\'<div class="empty" style="color:var(--err)">Pont de calcul indisponible : \'+_gerr(err)+"</div>"; return; }',
  '  if(!resp||!resp.ok){ out.innerHTML=\'<div class="empty" style="color:var(--err)">\'+_gerr(resp&&resp.error)+"</div>"; return; }',
  '  var R=resp.output||{}; if(R.erreur){ out.innerHTML=\'<div class="empty" style="color:var(--err)">\'+_esc(R.erreur)+"</div>"; return; }',
  '  window.__geoplaqueLastCalcResultId=resp.calcResultId||null;',
  "  var st=function(a,v){ return '<div class=\"stat\"><span>'+a+'</span><b>'+v+'</b></div>'; };",
  '  var h=st("Maillage",(R.nRaft)+" plaque"+(R.nRaft>1?"s":"")+" · maillage triangulaire (serveur)");',
  '  h+=st("Tassement max / min",(R.wMax*1000).toFixed(1)+" / "+(R.wMin*1000).toFixed(1)+" mm");',
  '  h+=st("Tassement différentiel",(R.diff*1000).toFixed(1)+" mm");',
  '  h+=st("Réaction sol max",(R.reactionMax).toFixed(1)+" kPa");',
  '  h+=st("Charge / réaction Σ",(R.totalLoad).toFixed(0)+" / "+(R.sumReact).toFixed(0)+" kN"+_eqSuffix(R.totalLoad,R.sumReact));',
  '  if(foundD>0) h+=st("Cote d\\u2019assise D",(R.z0).toFixed(2)+" m");',
  '  out.innerHTML=h+triMeshSvg(R);',
  '}',
].join('\n');

// ===========================================================================
// CASAGRANDE — fondations profondes / pieux (NF P 94-262, EC7) (ADR 0015).
// ---------------------------------------------------------------------------
// Outil a 5 onglets (Projet & pieu / Frottement negatif / Profil de sol /
// Coefficients / Resultats). Choke point `compute()` (portance) + `computeDowndrag()`
// (frottement negatif) + `betonCheck()` (verification structurale) + `portanceCore`
// (courbe de portance en profondeur) + `settlement` (Frank & Zhao). On EXCISE toute
// la science NF P 94-262 et on REECRIT les 2 entrees de calcul (compute/computeDowndrag)
// en async/bridge ; les renderers CONSERVES rendent la sortie serveur WHITELISTEE.
//
// ARBITRAGE D'EXCISION (fail-closed, ADR 0015 §Excision ; « defaut NON » pieux TOUJOURS
// en vigueur — cf. memoire roadsen-engine-output-whitelist-ple-qce) :
//  - CONFIDENTIEL (excise + interdit a l'audit) : les fonctions de methode
//    computeQce/portanceCore/portanceCaps/settlement/betonCheck/xiFactors/qsCPT/
//    groupCe/effLen/gammaRd1/kpMax/kcMax/alphaPMT/alphaCPT/qsMaxOf/kpReduced/kcReduced
//    + les TABLES d'abaques KP_MAX/KC_MAX/ALPHA_PMT/ALPHA_CPT/QSMAX + les coefficients
//    de courbe de frottement PMT_CURVE/CPT_CURVE (a,b,c). mResist/qcAt (selection EC7.M
//    publique / interpolation du penetrogramme saisi) sont RETIRES sans etre interdits.
//  - CONSERVE (rendu pur, SAISIE) : drawCoupe (coupe geotechnique live), drawQcLog
//    (log q_c(z) — courbe de saisie ; l'overlay q_ce/ecretage disparait car
//    window._qceDetail n'est plus alimente), pileGeom/layerTops/soilAt (geometrie de
//    section/profil = saisie, PUBLIQUE), fillFictitious, tout l'import penetrogramme,
//    renderResults (fed par mapPieuxOutput), initPiles/curPile/PILES (Tableau A.1 =
//    classes publiques), SOILS/EC7/DA_COMBOS (publics).
//  - REECRIT (bridge / sortie whitelistee) : compute (async), computeDowndrag (async),
//    drawBeton (verdict/taux/f_cd whitelistes ; sigma « — » — cf. RESIDU ci-dessous),
//    buildSoilCoefTable (libelles de sol + « — » : abaques servies serveur, table non
//    exposee), updateXiInfo (N/S saisie ; xi3/xi4 servis serveur — affiches apres calcul
//    dans renderResults), drawSettle (courbe si servie, sinon message natif « non
//    calculable »), drawPortance (courbe si servie, sinon rien — comme l'outil natif),
//    drawDowndrag (KPI N_max/G_sn/point neutre + 3 profils SERVIS via profilsDowndrag).
//
// ELARGISSEMENT WHITELIST §8 (ADR 0015 reco A, decide expert + titulaire) : PieuxOutputSchema
// expose desormais les intermediaires d'AFFICHAGE de la norme (memes annexes que terzaghi),
// BRANCHES sur les cellules d'origine par mapPieuxOutput : R_b/R_s bruts (colonne « Brut R_m »),
// p_le*/q_ce/k_p/k_c/D_ef (sous-texte KPI R_b via qbDetail), xi3/xi4/gamma_R;d1 (encart des
// resistances), C_e/D_ef (synthese geometrique), frottement par couche (fric[] -> table q_s),
// et les 3 courbes (courbePortance/courbeTassement/profilsDowndrag -> figures SVG). AUCUNE
// re-derivation cliente : chaque nombre affiche vient d'un champ serveur whiteliste.
//
// RESIDUS FERMES §8 (toujours confidentiels — pas dans l'elargissement) affiches « — » :
//  - R_d PAR TERME (RbD/RsD) : necessitent les coeffs partiels gouvernants (govElu.Rbf/Rsf),
//    non exposes ; le R_d TOTAL (RcD) l'est. Le total « Brut R_m » = R_b + R_s (somme de deux
//    valeurs deja affichees, comme dans renderResults d'origine).
//  - sigma appliquees beton (sELU/sELS) + limite ELS : hors whitelist ; l'exposer = un-liner
//    serveur (index.ts shapeOutput), PAS une re-derivation cliente (regle §8 titulaire, cf.
//    burmister adm50). SIGNALE comme ecart a trancher.
//  - abaques COMPLETES de l'onglet Coefficients (kp,max/kc,max/alpha/qs,max par sol x classe)
//    + C_e;F (effet de groupe non-flottant) + ecretage q_ce (cap) + detail c-φ (Nc/σ′v) :
//    science confidentielle, non exposee.
//
// UNITES : aucune conversion (le contrat PieuxInputSchema reprend les champs du HTML tels
// quels — G/Q en kN, pl*/qc en MPa, gamma en kN/m3). SEULE reconciliation : la valeur de
// section carree du HTML est « carr » (data-sec) alors que le contrat attend « carre » —
// buildPieuxInput mappe carr->carre (validation-surface, aucune science). Les coefficients
// partiels EC7 sont AUTORITATIFS SERVEUR (audit adverse : falsifiables -> verdict truque) :
// buildPieuxInput envoie la constante normative (jamais les champs editables de l'onglet 04).
// ===========================================================================

/** Symboles MOTEUR (science NF P 94-262 confidentielle) SUPPRIMES + INTERDITS a l'audit. */
const CASAGRANDE_ENGINE_SYMBOLS = [
  'computeQce',
  'portanceCore',
  'portanceCaps',
  'settlement',
  'betonCheck',
  'xiFactors',
  'qsCPT',
  'groupCe',
  'effLen',
  'gammaRd1',
  'kpMax',
  'kcMax',
  'alphaPMT',
  'alphaCPT',
  'qsMaxOf',
  'kpReduced',
  'kcReduced',
];

/** Bridge postMessage (cote iframe, patron roadsens) + helpers de mapping etat<->contrat. */
const CASAGRANDE_BRIDGE_AND_SHIM = [
  '/* ===================== BRIDGE + MAPPING (injecté — clone excisé, ADR 0015) ===================== */',
  '(function(){',
  '  var TOOL_ID="casagrande", ENGINE_ID="pieux";',
  '  var pending=Object.create(null), seq=0;',
  '  var ctx={ engineId:ENGINE_ID, orgSlug:null, projectLabel:null, readOnly:false };',
  '  function post(msg){ try{ window.parent.postMessage(msg,"*"); }catch(e){} }',
  '  window.addEventListener("message", function(ev){',
  '    if(ev.source !== window.parent) return;',
  '    var d=ev.data; if(!d || d.v!==1 || typeof d.type!=="string") return;',
  '    if(d.type==="init"){ ctx=Object.assign(ctx, d.payload||{}); return; }',
  '    if(d.type==="calc:response"){ var p=pending[d.id]; if(!p) return; delete pending[d.id]; p(d.payload||{ok:false,error:{message:"réponse vide"}}); return; }',
  '  });',
  '  window.__geofamBridge={',
  '    calc:function(params){ var id=TOOL_ID+":"+(++seq); return new Promise(function(resolve){ pending[id]=resolve; post({v:1,type:"calc:request",id:id,payload:{engineId:ENGINE_ID,label:(params&&params.projet)||null,params:params}}); }); },',
  '    emitPv:function(calcResultId){ post({v:1,type:"pv:request",payload:{calcResultId:calcResultId}}); },',
  '    context:function(){ return ctx; }',
  '  };',
  '  /* input:dirty (correctif PV BQ-1) : signale a l hote que l ecran a change apres un calcul',
  '     -> le bouton d emission du PV scelle se desactive jusqu au prochain calcul (evite un PV perime).',
  '     Emission IMMEDIATE (front de montee), NON debouncee : le bouton doit se desactiver des la 1re frappe.',
  '     Throttle ~1/frame par FLAG booleen (aucun delai temporel sur l emission) pour ne pas inonder l hote,',
  '     lui-meme idempotent. Listener DELEGUE au document (capture) : generique, sans connaitre le DOM de l outil.',
  '     Cible input/change uniquement (la donnee A change) — PAS click : naviguer entre onglets de',
  '     resultats ne change pas le calcul affiche (sinon on desactiverait le PV a tort). Un changement de',
  '     mode de calcul sans recalcul reste couvert cote hote : ce mode n a pas de calcResultId. */',
  '  var __geofamDirtyFrame=false;',
  '  function __geofamEmitDirty(){ if(__geofamDirtyFrame) return; __geofamDirtyFrame=true; post({v:1,type:"input:dirty",payload:{toolId:TOOL_ID}}); var __raf=(typeof requestAnimationFrame==="function")?requestAnimationFrame:function(f){setTimeout(f,0);}; __raf(function(){ __geofamDirtyFrame=false; }); }',
  '  document.addEventListener("input", __geofamEmitDirty, true);',
  '  document.addEventListener("change", __geofamEmitDirty, true);',
  '  post({v:1,type:"ready",payload:{toolId:TOOL_ID}});',
  '})();',
  '',
  '/* Coefficients partiels NORMATIFS (NA France DA2 + fluage 14.2.2) — AUTORITATIFS SERVEUR.',
  '   Le contrat REJETTE (400) toute valeur non normative : on envoie la constante, jamais les',
  '   champs editables de l\\u2019onglet 04 (audit adverse : coeffs falsifiables -> verdict truque). */',
  'var CASAGRANDE_COEFFS={k_gG:1.35,k_gQ:1.5,k_gb:1.1,k_gs:1.1,k_gst:1.15,k_psi2:0.3,cr_b_b:0.7,cr_b_s:0.7,cr_f_b:0.5,cr_f_s:0.7,cr_car:0.9,cr_qp:1.1,cr_car_t:1.1,cr_qp_t:1.5};',
  '',
  '/* Nombre fini de la sortie serveur, sinon NaN (les renderers affichent « — » via fmt). */',
  'function sv(v){ return (typeof v==="number" && isFinite(v)) ? v : NaN; }',
  '/* Echappement HTML minimal (messages d\\u2019erreur). */',
  'function escPieux(s){ return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }',
  '/* Message d\\u2019erreur borne (402 EXPIRED/QUOTA, 403 MODULE_NOT_IN_PACK, pont). */',
  'function fmtCalcErr(err){ if(!err) return "Réponse de calcul vide."; if(typeof err==="string") return err; var m=err.message||"Calcul indisponible."; var r=err.reason?(" ("+err.reason+")"):""; return m+r; }',
  '',
  '/* ETAT outil -> PieuxInputSchema. Reprise fidele des champs (aucune conversion d\\u2019unite).',
  '   section « carr » (HTML) -> « carre » (contrat). coeffs = constante normative. */',
  'function buildPieuxInput(withFn){',
  '  var geom={ section:(state.section==="carr"?"carre":state.section) };',
  "  var B=num('g_B'); if(B>0) geom.g_B=B;",
  "  var b2=num('g_b2'); if(b2>0) geom.g_b2=b2;",
  "  var Ap=num('g_Ap'); if(Ap>0) geom.g_Ap=Ap;",
  "  var P=num('g_P'); if(P>0) geom.g_P=P;",
  '  var p=curPile();',
  '  var layers=(state.layers||[]).map(function(L){ var o={ soil:L.soil, th:+L.th };',
  '    if(L.pl!=null) o.pl=+L.pl; if(L.em!=null) o.em=+L.em; if(L.qc!=null) o.qc=+L.qc;',
  '    if(L.c!=null) o.c=+L.c; if(L.phi!=null) o.phi=+L.phi; if(L.gamma!=null) o.gamma=+L.gamma; return o; });',
  '  var pts=((state.cpt&&state.cpt.pts)?state.cpt.pts:[]).map(function(q){ return { z:+q.z, qc:+q.qc }; });',
  '  var inp={ geom:geom, g_z0:num("g_z0"), g_D:num("g_D"), cat:p.cat,',
  '    meth:state.meth, da:state.da, sens:state.sens, essais:state.essais,',
  '    c_G:num("c_G"), c_Q:num("c_Q"), o_nappe:num("o_nappe"),',
  '    o_nprofil:Math.max(1,Math.round(num("o_nprofil"))||1), o_surf:num("o_surf"),',
  '    o_redis:(($("o_redis")&&$("o_redis").value==="oui")?"oui":"non"),',
  '    grp:{ grp_n:Math.max(1,Math.round(num("grp_n"))||1), grp_m:Math.max(1,Math.round(num("grp_m"))||1), grp_s:num("grp_s") },',
  '    coeffs:CASAGRANDE_COEFFS, layers:layers,',
  '    cpt:{ step:((state.cpt&&state.cpt.step)||0.2), pts:pts },',
  '    beton:{ arm:state.arm, k3:state.k3 } };',
  '  var fck=num("b_fck"); if(fck>0) inp.beton.b_fck=fck;',
  '  var nom=$("p_nom"); if(nom&&nom.value) inp.projet=String(nom.value).slice(0,200);',
  '  var pieu=$("p_pieu"); if(pieu&&pieu.value) inp.pieu=String(pieu.value).slice(0,200);',
  '  if(withFn){ inp.frottementNegatif={ mode:(state.fnmode||"auto"), fn_Q:num("fn_Q"), fn_ktd:num("fn_ktd"),',
  '    fn_s0:num("fn_s0"), fn_hc:num("fn_hc"), fn_zt:num("fn_zt"), fn_zb:num("fn_zb") }; }',
  '  return inp;',
  '}',
  '',
  '/* Contexte geometrique reconstruit depuis la SAISIE (public : aires/perimetres/zone',
  "   d'influence). Aucune science NF P 94-262 (pas de k_p, p_le, D_ef). */",
  'function pieuxGeomCtx(){',
  '  var PG=pileGeom(); var layers=layerTops(); var D=num("g_D"), z0=num("g_z0");',
  '  var a=Math.max((PG.B||0.6)/2,0.5);',
  '  var baseLayer=soilAt(D-0.01,layers)||(layers.length?layers[layers.length-1]:{soil:"argile",ztop:0});',
  '  var hInLayer=baseLayer?D-baseLayer.ztop:0; var b=Math.min(a,Math.max(hInLayer,0.001));',
  '  return { PG:PG, layers:layers, D:D, z0:z0, a:a, b:b, baseLayer:baseLayer, hInLayer:hInLayer };',
  '}',
  '',
  '/* SORTIE whitelistee (PieuxOutputSchema) -> objet R attendu par renderResults CONSERVE.',
  '   Whitelistes BRANCHES : allOk/tauxGouvernant/warnings/methode/sens + resistances',
  '   RbK/RsK/RcK/RcD/RcrK + Rb/Rs bruts + xi3/xi4/gammaRd1 + Def/debR + Ce + fric[] +',
  '   tassementELS/FdCar/verifications/categorie. Le sous-texte qbDetail est reconstruit des',
  '   scalaires ple/qce/kfac/kmax/debR (methode-dependant). RESIDUS FERMES -> NaN/« — » : RbD/RsD',
  '   (coeffs partiels gouvernants non exposes ; RcD total l\\u2019est) et CeF (effet de groupe',
  '   non-flottant, science confidentielle). Geometrie (Ab/perim/a/b/baseLayer/D/z0/cat/cls)',
  '   reconstruite depuis la SAISIE (publique). */',
  'function mapPieuxOutput(out){',
  '  var g=pieuxGeomCtx(); var p=curPile();',
  '  var checks=(Array.isArray(out.verifications)?out.verifications:[]).map(function(v){',
  '    return { nom:(typeof v.nom==="string"?v.nom:""), comb:"", Fd:sv(v.Fd), Rd:sv(v.Rd) }; });',
  '  var ct=(out.courbeTassement&&Array.isArray(out.courbeTassement.pts))?out.courbeTassement:null;',
  '  /* Frottement lateral par couche (out.fric[], whitelist elargie) -> tableau consomme',
  '     tel quel par renderResults (soil/top/bot/dz/qs/dRs). null/[] si non fourni. */',
  '  var fric=(Array.isArray(out.fric)?out.fric:[]).map(function(f){',
  '    return { soil:(typeof f.soil==="string"?f.soil:"argile"), top:sv(f.top), bot:sv(f.bot),',
  '      dz:sv(f.dz), qs:sv(f.qs), dRs:sv(f.dRs), qsm:(f.qsm==null?null:sv(f.qsm)), deg:(f.deg===true) }; });',
  '  /* Sous-texte de la KPI R_b (detail de portance) reconstruit depuis les SCALAIRES',
  '     serveur whitelistes (ple/qce/debR/kfac/kmax) — jamais une re-derivation de science.',
  '     L\\u2019ecretage q_ce (cap) et le detail c-\\u03c6 (Nc/\\u03c3\\u2032v) restent confidentiels -> omis. */',
  '  var meth=(out.methode||state.meth);',
  '  var qbDetail="\\u2014";',
  '  if(meth==="pmt" && out.ple!=null){',
  '    qbDetail="p<sub>le</sub>* = "+fmt(sv(out.ple),2)+" MPa (zone D\\u2212b\\u2026D+3a) \\u00b7 D<sub>ef</sub>/B = "+fmt(sv(out.debR),1)+" (int\\u00e9gr\\u00e9 sur 10B au\\u2011dessus de la pointe) \\u00b7 k<sub>p</sub> = "+fmt(sv(out.kfac),2)+" (k<sub>p,max</sub>="+fmt(sv(out.kmax),2)+")";',
  '  } else if(meth==="cpt" && out.qce!=null){',
  '    qbDetail="q<sub>ce</sub> = "+fmt(sv(out.qce),2)+" MPa \\u00b7 D<sub>ef</sub>/B = "+fmt(sv(out.debR),1)+" (int\\u00e9gr\\u00e9 sur 10B au\\u2011dessus de la pointe) \\u00b7 k<sub>c</sub> = "+fmt(sv(out.kfac),2)+" (k<sub>c,max</sub>="+fmt(sv(out.kmax),2)+")";',
  '  } else if(meth==="cphi" && out.kfac!=null){',
  '    qbDetail="N<sub>q</sub> = "+fmt(sv(out.kfac),1)+" \\u00b7 D<sub>ef</sub>/B = "+fmt(sv(out.debR),1);',
  '  }',
  '  return {',
  '    err:null, allOk:(out.allOk===true), sens:(out.sens||state.sens),',
  '    warn:(Array.isArray(out.warnings)?out.warnings.slice():[]), meth:(out.methode||state.meth),',
  '    govern:sv(out.tauxGouvernant), da:state.da,',
  '    Rb:sv(out.Rb), qbDetail:qbDetail, Rs:sv(out.Rs), D:g.D, z0:g.z0, RcD:sv(out.RcD),',
  '    settle:{ sEls:sv(out.tassementELS), pts:(ct?ct.pts:[]), EM:NaN, fine:null, Fmax:(ct&&isFinite(ct.Fmax)?ct.Fmax:0) },',
  '    RbK:sv(out.RbK), RbD:NaN, RsK:sv(out.RsK), RsD:NaN, RcK:sv(out.RcK), RcrK:sv(out.RcrK),',
  '    xi3:sv(out.xi3), xi4:sv(out.xi4), N:Math.max(1,Math.round(num("o_nprofil"))||1),',
  '    Sinv:Math.min(2500,Math.max(100,(num("o_surf")>0?num("o_surf"):2500))),',
  '    redis:($("o_redis")&&$("o_redis").value==="oui"), grd:sv(out.gammaRd1),',
  '    checks:checks, G:num("c_G"), Q:num("c_Q"), fric:fric,',
  '    cat:(isFinite(out.categorie)?out.categorie:p.cat), pile:p, cls:p.cls,',
  '    Ab:g.PG.Ab, perim:g.PG.perim, Def:sv(out.Def), debR:sv(out.debR),',
  '    baseLayer:(g.baseLayer||{soil:"argile"}), b:g.b, a:g.a, Ce:sv(out.Ce), CeF:NaN, FdCar:sv(out.FdCar)',
  '  };',
  '}',
  '',
  '/* Courbe de portance en profondeur — rendue UNIQUEMENT si le serveur fournit',
  '   courbePortance.rows [{D,elufond,eluacc,elscar,elsqp}] (elargissement gouverne, cf.',
  '   en-tete). Coupe stratigraphique + reperes de sollicitation depuis la SAISIE. */',
  'function portanceSvgFromServer(Dcur, cp){',
  '  var rows=cp.rows; var layers=layerTops(); var z0=num("g_z0");',
  '  var Hsol=layers.length?layers[layers.length-1].zbot:0; if(!(Hsol>z0)) return "";',
  '  var series=[{key:"elufond",lab:"ELU fondamentales",color:"#BC3B2A"},{key:"eluacc",lab:"ELU accidentelles",color:"#5A6B79"},{key:"elscar",lab:"ELS caractéristiques",color:"#0E7490"},{key:"elsqp",lab:"ELS quasi-permanentes",color:"#C0872B"}];',
  '  var maxCap=1; rows.forEach(function(r){ series.forEach(function(s){ if(isFinite(r[s.key])&&r[s.key]>maxCap) maxCap=r[s.key]; }); }); maxCap*=1.06;',
  '  var G=num("c_G"), Q=num("c_Q"), loadCar=G+Q, loadElu=1.35*G+1.5*Q;',
  '  var W=720,H=470,mT=26,mB=42,stripX=46,stripW=26,plotL=92,mR=18;',
  '  var Y=function(z){ return mT+((z-z0)/(Hsol-z0))*(H-mT-mB); };',
  '  var X=function(v){ return plotL+(v/maxCap)*(W-plotL-mR); };',
  '  var g=\'<rect x="0" y="0" width="\'+W+\'" height="\'+H+\'" fill="#FBFCFE"/>\';',
  '  var SC={argile:"var(--s-argile)",sable:"var(--s-sable)",craie:"var(--s-craie)",marne:"var(--s-marne)",roche:"var(--s-roche)"};',
  '  layers.forEach(function(L){ var yt=Y(Math.max(L.ztop,z0)), yb=Y(L.zbot); if(yb<=yt) return; g+=\'<rect x="\'+stripX+\'" y="\'+yt+\'" width="\'+stripW+\'" height="\'+(yb-yt)+\'" fill="\'+(SC[L.soil]||"#ccc")+\'" stroke="#fff" stroke-width="1"/>\'; });',
  '  var nz=Math.min(10,Math.max(4,Math.round((Hsol-z0)/2))), i;',
  '  for(i=0;i<=nz;i++){ var z=z0+(Hsol-z0)*i/nz, y=Y(z); g+=\'<line x1="\'+plotL+\'" y1="\'+y+\'" x2="\'+(W-mR)+\'" y2="\'+y+\'" stroke="#EEF2F7"/><text x="\'+(stripX-4)+\'" y="\'+(y+3)+\'" font-size="8.5" fill="#7A8794" text-anchor="end" font-family="var(--mono)">\'+z.toFixed(0)+\'</text>\'; }',
  '  for(i=0;i<=4;i++){ var v=maxCap*i/4, x=X(v); g+=\'<line x1="\'+x+\'" y1="\'+mT+\'" x2="\'+x+\'" y2="\'+(H-mB)+\'" stroke="#EEF2F7"/><text x="\'+x+\'" y="\'+(H-mB+14)+\'" font-size="8.5" fill="#7A8794" text-anchor="middle" font-family="var(--mono)">\'+(v/1000).toFixed(1)+\'</text>\'; }',
  '  g+=\'<text x="\'+(plotL+(W-plotL-mR)/2)+\'" y="\'+(H-4)+\'" font-size="9" fill="#7A8794" text-anchor="middle" font-family="var(--mono)">Capacité du pieu (MN)</text>\';',
  '  [{v:loadElu,c:"#BC3B2A",t:"1,35G+1,5Q"},{v:loadCar,c:"#0E7490",t:"G+Q"}].forEach(function(L){ if(L.v>0&&L.v<maxCap){ var x=X(L.v); g+=\'<line x1="\'+x+\'" y1="\'+mT+\'" x2="\'+x+\'" y2="\'+(H-mB)+\'" stroke="\'+L.c+\'" stroke-dasharray="2 3" stroke-width="1" opacity=".7"/><text x="\'+x+\'" y="\'+(mT-4)+\'" font-size="8" fill="\'+L.c+\'" text-anchor="middle" font-family="var(--mono)">\'+L.t+\'</text>\'; } });',
  '  series.forEach(function(s){ var d=rows.map(function(r){ return X(r[s.key])+" "+Y(r.D); }); g+=\'<path d="M\'+d.join(" L")+\'" fill="none" stroke="\'+s.color+\'" stroke-width="2"/>\'; });',
  '  if(Dcur>z0 && Dcur<=Hsol){ var yd=Y(Dcur); g+=\'<line x1="\'+plotL+\'" y1="\'+yd+\'" x2="\'+(W-mR)+\'" y2="\'+yd+\'" stroke="#0E2330" stroke-dasharray="4 3" stroke-width="1.2"/><text x="\'+(W-mR)+\'" y="\'+(yd-4)+\'" font-size="8.5" fill="#0E2330" text-anchor="end" font-family="var(--mono)">D = \'+Dcur.toFixed(1)+\' m</text>\'; }',
  "  var svg='<svg viewBox=\"0 0 '+W+' '+H+'\" width=\"100%\" style=\"display:block\">'+g+'</svg>';",
  '  var legend=\'<div class="coupe-legend" style="border-top:1px solid var(--line)">\'+series.map(function(s){ return \'<span><span class="swatch" style="background:\'+s.color+\'"></span>\'+s.lab+\'</span>\'; }).join("")+\'</div>\';',
  '  return \'<div class="card" style="margin-top:20px"><div class="hd"><h2>Courbe de portance avec la profondeur</h2><span class="tag">servie serveur</span></div><div class="bd" style="padding:14px 14px 0">\'+svg+\'</div>\'+legend+\'</div>\';',
  '}',
  '',
  '/* 3 profils de frottement negatif — rendus UNIQUEMENT si le serveur fournit prof',
  '   [{z,w,g,f,qsP,qsN,N}] (elargissement gouverne). Port fidele de drawDowndrag. */',
  'function downdragSvg(prof, m){',
  '  var PW=292, H=440, mT=24, mB=34, mL=40, mR=14, gap=18;',
  '  var Y=function(z){ return mT+((z-m.z0)/(m.D-m.z0))*(H-mT-mB); };',
  '  function axisDepth(){ var g="", i; for(i=0;i<=6;i++){ var z=m.z0+(m.D-m.z0)*i/6, y=Y(z); g+=\'<line x1="\'+mL+\'" y1="\'+y+\'" x2="\'+(PW-mR)+\'" y2="\'+y+\'" stroke="#E6ECF2"/><text x="\'+(mL-5)+\'" y="\'+(y+3)+\'" font-size="8.5" fill="#7A8794" text-anchor="end" font-family="var(--mono)">\'+z.toFixed(0)+\'</text>\'; } return g; }',
  '  function panel(title, xmin, xmax, unit, sers, extra){',
  '    var X=function(v){ return mL+((v-xmin)/(xmax-xmin||1))*(PW-mL-mR); };',
  '    var g=\'<rect x="0" y="0" width="\'+PW+\'" height="\'+H+\'" fill="#FBFCFE"/>\'+axisDepth(); var i;',
  '    for(i=0;i<=3;i++){ var v=xmin+(xmax-xmin)*i/3, x=X(v); g+=\'<line x1="\'+x+\'" y1="\'+mT+\'" x2="\'+x+\'" y2="\'+(H-mB)+\'" stroke="#EEF2F7"/><text x="\'+x+\'" y="\'+(H-mB+13)+\'" font-size="8" fill="#7A8794" text-anchor="middle" font-family="var(--mono)">\'+(Math.abs(v)>=100?v.toFixed(0):v.toFixed(unit==="m"?2:1))+\'</text>\'; }',
  '    if(xmin<0&&xmax>0){ var x0=X(0); g+=\'<line x1="\'+x0+\'" y1="\'+mT+\'" x2="\'+x0+\'" y2="\'+(H-mB)+\'" stroke="#C2CDD8" stroke-width="1"/>\'; }',
  '    if(extra) g+=extra(X,Y);',
  '    sers.forEach(function(s){ var pts=s.data.map(function(d,k){ return (k?"L":"M")+X(d.v)+" "+Y(d.z); }).join(" "); g+=\'<path d="\'+pts+\'" fill="none" stroke="\'+s.color+\'" stroke-width="\'+(s.w||2)+\'"\'+(s.dash?\' stroke-dasharray="\'+s.dash+\'"\':"")+\'/>\'; });',
  '    g+=\'<text x="\'+(PW/2)+\'" y="14" font-size="10" fill="#0E2330" text-anchor="middle" font-family="var(--disp)" font-weight="600">\'+title+\'</text>\';',
  '    g+=\'<text x="\'+(PW/2)+\'" y="\'+(H-3)+\'" font-size="8" fill="#7A8794" text-anchor="middle" font-family="var(--mono)">\'+unit+\'</text>\'; return g;',
  '  }',
  '  var teal="#0E7490", ochre="#C0872B", red="#BC3B2A", ink="#0E2330";',
  '  var imp=(m.mode==="impose");',
  '  var band=imp?function(X,Yf){ return \'<rect x="\'+mL+\'" y="\'+Yf(m.zt)+\'" width="\'+(PW-mL-mR)+\'" height="\'+Math.max(0,Yf(m.zb)-Yf(m.zt))+\'" fill="rgba(188,59,42,.07)"/>\'; }:null;',
  '  var withBand=function(extra){ return function(X,Yf){ return (band?band(X,Yf):"")+(extra?extra(X,Yf):""); }; };',
  '  var wmax=1e-3; prof.forEach(function(p){ var mm=Math.max(p.w,p.g); if(mm>wmax) wmax=mm; }); wmax*=1.05;',
  '  var s1=[{data:prof.map(function(p){ return {z:p.z,v:p.w*1000}; }),color:teal,w:2}];',
  '  if(!imp) s1.unshift({data:prof.map(function(p){ return {z:p.z,v:p.g*1000}; }),color:ochre,w:2});',
  '  var p1=panel(imp?"Tassement du pieu":"Tassement sol / pieu",0,wmax*1000,"mm",s1,band?withBand(null):null);',
  '  var fM=10; prof.forEach(function(p){ [p.f,p.qsP,p.qsN].forEach(function(x){ if(Math.abs(x)>fM) fM=Math.abs(x); }); }); fM*=1.05;',
  '  var p2=panel("Frottement axial",-fM,fM,"kPa",[',
  '    {data:prof.map(function(p){ return {z:p.z,v:p.qsP}; }),color:"#9AA8B4",w:1.3,dash:"4 3"},',
  '    {data:prof.map(function(p){ return {z:p.z,v:p.qsN}; }),color:red,w:1.3,dash:"4 3"},',
  '    {data:prof.map(function(p){ return {z:p.z,v:p.f}; }),color:teal,w:2.2}],',
  '    withBand(m.zN!=null?function(X,Yf){ return \'<line x1="\'+mL+\'" y1="\'+Yf(m.zN)+\'" x2="\'+(PW-mR)+\'" y2="\'+Yf(m.zN)+\'" stroke="\'+ink+\'" stroke-dasharray="2 3" stroke-width="1"/><text x="\'+(PW-mR)+\'" y="\'+(Yf(m.zN)-4)+\'" font-size="8" fill="\'+ink+\'" text-anchor="end" font-family="var(--mono)">point neutre</text>\'; }:null));',
  '  var Nmx=1; prof.forEach(function(p){ if(p.N>Nmx) Nmx=p.N; }); Nmx*=1.05;',
  '  var p3=panel("Effort axial N",0,Nmx,"kN",[{data:prof.map(function(p){ return {z:p.z,v:p.N}; }),color:teal,w:2.2}],',
  '    withBand(m.zN!=null?function(X,Yf){ return \'<line x1="\'+mL+\'" y1="\'+Yf(m.zN)+\'" x2="\'+(PW-mR)+\'" y2="\'+Yf(m.zN)+\'" stroke="\'+ink+\'" stroke-dasharray="2 3" stroke-width="1"/>\'; }:null));',
  "  var svg='<svg viewBox=\"0 0 '+(PW*3+gap*2)+' '+H+'\" width=\"100%\" style=\"display:block\"><g>'+p1+'</g><g transform=\"translate('+(PW+gap)+',0)\">'+p2+'</g><g transform=\"translate('+((PW+gap)*2)+',0)\">'+p3+'</g></svg>';",
  '  var legend=\'<div class="coupe-legend" style="border-top:1px solid var(--line)"><span><span class="swatch" style="background:\'+teal+\'"></span>Pieu</span>\'+(imp?\'<span><span class="swatch" style="background:rgba(188,59,42,.18)"></span>Zone de frottement négatif imposée</span>\':\'<span><span class="swatch" style="background:\'+ochre+\'"></span>Sol — tassement libre</span>\')+\'<span><span class="swatch" style="background:\'+red+\'"></span>q<sub>sn</sub></span></div>\';',
  '  return \'<div class="card"><div class="hd"><h2>Profils en profondeur</h2><span class="tag">t-z · servis serveur</span></div><div class="bd" style="padding:14px 14px 0">\'+svg+\'</div>\'+legend+\'</div>\';',
  '}',
  '/* =================== FIN BRIDGE + MAPPING =================== */',
].join('\n');

/** compute() RÉÉCRIT : async, garde no-calc-initial locale, bridge, mapping serveur. */
const CASAGRANDE_COMPUTE = [
  'async function compute(){',
  '  var layers=layerTops(); var z0=num("g_z0"), D=num("g_D");',
  '  if(!layers.length){ renderResults({err:"Aucune couche de sol définie (onglet 02)."}); return; }',
  '  if(D<=z0){ renderResults({err:"La profondeur de base D doit être supérieure à la profondeur de tête z\\u2080."}); return; }',
  '  var el=$("res-content"); if(el) el.innerHTML=\'<div class="notice">Calcul en cours\\u2026</div>\';',
  '  var resp;',
  '  try{ resp=await window.__geofamBridge.calc(buildPieuxInput(false)); }',
  '  catch(e){ renderResults({err:"Pont de calcul indisponible : "+((e&&e.message)||e)}); return; }',
  '  if(!resp || !resp.ok){ renderResults({err:fmtCalcErr(resp&&resp.error)}); return; }',
  '  window.__casagrandeLastCalcResultId=resp.calcResultId||null;',
  '  var out=resp.output||{};',
  '  if(out.erreur){ renderResults({err:out.erreur}); return; }',
  '  var g=pieuxGeomCtx();',
  '  try{ renderResults(mapPieuxOutput(out)); }catch(e){ if(el) el.innerHTML=\'<div class="verdict no"><span class="ic">!</span><div class="txt"><b>Erreur de rendu</b><div>\'+escPieux(e&&e.message)+\'</div></div></div>\'; }',
  '  try{ drawCoupe(g.D,g.a,g.b); }catch(e){}',
  '  if(state.meth==="cpt"){ try{ drawQcLog(g.D,g.a,g.b); }catch(e){} }',
  '  try{ drawBeton(out); }catch(e){}',
  '  try{ drawPortance(g.D,out); }catch(e){}',
  '}',
].join('\n');

/** computeDowndrag() RÉÉCRIT : async, garde locale, bridge (frottementNegatif), KPI whitelistés. */
const CASAGRANDE_DOWNDRAG = [
  'async function computeDowndrag(){',
  '  var host=$("fn-content"); if(!host) return;',
  '  var layers=layerTops();',
  '  if(!layers.length){ host.innerHTML=\'<div class="card"><div class="bd"><div class="coef-note">Définissez d\\u2019abord un profil de sol (onglet 03) et la géométrie du pieu (onglet 01), puis revenez ici. Le bouton \\u00ab Reprendre Q et la coupe du projet \\u00bb initialise les données.</div></div></div>\'; return; }',
  '  var z0=num("g_z0"), D=num("g_D");',
  '  if(!(D>z0)){ host.innerHTML=\'<div class="card"><div class="bd"><div class="coef-note">Géométrie incomplète : la base D doit être sous la tête z\\u2080 (onglet 01).</div></div></div>\'; return; }',
  '  host.innerHTML=\'<div class="card"><div class="bd"><div class="coef-note">Calcul du frottement négatif\\u2026</div></div></div>\';',
  '  var resp;',
  '  try{ resp=await window.__geofamBridge.calc(buildPieuxInput(true)); }',
  '  catch(e){ host.innerHTML=\'<div class="card"><div class="bd"><div class="coef-note">Pont de calcul indisponible : \'+escPieux((e&&e.message)||e)+\'</div></div></div>\'; return; }',
  '  if(!resp || !resp.ok){ host.innerHTML=\'<div class="card"><div class="bd"><div class="coef-note">\'+escPieux(fmtCalcErr(resp&&resp.error))+\'</div></div></div>\'; return; }',
  '  window.__casagrandeLastCalcResultId=resp.calcResultId||null;',
  '  var out=resp.output||{};',
  '  if(out.erreur){ host.innerHTML=\'<div class="card"><div class="bd"><div class="coef-note">\'+escPieux(out.erreur)+\'</div></div></div>\'; return; }',
  '  var mode=state.fnmode||"auto";',
  '  var zt=Math.max(z0,num("fn_zt")||z0), zb=Math.min(D,num("fn_zb")||0);',
  '  if(mode==="impose" && zb<=zt) zb=Math.min(D,zt+0.01);',
  '  var pd=(out.profilsDowndrag&&Array.isArray(out.profilsDowndrag.prof))?out.profilsDowndrag:null;',
  '  drawDowndrag(pd?pd.prof:null, { z0:z0, D:D, B:(pileGeom().B||0.6), Q:num("fn_Q"),',
  '    Nmax:sv(out.Nmax), Gsn:sv(out.Gsn), zN:(out.pointNeutre==null?null:out.pointNeutre),',
  '    wHead:(pd&&isFinite(pd.wHead)?pd.wHead:NaN),',
  '    s0:num("fn_s0"), Hc:num("fn_hc"), KtanD:num("fn_ktd"), meth:state.meth, mode:mode, zt:zt, zb:zb });',
  '}',
].join('\n');

/** drawDowndrag() RÉÉCRIT : 4 KPI (N_max/G_sn/point neutre + wHead WHITELISTÉS via
 * profilsDowndrag.wHead) + 3 profils servis serveur (downdragSvg) ; absent = pas de carte
 * (port fidèle — l'outil natif dessine toujours), jamais de placeholder texte. */
const CASAGRANDE_DRAWDOWNDRAG = [
  'function drawDowndrag(prof, m){',
  '  var host=$("fn-content"); if(!host) return;',
  '  var kpis=\'<div class="kpi-grid" style="grid-template-columns:repeat(4,1fr)">\'',
  '    +\'<div class="kpi accent"><div class="lab">Effort axial max</div><div class="val">\'+fmt(m.Nmax/1000,2)+\'<span class="un">MN</span></div><div class="sub">au point neutre</div></div>\'',
  '    +\'<div class="kpi"><div class="lab">Frottement négatif G<sub>sn</sub></div><div class="val">\'+fmt(m.Gsn/1000,2)+\'<span class="un">MN</span></div><div class="sub">N<sub>max</sub> \\u2212 Q</div></div>\'',
  '    +\'<div class="kpi"><div class="lab">Point neutre</div><div class="val">\'+(m.zN!=null?fmt(m.zN,1):"\\u2014")+\'<span class="un">m</span></div><div class="sub">déplacement relatif nul</div></div>\'',
  '    +\'<div class="kpi blue"><div class="lab">Tassement tête pieu</div><div class="val">\'+fmt(m.wHead,1)+\'<span class="un">mm</span></div><div class="sub">\'+(m.mode==="impose"?("zone F.N. : "+fmt(m.zt,1)+"\\u2013"+fmt(m.zb,1)+" m"):("sol en surface : "+fmt(m.s0,0)+" mm"))+\'</div></div>\'',
  "    +'</div>';",
  '  /* profilsDowndrag servi par le serveur (whitelist elargie) -> 3 panneaux SVG (port',
  '     fidele de drawDowndrag d\\u2019origine). Absent = pas de carte (l\\u2019outil natif dessine',
  '     toujours ; les KPI de synthese ci-dessus restent affiches). */',
  '  var fig="";',
  '  if(prof && prof.length){ try{ fig=downdragSvg(prof,m); }catch(e){ fig=""; } }',
  '  host.innerHTML=kpis+fig',
  '    +\'<div class="notice" style="margin-top:18px">Le frottement négatif (G<sub>sn</sub> = \'+fmt(m.Gsn/1000,2)+\' MN) est une action permanente à <b>ajouter</b> à la charge en tête pour les vérifications (ch. 11 du guide). Au-dessus du point neutre (\'+(m.zN!=null?fmt(m.zN,1)+" m":"\\u2014")+\') le sol entraîne le pieu vers le bas ; en dessous, frottement positif et pointe équilibrent l\\u2019effort maximal N<sub>max</sub> = \'+fmt(m.Nmax/1000,2)+\' MN. Modèle t-z à valider par une étude \\u0153dométrique.</div>\';',
  '}',
].join('\n');

/** drawSettle() RÉÉCRIT : courbe charge-tassement si servie (courbeTassement), sinon
 * message natif « Tassement non calculable (résistance nulle) » (port fidèle). */
const CASAGRANDE_DRAWSETTLE = [
  'function drawSettle(s,Fels){',
  '  var svg=$("settle-svg"); if(!svg) return;',
  '  var W=420,H=300,mL=52,mR=16,mT=14,mB=40, i;',
  '  if(!s || !s.pts || !s.pts.length || !(s.Fmax>0)){',
  '    svg.innerHTML=\'<rect x="0" y="0" width="\'+W+\'" height="\'+H+\'" fill="#F7F9FC"/>\'',
  '      +\'<text x="\'+(W/2)+\'" y="\'+(H/2)+\'" font-size="11" fill="#8A92A0" text-anchor="middle" font-family="monospace">Tassement non calculable (résistance nulle)</text>\';',
  '    return;',
  '  }',
  '  var maxF=s.Fmax, arrS=s.pts.map(function(p){ return p.s; }).concat([s.sEls]);',
  '  var maxS=(Math.max.apply(null,arrS)*1.1)||10;',
  '  var X=function(f){ return mL+(f/maxF)*(W-mL-mR); }, Y=function(ss){ return mT+(ss/maxS)*(H-mT-mB); };',
  '  var g=\'<rect x="0" y="0" width="\'+W+\'" height="\'+H+\'" fill="#F7F9FC"/>\';',
  '  for(i=0;i<=5;i++){ var y=mT+(H-mT-mB)*i/5, val=maxS*i/5; g+=\'<line x1="\'+mL+\'" y1="\'+y+\'" x2="\'+(W-mR)+\'" y2="\'+y+\'" stroke="#E5EAF1"/><text x="\'+(mL-6)+\'" y="\'+(y+3)+\'" font-size="9" fill="#8A92A0" text-anchor="end" font-family="monospace">\'+val.toFixed(0)+\'</text>\'; }',
  '  for(i=0;i<=4;i++){ var x=mL+(W-mL-mR)*i/4, vf=maxF*i/4; g+=\'<line x1="\'+x+\'" y1="\'+mT+\'" x2="\'+x+\'" y2="\'+(H-mB)+\'" stroke="#EEF1F6"/><text x="\'+x+\'" y="\'+(H-mB+14)+\'" font-size="9" fill="#8A92A0" text-anchor="middle" font-family="monospace">\'+(vf/1000).toFixed(1)+\'</text>\'; }',
  '  var path=s.pts.map(function(p,k){ return (k?"L":"M")+X(p.F)+" "+Y(p.s); }).join(" ");',
  '  g+=\'<path d="\'+path+\'" fill="none" stroke="var(--amber)" stroke-width="2"/>\';',
  '  g+=\'<line x1="\'+X(Fels)+\'" y1="\'+mT+\'" x2="\'+X(Fels)+\'" y2="\'+(H-mB)+\'" stroke="var(--blue)" stroke-dasharray="4 3" stroke-width="1.2"/>\';',
  '  g+=\'<circle cx="\'+X(Fels)+\'" cy="\'+Y(s.sEls)+\'" r="4" fill="var(--blue)"/>\';',
  '  g+=\'<text x="\'+(X(Fels)+5)+\'" y="\'+(Y(s.sEls)-6)+\'" font-size="9.5" fill="var(--blue)" font-family="monospace">\'+s.sEls.toFixed(1)+\' mm</text>\';',
  '  g+=\'<text x="\'+(W/2)+\'" y="\'+(H-4)+\'" font-size="9.5" fill="#8A92A0" text-anchor="middle" font-family="monospace">Charge F (MN)</text>\';',
  '  g+=\'<text x="12" y="\'+(H/2)+\'" font-size="9.5" fill="#8A92A0" text-anchor="middle" font-family="monospace" transform="rotate(-90 12 \'+(H/2)+\')">Tassement (mm)</text>\';',
  '  svg.innerHTML=g;',
  '}',
].join('\n');

/** drawBeton() RÉÉCRIT : verdict/taux/f_cd depuis la sortie WHITELISTÉE ; σ appliquées « — ». */
const CASAGRANDE_DRAWBETON = [
  'function drawBeton(out){',
  '  var el=$("res-content"); if(!el) return;',
  '  var applicable=out.betonApplicable;',
  '  if(applicable===false){',
  '    el.insertAdjacentHTML("beforeend", \'<div class="card" style="margin-top:20px"><div class="hd"><h2>Résistance du béton (structure)</h2><span class="tag">§4.4</span></div><div class="bd"><div class="coef-note" style="margin:0">Vérification non applicable : pieu en traction (résistance assurée par les armatures) ou catégorie non couverte (acier, préfabriqué, micropieu, injecté).</div></div></div>\');',
  '    return;',
  '  }',
  '  if(applicable==null) return;',
  '  var okELU=(out.betonOkELU===true), okELS=(out.betonOkELS===true), ok=okELU&&okELS;',
  '  var taux=Math.max((isFinite(out.betonTauxELU)?out.betonTauxELU:0),(isFinite(out.betonTauxELS)?out.betonTauxELS:0));',
  '  var verdict=\'<div class="verdict \'+(ok?"ok":"no")+\'" style="margin:0 0 16px"><div class="ic">\'+(ok?"\\u2713":"\\u2717")+\'</div><div class="txt"><b>Béton \'+(ok?"vérifié":"NON vérifié")+\'</b><div>Contrainte la plus défavorable : \'+fmt(taux*100,0)+\' % \\u00b7 f<sub>cd</sub> = \'+fmt(out.betonFcd,1)+\' MPa</div></div></div>\';',
  '  var rows=\'<tr><td class="lbl">\\u03c3 ELU = N<sub>d</sub>/A<sub>b</sub></td><td class="r">\\u2014</td><td class="r">\'+fmt(out.betonFcd,2)+\'</td><td class="r"><span class="\'+(okELU?"pass":"fail")+\'">\'+fmt(out.betonTauxELU*100,0)+\' %</span></td><td class="r">\'+(okELU?"\\u2713":"\\u2717")+\'</td></tr>\'',
  '    +\'<tr><td class="lbl">\\u03c3 ELS car. = N<sub>ser</sub>/A<sub>b</sub></td><td class="r">\\u2014</td><td class="r">\\u2014</td><td class="r"><span class="\'+(okELS?"pass":"fail")+\'">\'+fmt(out.betonTauxELS*100,0)+\' %</span></td><td class="r">\'+(okELS?"\\u2713":"\\u2717")+\'</td></tr>\';',
  '  el.insertAdjacentHTML("beforeend", \'<div class="card" style="margin-top:20px"><div class="hd"><h2>Résistance du béton (structure)</h2><span class="tag">NF P 94-262 §4.4</span></div><div class="bd">\'+verdict+\'<table class="res"><tr><th>Combinaison</th><th class="r">\\u03c3 (MPa)</th><th class="r">limite (MPa)</th><th class="r">taux</th><th class="r"></th></tr>\'+rows+\'</table><div class="coef-note" style="margin-top:14px">Résistance de calcul du béton f<sub>cd</sub> = \'+fmt(out.betonFcd,1)+\' MPa (NF P 94-262 §4.4). Les contraintes appliquées \\u03c3 et le détail des facteurs (C<sub>max</sub>, k\\u2081, k\\u2082, f<sub>ck</sub>*) sont calculés côté serveur.</div></div></div>\');',
  '}',
].join('\n');

/** drawPortance() RÉÉCRIT : courbe si servie (courbePortance), sinon rien (port fidèle —
 * l'outil natif ne dessine pas de carte quand la série a moins de 2 points). */
const CASAGRANDE_DRAWPORTANCE = [
  'function drawPortance(Dcur, out){',
  '  var el=$("res-content"); if(!el) return;',
  '  /* courbePortance servie par le serveur (grille re-echantillonnee) -> SVG. Absente =',
  '     pas de carte (l\\u2019outil natif ne dessine rien quand la serie a < 2 points). */',
  '  if(out && out.courbePortance && Array.isArray(out.courbePortance.rows) && out.courbePortance.rows.length>=2){',
  '    try{ var svg=portanceSvgFromServer(Dcur,out.courbePortance); if(svg){ el.insertAdjacentHTML("beforeend",svg); } }catch(e){}',
  '  }',
  '}',
].join('\n');

/** buildSoilCoefTable() RÉÉCRIT : libellés de sol conservés ; abaques (k_p/k_c/α/q_s,max)
 * « — » servies serveur (défaut NON — pas d'abaques NF P 94-262 côté navigateur). */
const CASAGRANDE_BUILDSOILCOEF = [
  'function buildSoilCoefTable(){',
  '  var t=$("soil-coef-table"); if(!t) return;',
  '  var p=curPile(); var cls=p.cls;',
  '  var h=\'<tr><th rowspan="2">Nature de sol</th><th colspan="2">Pointe \\u2014 classe \'+cls+\'</th><th colspan="2">Frottement pressio</th><th colspan="2">Frottement pénétro</th><th rowspan="2">q<sub>s,max</sub><br>(kPa)</th></tr><tr><th>k<sub>p,max</sub></th><th>k<sub>c,max</sub></th><th>courbe</th><th>\\u03b1<sub>PMT</sub></th><th>courbe</th><th>\\u03b1<sub>CPT</sub></th></tr>\';',
  "  Object.keys(SOILS).forEach(function(s){ h+='<tr><td><span class=\"swatch\" style=\"background:'+SOILS[s].color+'\"></span> '+SOILS[s].label+'</td><td>\\u2014</td><td>\\u2014</td><td>\\u2014</td><td>\\u2014</td><td>\\u2014</td><td>\\u2014</td><td>\\u2014</td></tr>'; });",
  '  h+=\'<tr><td colspan="8" style="font-size:10.5px;color:var(--color-text-secondary,#6b7280);text-align:left;line-height:1.5">Coefficients de portance et de frottement (Tableaux NF P 94-262 F.4.2.1 / G.4.2.1 / F.5.2 / G.5.2) appliqués côté serveur. Le facteur retenu k<sub>p</sub>/k<sub>c</sub> et son plafond figurent dans le détail de portance du panneau Résultats après calcul.</td></tr>\';',
  '  t.innerHTML=h;',
  '}',
].join('\n');

/** updateXiInfo() RÉÉCRIT : N/S depuis la saisie ; ξ₃/ξ₄ « servis serveur » (non whitelistés). */
const CASAGRANDE_UPDATEXI = [
  'function updateXiInfo(){',
  '  var el=$("xi-info"); if(!el) return;',
  '  var N=Math.max(1,Math.round(num("o_nprofil")));',
  '  var S=Math.min(2500,Math.max(100,(num("o_surf")>0?num("o_surf"):2500)));',
  '  var redis=$("o_redis") && $("o_redis").value==="oui";',
  '  el.innerHTML="N = "+N+" profil"+(N>1?"s":"")+" \\u00b7 S = "+fmt(S,0)+" m\\u00b2 (\\u221a(S/2500) = "+fmt(Math.sqrt(S/2500),2)+")"+(redis?" \\u00b7 \\u00f71,1":"")+" \\u2192 \\u03be\\u2083 \\u00b7 \\u03be\\u2084 servis côté serveur (Tableau C.2.4.2).";',
  '}',
].join('\n');

// ===========================================================================
// FASTLAB (labo + classification GTR) — patron d'excision DIFFERENT : pas de choke
// point. ~20 kernels calc* lisent le DOM, calculent ET ecrivent le DOM, enchaines par
// recalc(). On EXCISE tous les kernels + classify + helpers de calcul + tables de
// classification (subFine/subB/stateFromRatio), et on REECRIT recalc en un POST UNIQUE
// DEBOUNCE : le serveur renvoie TOUTES les valeurs derivees (agregats + detail par ligne
// + series de courbe + alertes normatives) ; les render* (injectes) ne CALCULENT plus,
// ils ECRIVENT la reponse serveur. Le module labo est INTEGRALEMENT client-safe (ADR
// 0014) : l'excision sert l'ENFORCEMENT du calcul serveur (entitlements/quota/PV, DoD
// §8/ADR 0002), pas la confidentialite d'une science.
// ---------------------------------------------------------------------------

/** Kernels de calcul + helpers + tables de decision EXCISES (audit-excision). Les
 * SPEC/tables de SAISIE normatives (MOULES/PRPROC/MDE_CLASS/SIEVES/CBR_ENF…), les draw*
 * (renderers canvas) et les helpers de rendu (chip/f/renderRecap/updateDots) restent
 * CONSERVES. mdeClassKey est CONSERVE (assiste la SAISIE via applyMdeVar). */
const FASTLAB_ENGINE_SYMBOLS = [
  'calcW',
  'calcGranulo',
  'granuloPts',
  'interpP',
  'dAt',
  'calcAtt',
  'calcVbs',
  'calcRhos',
  'rhoWaterT',
  'calcProctor',
  'fitPar',
  'calcCbr',
  'calcCisail',
  'rsq',
  'calcDens',
  'calcOedo',
  'calcUcs',
  'calcTriUU',
  'calcTriCU',
  'calcPerm',
  'calcEs',
  'calcLa',
  'calcSZ',
  'calcMde',
  'calcMdeCamp',
  'calcRho',
  'calcSulf',
  'classify',
  'subFine',
  'subB',
  'stateFromRatio',
  'lreg',
];

/** Pont postMessage (origine opaque) + DEBOUNCE + proxy Store + tous les render* (mapping
 * sortie serveur -> DOM). Injecte apres `const D={};` (helpers de base definis ; les
 * fonctions hoistees de rendu/saisie restent appelables au 1er recalc, jamais au boot). */
const FASTLAB_BRIDGE_AND_RENDER = [
  '/* ===================== BRIDGE + RENDER (injecte — clone excise, ADR 0015) ===================== */',
  '(function(){',
  '  var TOOL_ID="fastlab", ENGINE_ID="labo";',
  '  var pending=Object.create(null), stpend=Object.create(null), seq=0, stseq=0;',
  '  var ctx={ engineId:ENGINE_ID, orgSlug:null, projectLabel:null, readOnly:false };',
  '  function post(msg){ try{ window.parent.postMessage(msg,"*"); }catch(e){} }',
  '  window.addEventListener("message", function(ev){',
  '    if(ev.source !== window.parent) return;',
  '    var d=ev.data; if(!d || d.v!==1 || typeof d.type!=="string") return;',
  '    if(d.type==="init"){ ctx=Object.assign(ctx, d.payload||{}); return; }',
  '    if(d.type==="calc:response"){ var p=pending[d.id]; if(!p) return; delete pending[d.id]; p(d.payload||{ok:false,error:{message:"reponse vide"}}); return; }',
  '    if(d.type==="store:value"){ var pr=d.id?stpend[d.id]:null; if(pr){ delete stpend[d.id]; pr(d.payload&&d.payload.value); } return; }',
  '  });',
  '  window.__geofamBridge={',
  '    calc:function(params){ var id=TOOL_ID+":"+(++seq); return new Promise(function(resolve){ pending[id]=resolve; post({v:1,type:"calc:request",id:id,payload:{engineId:ENGINE_ID,label:(params&&params.m_ref)||null,params:params}}); }); },',
  '    emitPv:function(calcResultId){ post({v:1,type:"pv:request",payload:{calcResultId:calcResultId}}); },',
  '    storeGet:function(key){ var id=TOOL_ID+":s:"+(++stseq); return new Promise(function(resolve){ stpend[id]=resolve; post({v:1,type:"store:get",id:id,payload:{key:key}}); }); },',
  '    storeSet:function(key,value){ var id=TOOL_ID+":s:"+(++stseq); return new Promise(function(resolve){ stpend[id]=resolve; post({v:1,type:"store:set",id:id,payload:{key:key,value:value}}); }); },',
  '    context:function(){ return ctx; }',
  '  };',
  '  /* input:dirty (correctif PV BQ-1) : signale a l hote que l ecran a change apres un calcul',
  '     -> le bouton d emission du PV scelle se desactive jusqu au prochain calcul (evite un PV perime).',
  '     Emission IMMEDIATE (front de montee), NON debouncee : le bouton doit se desactiver des la 1re frappe.',
  '     Throttle ~1/frame par FLAG booleen (aucun delai temporel sur l emission) pour ne pas inonder l hote,',
  '     lui-meme idempotent. Listener DELEGUE au document (capture) : generique, sans connaitre le DOM de l outil.',
  '     Cible input/change uniquement (la donnee A change) — PAS click : naviguer entre onglets de',
  '     resultats ne change pas le calcul affiche (sinon on desactiverait le PV a tort). Un changement de',
  '     mode de calcul sans recalcul reste couvert cote hote : ce mode n a pas de calcResultId. */',
  '  var __geofamDirtyFrame=false;',
  '  function __geofamEmitDirty(){ if(__geofamDirtyFrame) return; __geofamDirtyFrame=true; post({v:1,type:"input:dirty",payload:{toolId:TOOL_ID}}); var __raf=(typeof requestAnimationFrame==="function")?requestAnimationFrame:function(f){setTimeout(f,0);}; __raf(function(){ __geofamDirtyFrame=false; }); }',
  '  document.addEventListener("input", __geofamEmitDirty, true);',
  '  document.addEventListener("change", __geofamEmitDirty, true);',
  '  post({v:1,type:"ready",payload:{toolId:TOOL_ID}});',
  '})();',
  '',
  'var __calcTimer=null;',
  'window.__laboLastClasse=null; window.__laboLastCalcResultId=null;',
  '/* Etat PLAUSIBLE : au moins une MESURE primaire saisie (memes ids que updateDots, hors',
  '   identification). Sur l etat vide (boot writeForm({})) on NE poste RIEN (no-calc-initial). */',
  'function plausibleState(o){',
  '  var ids=["gr_M","w_s1","ll_s1","v_V1","rs2_m0_1","d_m","pr_mh1","cb_tot0","ci_N1","oe_H0","uc_f","tu_df_1","tc_s1_1","pe_V","es_h2_1","la_m","sz_8","mde_present","ra_M1","su_ba"];',
  '  for(var i=0;i<ids.length;i++){ var v=o[ids[i]]; if(v!=null && v!=="") return true; } return false;',
  '}',
  '/* Seuils GTR de l onglet « Seuils » (CFG, SAISIE conservee) -> params serveur (cfg). */',
  'function cfgObject(){',
  '  try{ return { routeD:CFG.routeD, A_fines:CFG.A_fines, A_ip:CFG.A_ip, A_vbs:CFG.A_vbs, B_p2:CFG.B_p2, B_fines:CFG.B_fines, B_vbs01:CFG.B_vbs01, B_vbs56:CFG.B_vbs56, C_dmax:CFG.C_dmax, D_fines:CFG.D_fines, D_vbs:CFG.D_vbs, st:CFG.st, FR:CFG.FR, DG:CFG.DG }; }catch(e){ return undefined; }',
  '}',
  'function setHTML(id,h){ var e=$(id); if(e) e.innerHTML=h; }',
  'function renderCalcError(err){',
  '  var msg=(err&&err.message)?err.message:"Calcul indisponible.";',
  '  var el=$("result"); if(el) el.innerHTML=\'<div class="alert warn"><b>Calcul indisponible</b>\'+msg+\'</div>\';',
  '}',
  '/* Verdict de classification (mirroir du bloc verdict de recalc du HTML). caveats = ',
  '   l ancien classify().warn (encart « Points a verifier »). */',
  'function renderVerdict(cl){',
  '  var el=$("result"); if(!el) return;',
  '  if(!cl||!cl.code){ el.innerHTML=\'<div class="alert info"><b>En attente de donnees</b>Renseignez au minimum la granulometrie (passant 80 \\u00b5m) et la VBS ou l\\u2019Ip.</div>\'; return; }',
  "  var h='<div class=\"verdict\"><div class=\"classbadge\">'+cl.full+'</div><div class=\"desc\"><h3>Famille '+cl.fam+' \\u2014 '+cl.code+'</h3><p>'+(cl.desc||'')+'</p>'+((cl.etat&&cl.stApplies)?'<p class=\"sub\">\\u00c9tat hydrique : <b>'+cl.etat+'</b></p>':'')+'</div></div>';",
  "  h+='<div class=\"pathbox\"><div class=\"h\">Chemin de d\\u00e9cision</div><ol>'+((cl.path||[]).map(function(s){return '<li>'+s+'</li>';}).join(''))+'</ol></div>';",
  "  var cav=cl.caveats||[]; if(cav.length) h+='<div class=\"alert warn\"><b>Points \\u00e0 v\\u00e9rifier</b>'+cav.map(function(w){return '\\u00b7 '+w;}).join('<br>')+'</div>';",
  "  if(cl.rNote) h+='<div class=\"alert info\"><b>Assistant famille R (rocheux)</b>'+cl.rNote.join(' \\u00b7 ')+'<br><span class=\"sub\">Classement R complet selon nature + seuils LA/MDE/FR/DG (\\u00e0 finaliser avec le GTR).</span></div>';",
  '  el.innerHTML=h;',
  '}',
  '/* Teneur en eau — $(w_r i) + chips (miroir du kernel eau du HTML). */',
  'function renderW(w){',
  '  for(var i=1;i<=3;i++){ var v=(w&&w.rows&&w.rows[i-1]!=null)?w.rows[i-1]:null; var e=$("w_r"+i); if(e) e.textContent=(v==null?"\\u2014":v.toFixed(2)); }',
  '  setHTML("out_w", chip("w moyenne",f(w?w.moy:null,2),"%",true)+chip("Nb prises",w?w.n:0));',
  '}',
  '/* Granulometrie — refus/passant cumules par tamis + chips + courbe (D.granPts serveur). */',
  'function renderGran(det){',
  '  var g=det&&det.gran, rows=(g&&g.rows)||[];',
  '  for(var i=0;i<rows.length;i++){ var r=rows[i];',
  '    var sc=document.querySelector(\'.gr_cum[data-s="\'+r.s+\'"]\'); if(sc) sc.textContent=(r.cum==null?"\\u2014":r.cum.toFixed(1));',
  '    var sp=document.querySelector(\'.gr_pass[data-s="\'+r.s+\'"]\'); if(sp) sp.textContent=(r.pass==null?"\\u2014":r.pass.toFixed(1)); }',
  '  var out=chip("Dmax",f(D.dmax,(D.dmax!=null&&D.dmax<1)?2:0),"mm",true)+chip("P 80\\u00b5m",f(D.p80),"%",true)+chip("P 2mm",f(D.p2),"%")+chip("Cu",f(D.Cu))+chip("Cc",f(D.Cc,2));',
  '  if(D.mf!=null) out+=chip("Module finesse",f(D.mf,2),"",true)+chip("Sable",D.mfq);',
  '  setHTML("out_gran", out);',
  '  D.granPts=(g&&g.pts)||[]; try{ drawGran(); }catch(e){}',
  '}',
  '/* Atterberg — w par point (liquidite/plasticite) + chips + validite + nature + encart. */',
  'function renderAtt(att){',
  '  for(var i=1;i<=5;i++){ var v=(att&&att.llw&&att.llw[i-1]!=null)?att.llw[i-1]:null; var e=$("ll_w"+i); if(e) e.textContent=(v==null?"\\u2014":v.toFixed(2)); }',
  '  for(var j=1;j<=2;j++){ var v2=(att&&att.plw&&att.plw[j-1]!=null)?att.plw[j-1]:null; var e2=$("pl_w"+j); if(e2) e2.textContent=(v2==null?"\\u2014":v2.toFixed(2)); }',
  '  var wL=D.wl, ip=D.ip, wP=D.wp, ic=D.ic, np=($("pl_np")&&$("pl_np").checked);',
  '  var pts=(att&&att.points)||0, valide=att?att.valide:true, warns=(att&&att.warns)||[];',
  '  setHTML("out_ll", chip("wL",wL==null?null:wL,"%",true)+chip("Points",pts)+chip("Pente droite",(att&&att.pente!=null)?f(att.pente,2):null)+(valide?chip("Validit\\u00e9","\\u2713 conforme","",true):chip("Validit\\u00e9","\\u2717 \\u00e0 v\\u00e9rifier","!",true)));',
  '  var out=chip("wL",wL==null?null:wL,"%")+chip("wP",np?"NP":(wP==null?null:wP),np?"":"%")+chip("Ip",np?"NP":(ip==null?null:ip),"",true);',
  '  if(ic!=null) out+=chip("Ic",f(ic,2),"",true);',
  '  var nature=att?att.nature:null;',
  '  if(nature) out+=\'<div class="chip" style="min-width:auto"><div class="k">Nature</div><div class="v" style="font-size:12px;font-weight:600">\'+nature+\'</div></div>\';',
  "  setHTML(\"out_att\", out+(warns.length?'<div class=\"alert warn\" style=\"width:100%\"><b>Contr\\u00f4les NF P 94-051</b>'+warns.map(function(w){return '\\u00b7 '+w;}).join('<br>')+'</div>':''));",
  '  var raw=(att&&att.raw)||[]; var reg=(att&&att.pente!=null)?{a:att.pente,b:(att.wLraw!=null?att.wLraw-att.pente*Math.log10(25):0)}:null;',
  '  try{ drawLL(raw,reg,att?att.wLraw:null); drawPlast(wL,ip); }catch(e){}',
  '}',
  '/* VBS — M1/Mb/VBS 0-5/VBS du sol par essai + chips + alerte V<=10. */',
  'function renderVbs(v){',
  '  for(var i=1;i<=2;i++){ var r=(v&&v.rows&&v.rows[i-1])||{};',
  '    var a=$("v_M1_"+i); if(a) a.textContent=(r.M1==null?"\\u2014":r.M1.toFixed(2));',
  '    var b=$("v_Mb"+i); if(b) b.textContent=(r.Mb==null?"\\u2014":r.Mb.toFixed(2));',
  '    var c=$("v_v05_"+i); if(c) c.textContent=(r.v05==null?"\\u2014":r.v05.toFixed(2));',
  '    var d2=$("v_vsol"+i); if(d2) d2.textContent=(r.vs==null?"\\u2014":r.vs.toFixed(2)); }',
  '  var out=chip("VBS du sol (moyenne)",f(v?v.moy:null,2),"",true)+chip("VBS retenue",f(v?v.retenue:null,2),"",true)+chip("Essais",v?v.essais:0);',
  '  if(v&&v.manual!=null) out+=chip("Saisie directe",f(v.manual,2),"!");',
  '  if(v&&v.lowV) out+=\'<div class="alert warn" style="width:100%"><b>Contr\\u00f4le NF P 94-068 (art. 7)</b>\\u00b7 Volume de bleu V \\u2264 10 cm\\u00b3 : l\\u2019essai doit \\u00eatre recommenc\\u00e9 avec une prise d\\u2019essai de masse sup\\u00e9rieure.</div>\';',
  '  setHTML("out_vbs", out);',
  '}',
  '/* Proctor — w/rd par point + spec (mode operatoire + energie serveur) + chips + courbe. */',
  'function renderProctor(p){',
  '  var V=p?p.V:null; setv("pr_V",V!=null?V.toFixed(1):"");',
  '  var pts=[];',
  '  for(var i=1;i<=7;i++){ var r=(p&&p.rows&&p.rows[i-1])||{}; var a=$("pr_w"+i); if(a) a.textContent=(r.w==null?"\\u2014":r.w.toFixed(2)); var b=$("pr_rd"+i); if(b) b.textContent=(r.rd==null?"\\u2014":r.rd.toFixed(3)); if(r.w!=null&&r.rd!=null) pts.push([r.w,r.rd]); }',
  '  var spec=\'<b>\'+({n:"Normal",m45:"Modifi\\u00e9 4,5 kg",m15:"Modifi\\u00e9 15 kg"}[prType]||"")+\'.</b> \'+(PRSPEC[prType]||"");',
  '  var key=prType+"_"+($("pr_mould")?$("pr_mould").value:"A"); var PR=PRPROC[key];',
  "  if(PR){ var eline=\"\"; var en=p?p.energy:null; if(en){ eline=' \\u00b7 \\u00e9nergie calcul\\u00e9e <b>'+en.E.toFixed(3)+' MJ/m\\u00b3</b> '+(en.ok?'<span style=\"color:var(--ok)\">\\u2713 conforme</span>':'<span style=\"color:var(--bad)\">\\u26a0 \\u00e9cart > 8 %</span>'); }",
  "    spec+='<br><span style=\"display:inline-block;margin-top:6px\">Mode op\\u00e9ratoire normatif : dame <b>'+PR.m+' kg</b>, chute <b>'+PR.h+' mm</b>, <b>'+PR.L+' couches</b> \\u00d7 <b>'+PR.N+' coups</b>/couche.'+eline+'</span>'; }",
  '  else{ spec+=\'<br><span style="color:var(--bad)">\\u26a0 Combinaison moule + dame hors Tableau 5 : la dame 15 kg s\\u2019emploie avec le moule C ; les dames 2,5/4,5 kg avec les moules A ou B.</span>\'; }',
  '  setHTML("pr_spec", spec);',
  '  setHTML("out_proctor", chip("wOPN",f(D.wopn,1),"%",true)+chip("\\u03c1d max",f(D.rdmax,3),"t/m\\u00b3",true)+chip("Points",pts.length)+chip("Volume",f(V,0),"cm\\u00b3"));',
  '  var fit=(p&&p.fit)?{a:p.fit.a,b:p.fit.b,c:p.fit.c,wopn:p.wopn,rdmax:p.rdmax}:null;',
  '  try{ drawProctor(pts,fit); }catch(e){}',
  '}',
  '/* ===== RENDERERS PAR ESSAI (detail par ligne + chips fideles + canvas serveur) =====',
  '   Chaque render* ECRIT les cellules par ligne + les chips out_* A L IDENTIQUE du HTML',
  '   d origine, depuis le sous-objet detail.<essai> du SERVEUR (miroir DOM des kernels).',
  '   Les canvas conserves (drawCbrPen/drawCbrVar/drawCis/drawOedo) sont alimentes par les',
  '   SERIES serveur (varPts/reg/ptsP/curvePts). AUCUN calcul cote navigateur. */',
  'function celId(id,v,dg){ var e=$(id); if(e) e.textContent=(v==null||!isFinite(v))?"\\u2014":v.toFixed(dg); }',
  'function celSel(sel,v,dg){ var e=document.querySelector(sel); if(e) e.textContent=(v==null||!isFinite(v))?"\\u2014":v.toFixed(dg); }',
  '/* ρs — masse volumique des particules solides (md/ρs par determination + concordance). */',
  'function renderRhos(r){',
  '  r=r||{}; var rows=r.rows||[];',
  '  for(var i=0;i<3;i++){ var x=rows[i]||{}; celId("rs_md"+(i+1),x.md,2); celId("rs_rs"+(i+1),x.rs,3); }',
  '  setv("rs_rwT", r.rwT!=null?r.rwT.toFixed(5):"");',
  '  var out=chip("\\u03c1L utilis\\u00e9e",f(r.rLeff,4),"Mg/m\\u00b3")+chip("D\\u00e9terminations",r.essais||0)+chip("\\u03c1s moyenne",f(r.mean,2),"Mg/m\\u00b3",true);',
  '  if(r.spread!=null) out+=chip("\\u00c9cart",f(r.spread,3),"Mg/m\\u00b3")+chip("Concordance",r.ok?"\\u2713 \\u22640,03":"\\u2717 >0,03 \\u2192 r\\u00e9p\\u00e9ter",r.ok?"":"!",true);',
  '  else if((r.essais||0)===1) out+=chip("Concordance","2\\u1d49 d\\u00e9termination requise","!");',
  '  setHTML("out_rhos", out);',
  '}',
  '/* CBR multi-energies — par moule (net/ρh/ρd/compacite/gonflement/CBR 2,5-5-maxi) + 2 canvas. */',
  'function renderCbr(c){',
  '  c=c||{}; var rows=c.rows||[];',
  '  var ydmax=(num("cb_ydmax")!=null)?num("cb_ydmax"):D.rdmax; var ydAuto=(num("cb_ydmax")==null);',
  '  var wopt=(num("cb_wopt")!=null)?num("cb_wopt"):D.wopn;',
  '  var ep=$("cb_ydmax"); if(ep) ep.placeholder=(D.rdmax!=null?D.rdmax.toFixed(3)+" (Proctor)":"");',
  '  var ew=$("cb_wopt"); if(ew) ew.placeholder=(D.wopn!=null?D.wopn.toFixed(1)+" (Proctor)":"");',
  '  setHTML("cb_opmsrc", ydmax!=null?("\\u03c1<sub>d max</sub> = <b>"+ydmax.toFixed(3)+"</b> Mg/m\\u00b3, w<sub>OPM</sub> = <b>"+(wopt!=null?wopt.toFixed(1):"\\u2014")+"</b> % "+((ydAuto&&D.rdmax!=null)?"(repris automatiquement de la feuille Proctor)":"")):"<span style=\\"color:var(--warn)\\">Renseignez \\u03c1<sub>d max</sub> OPM (ici ou via la feuille Proctor) pour calculer les compacit\\u00e9s.</span>");',
  '  setv("cb_ydcbr", c.ydCBR!=null?c.ydCBR.toFixed(3):"");',
  '  for(var m=0;m<3;m++){ var r=rows[m]||{};',
  '    setv("cb_net"+m, r.net!=null?r.net.toFixed(1):"");',
  '    celId("cb_dh"+m,r.dh,3); celId("cb_ds"+m,r.ds,3); celId("cb_comp"+m,r.comp,1); celId("cb_compf_"+m,r.comp,1);',
  '    celId("cb_gpct"+m,r.gp,2); celId("cb_c25_"+m,r.c25,1); celId("cb_c5_"+m,r.c5,1); celId("cb_maxi_"+m,r.maxi,1); }',
  '  var lab=(c.cbType==="cbr"?"I.CBR \\u00e0 ":"IPI \\u00e0 ")+(c.cible||95)+"%";',
  '  var out=chip(lab,f(c.icbr,1),"",true)+chip("\\u03c1d du CBR",f(c.ydCBR,3),"Mg/m\\u00b3")+chip("Moules valides",c.moules||0);',
  '  for(var m2=0;m2<rows.length;m2++){ var o2=rows[m2]; if(o2&&o2.maxi!=null) out+=chip(o2.coups+" coups",o2.maxi.toFixed(1),o2.comp!=null?("@ "+o2.comp.toFixed(1)+"%"):""); }',
  '  if(c.cbType==="cbr"&&c.gonfl!=null) out+=chip("Gonflement maxi",f(c.gonfl,2),"%",true);',
  '  if((c.moules||0)>0&&(c.moules||0)<2) out+=chip("Note","\\u2265 2 moules requis pour interpoler","!");',
  '  setHTML("out_cbr", out);',
  '  var K=num("cb_K")||1;',
  '  try{ drawCbrPen(K); }catch(e){}',
  '  try{ var pts=(c.varPts||[]).map(function(p){return [p[0],p[1]];}); var reg=c.reg?{a:c.reg.a,b:c.reg.b}:null; drawCbrVar(pts,reg,(c.cible||95),c.icbr,ydmax); }catch(e){}',
  '}',
  '/* Cisaillement direct — σ′v/τpic/τres + identification (ρd/e/SR) par eprouvette + canvas. */',
  'function renderCisail(c){',
  '  c=c||{}; var rows=c.rows||[];',
  '  for(var i=0;i<4;i++){ var r=rows[i]||{};',
  '    celId("ci_sv"+(i+1),r.sv,1); celId("ci_tp"+(i+1),r.tp,1); celId("ci_tr"+(i+1),r.tr,1);',
  '    celId("ci_rdd"+(i+1),r.rd,2); celId("ci_e"+(i+1),r.e,2); celId("ci_sr"+(i+1),r.sr,2); }',
  '  celId("ci_res_c",c.c,2); celId("ci_res_phi",c.phi,2);',
  '  if(c.A_cm2!=null) setv(ciMethod==="box"?"ci_A":"ci_Aring", c.A_cm2.toFixed(2));',
  '  var out=chip("c\\u2032",f(c.c,1),"kPa",true)+chip("\\u03c6\\u2032",f(c.phi,1),"\\u00b0",true)+chip("\\u00c9prouvettes",c.eprouvettes||0);',
  '  if(c.r2!=null) out+=chip("R\\u00b2",f(c.r2,4));',
  '  if(c.phiR!=null) out+=chip("\\u03c6\\u2032R",f(c.phiR,1),"\\u00b0")+chip("c\\u2032R",f(c.cR,1),"kPa");',
  '  if((c.eprouvettes||0)>0&&(c.eprouvettes||0)<3) out+=chip("Note","min. 3 \\u00e9prouvettes (Annexe B)","!");',
  '  setHTML("out_cisail", out);',
  '  try{ var pP=(c.ptsP||[]).map(function(p){return [p[0],p[1]];}); var pR=(c.ptsR||[]).map(function(p){return [p[0],p[1]];}); drawCis(pP,c.regP,pR,c.regR,c.r2); }catch(e){}',
  '}',
  '/* Masse volumique apparente — volume/ρ/ρd + note V<50 cm³. */',
  'function renderDens(d){',
  '  d=d||{};',
  '  var out=chip("Volume V",f(d.Vcm3,1),"cm\\u00b3")+chip("\\u03c1 apparente",f(d.rho,2),"Mg/m\\u00b3",true);',
  '  if(d.rhod!=null) out+=chip("\\u03c1d s\\u00e8che",f(d.rhod,2),"Mg/m\\u00b3",true)+chip("w utilis\\u00e9e",f(d.w,1),"%");',
  '  if(d.petitV) out+=chip("Note","V < 50 cm\\u00b3 \\u2014 moins repr\\u00e9sentatif","!");',
  '  setHTML("out_dens", out);',
  '}',
  '/* Œdometre — Hf/ε_v/e par palier (12) + e₀/ρd/Hs + Cc/Cs + courbe e-log(σ′). */',
  'function renderOedo(o2){',
  '  o2=o2||{}; var pal=o2.paliers||[];',
  '  for(var i=0;i<12;i++){ var p=pal[i]||{}; celId("oe_hf"+(i+1),p.Hf,3); celId("oe_ev"+(i+1),p.ev,2); celId("oe_e"+(i+1),p.e,3); }',
  '  setv("oe_A", o2.A!=null?o2.A.toFixed(1):""); setv("oe_rd", o2.rd!=null?o2.rd.toFixed(3):""); setv("oe_Hs", o2.Hs!=null?o2.Hs.toFixed(3):"");',
  '  var out=chip("e\\u2080",f(o2.e0,3),"",true)+chip("\\u03c1d",f(o2.rd,3),"Mg/m\\u00b3")+chip("Hs",f(o2.Hs,3),"mm")+chip("Cc",f(o2.Cc,3),"",true)+chip("Cs",f(o2.Cs,3))+chip("Paliers",o2.points||0);',
  '  if((o2.points||0)>0&&(o2.points||0)<7) out+=chip("Note","min. 7 paliers conseill\\u00e9s","!");',
  '  setHTML("out_oedo", out);',
  '  try{ var rows=(o2.curvePts||[]).map(function(p){return [p[0],p[1]];}); drawOedo(rows); }catch(e){}',
  '}',
  '/* Compression simple (UCS) — qu + cu = qu/2. */',
  'function renderUcs(u){ u=u||{}; setHTML("out_ucs", chip("qu",f(u.qu,3),"MPa",true)+chip("cu",f(u.cu==null?null:u.cu*1000,0),"kPa",true)); }',
  '/* Triaxial UU — σ1/cu par eprouvette (3) + cu moyen. */',
  'function renderTriUU(t){',
  '  t=t||{}; var rows=t.rows||[];',
  '  for(var i=0;i<3;i++){ var r=rows[i]||{}; celId("tu_s1_"+(i+1),r.s1,0); celId("tu_cu_"+(i+1),r.cu,0); }',
  '  setHTML("out_triuu", chip("cu moyen",f(t.cu_uu,0),"kPa",true)+chip("\\u03c6u","\\u2248 0","\\u00b0")+chip("\\u00c9prouvettes",t.eprouvettes||0));',
  '}',
  '/* Triaxial CU/CD — s/t (centre/rayon de Mohr) par eprouvette (3) + c′/φ′. */',
  'function renderTriCU(t){',
  '  t=t||{}; var rows=t.rows||[];',
  '  for(var i=0;i<3;i++){ var r=rows[i]||{}; celId("tc_s_"+(i+1),r.s,0); celId("tc_t_"+(i+1),r.t,0); }',
  '  setHTML("out_tricu", chip("c\\u0027",f(t.c,1),"kPa",true)+chip("\\u03c6\\u0027",f(t.phi,1),"\\u00b0",true)+chip("\\u00c9prouvettes",t.eprouvettes||0));',
  '}',
  '/* Permeabilite — k (cm/s et m/s), depuis l agregat serveur. */',
  'function renderPerm(o){ setHTML("out_perm", chip("k",o.k==null?null:o.k.toExponential(2),"cm/s",true)+chip("k",o.k==null?null:(o.k/100).toExponential(2),"m/s")); }',
  '/* Equivalent de sable — SE par essai (2) + SE moyen. */',
  'function renderEs(e){',
  '  e=e||{}; var rows=e.rows||[];',
  '  for(var i=0;i<2;i++){ var r=rows[i]||{}; celId("es_r"+(i+1),r.se,1); }',
  '  setHTML("out_es", chip("SE moyen",f(e.es,1),"%",true));',
  '}',
  '/* Los Angeles — LA + prise + conformite granulaire. */',
  'function renderLa(l){',
  '  l=l||{};',
  '  try{ setHTML("la_spec", LASPEC[laVar]); }catch(e){}',
  '  var el=$("la_gran"); if(el){ var g=l.conformite||"\\u2014"; el.textContent=g; el.className="alert "+(g.indexOf("\\u2713")===0?"ok":g.indexOf("\\u2717")===0?"warn":"info"); el.style.margin="0"; }',
  '  setHTML("out_la", chip(l.label||"LA",l.la==null?null:l.la,"",true)+chip("Prise M",f(l.M,0),"g"));',
  '}',
  '/* Fragmentation SZ — refus/passant par tamis (5) + Σ passant + SZ. */',
  'function renderSz(s){',
  '  s=s||{}; var rows=s.rows||[];',
  "  for(var i=0;i<rows.length;i++){ var r=rows[i]; celSel('.sz_ref[data-s=\"'+r.s+'\"]',r.ref,1); celSel('.sz_pas[data-s=\"'+r.s+'\"]',r.pas,1); }",
  '  setHTML("out_sz", chip("\\u03a3 passant",f(s.sumPass,1),"%")+chip("SZ",f(s.sz,2),"%",true));',
  '}',
  '/* Micro-Deval — mode norme (coefficient par eprouvette + conformite) OU campagne (4 pertes). */',
  'function renderMde(m){',
  '  m=m||{};',
  '  if(m.mode==="camp"){',
  '    var pertes=m.pertes||[];',
  '    for(var i=0;i<4;i++){ celId("mc_p"+i,pertes[i],1); }',
  '    celId("mc_cmds",m.cmds,1); celId("mc_cmde",m.cmde,1); celId("mc_cmd",m.cmd,2);',
  '    setHTML("out_mdecamp", chip("CMDS",f(m.cmds,1),"%")+chip("CMDE",f(m.cmde,1),"%",true)+chip("CMD",f(m.cmd,2),"%")+chip("MDE retenu",m.mde==null?null:m.mde,"",true));',
  '    return;',
  '  }',
  '  var rows=m.rows||[];',
  '  for(var j=0;j<2;j++){ var r=rows[j]||{}; celId("md_r"+(j+1),r.cc,1); }',
  '  try{',
  '    var k=(typeof mdeClassKey==="function")?mdeClassKey():null; var cc=k?(MDE_CLASS[k]||{}):{};',
  '    var cond=mdeWet==="s"?"\\u00e0 sec (MDS \\u2014 Annexe B, informatif)":"en pr\\u00e9sence d\\u2019eau (MDE)"; var spec;',
  '    if(mdeVar==="rb") spec="Ballast 31,5/50 mm (Annexe A) \\u00b7 2 \\u00e9prouvettes (10000 \\u00b1 100) g \\u00b7 <b>sans charge abrasive</b> \\u00b7 2,0 L eau \\u00b7 14000 tours \\u00e0 100 tr/min \\u00b7 MDE_RB = (10000 \\u2212 m)/100.";',
  '    else spec="Classe <b>"+k+" mm</b> \\u00b7 2 \\u00e9prouvettes (500 \\u00b1 2) g \\u00b7 charge abrasive <b>"+cc.charge+" g</b> (billes acier \\u00d810 mm) \\u00b7 "+cc.eau+" L eau \\u00b7 "+cc.tours+" tours \\u00e0 100 tr/min \\u00b7 essai "+cond+" \\u00b7 coefficient = (M \\u2212 m)/M \\u00d7 100.";',
  '    setHTML("mde_spec", spec);',
  '  }catch(e){}',
  '  var el=$("mde_gran"); if(el&&m.conformite!=null){ el.textContent=m.conformite; el.className="alert "+(m.conformite.indexOf("\\u2713")===0?"ok":m.conformite.indexOf("\\u2717")===0?"warn":"info"); el.style.margin="0"; }',
  '  var lbl=$("mde_res_lbl"); if(lbl) lbl.textContent=m.label||"MDE"; var val=$("mde_res_val"); if(val) val.textContent=m.mde==null?"\\u2014":m.mde;',
  '  var out=chip(m.label||"MDE",m.mde==null?null:m.mde,"",true)+chip("\\u00c9prouvettes",m.essais||0);',
  '  if((m.essais||0)===1) out+=chip("Note","2 \\u00e9prouvettes requises (Art. 6)","!");',
  '  setHTML("out_mde", out);',
  '}',
  '/* Masse volumique & absorption des granulats — ρa/ρrd/ρssd + WA24. */',
  'function renderRho(r){ r=r||{}; setHTML("out_rho", chip("\\u03c1a",f(r.ra,3),"Mg/m\\u00b3",true)+chip("\\u03c1rd",f(r.rrd,3),"Mg/m\\u00b3")+chip("\\u03c1ssd",f(r.rssd,3),"Mg/m\\u00b3")+chip("WA24",f(r.wa,2),"%",true)); }',
  '/* Sulfates — SO₃ + SO₄ = SO₃·1,2. */',
  'function renderSulf(s){ s=s||{}; setHTML("out_sulf", chip("SO\\u2083",f(s.so3,3),"%",true)+chip("SO\\u2084",f(s.so4,3),"%")); }',
  '/* Dispatcher des 15 essais restants (o = agregats plats ; det = sous-objets detail). */',
  'function renderRest(o,det){',
  '  det=det||{};',
  '  renderRhos(det.rhos); renderCbr(det.cbr); renderCisail(det.cisail); renderDens(det.dens);',
  '  renderOedo(det.oedo); renderUcs(det.ucs); renderTriUU(det.triuu); renderTriCU(det.tricu);',
  '  renderPerm(o); renderEs(det.es); renderLa(det.la); renderSz(det.sz); renderMde(det.mde);',
  '  renderRho(det.rho); renderSulf(det.sulf);',
  '}',
  '/* Peuple D (agregats) depuis la sortie serveur, puis appelle les render*, le verdict,',
  '   la fiche de synthese (renderRecap, conservee) et les pastilles (updateDots). */',
  'function renderAll(o){',
  '  o=o||{};',
  '  var keys=["wn","dmax","p80","p2","Cu","Cc","mf","mfq","wl","wp","ip","ic","vbs","rhos","wopn","rdmax","cbr","cbrType","gonfl","rho_app","rhod_app","es","la","sz","mde","wa","so3","qu","c_cis","phi_cis","phiR_cis","c","phi","cu_uu","e0_oedo","Cc_oedo","Cs_oedo","k"];',
  '  for(var i=0;i<keys.length;i++){ D[keys[i]]=(o[keys[i]]===undefined?null:o[keys[i]]); }',
  '  window.__laboLastClasse=o.classe||null;',
  '  var det=o.detail||{};',
  '  renderW(det.w); renderGran(det); renderAtt(det.att); renderVbs(det.vbs); renderProctor(det.proctor);',
  '  renderRest(o,det);',
  '  renderVerdict(o.classe);',
  '  try{ renderRecap(o.classe||{}); }catch(e){}',
  '  try{ updateDots(); }catch(e){}',
  '}',
  'async function __runCalcLabo(o){',
  '  var params=o; var cfg=cfgObject(); if(cfg) { try{ params=Object.assign({},o,{cfg:cfg}); }catch(e){} }',
  '  var resp;',
  '  try{ resp=await window.__geofamBridge.calc(params); }',
  '  catch(e){ renderCalcError({message:"Pont de calcul indisponible : "+((e&&e.message)||e)}); return; }',
  '  if(!resp || !resp.ok){ renderCalcError((resp&&resp.error)||{message:"R\\u00e9ponse de calcul vide."}); return; }',
  '  window.__laboLastCalcResultId=resp.calcResultId||null;',
  '  try{ renderAll(resp.output||{}); }catch(e){ renderCalcError({message:"Erreur de rendu."}); }',
  '}',
  '/* =================== FIN BRIDGE + RENDER =================== */',
].join('\n');

/** recalc() REECRIT : POST UNIQUE DEBOUNCE (~320 ms). Sur l etat vide (no-calc-initial)
 * aucun appel serveur, verdict natif « En attente ». Une rafale de frappes = 1 seul POST. */
const FASTLAB_RECALC = [
  'function recalc(){',
  '  var o; try{ o=readForm(); }catch(e){ o={}; }',
  '  if(!plausibleState(o)){',
  '    if(__calcTimer){ clearTimeout(__calcTimer); __calcTimer=null; }',
  '    window.__laboLastClasse=null; renderVerdict(null);',
  '    try{ renderRecap({}); }catch(e){} try{ updateDots(); }catch(e){}',
  '    return;',
  '  }',
  '  if(__calcTimer) clearTimeout(__calcTimer);',
  '  __calcTimer=setTimeout(function(){ __calcTimer=null; __runCalcLabo(o); }, 320);',
  '}',
].join('\n');

/** Store REECRIT : persistance des echantillons proxifiee via le bridge store:get/set
 * (namespace org/projet gere par l hote, ADR 0015) — plus de window.storage direct. */
const FASTLAB_STORE = [
  'const Store={',
  '  get:function(k){ return window.__geofamBridge.storeGet(k); },',
  '  set:function(k,v){ return window.__geofamBridge.storeSet(k,v); }',
  '};',
].join('\n');

/** saveSample REECRIT : le calcul (donc la classe enregistree) vient du SERVEUR — on
 * attend le POST et on lit la derniere classe serveur (plus de classify() cote client). */
// NB : le `async ` d'origine PRECEDE `function saveSample` et n'est PAS dans le span de
// findDecl (qui commence a `function`) — il est CONSERVE. On ne repete donc PAS `async`
// ici (sinon `async async function`). La fonction reste asynchrone via ce prefixe retenu.
const FASTLAB_SAVESAMPLE = [
  'function saveSample(){',
  "  var o=readForm(); if(!o.m_ref){ toast('Renseignez une référence'); show('ident'); var mr=$('m_ref'); if(mr) mr.focus(); return; }",
  '  await __runCalcLabo(o);',
  '  var r=window.__laboLastClasse||{};',
  "  DB.unshift({ id:o.m_ref+'·'+Date.now(), ref:o.m_ref, chantier:o.m_chantier||'', code:(r&&r.full)||'—', o:o, ts:Date.now() });",
  "  await persistDB(); renderDB(); toast('Enregistré : '+o.m_ref+' ('+((r&&r.full)||'—')+')');",
  '}',
].join('\n');

// ---------------------------------------------------------------------------
// PRESSIOPRO (essai pressiometrique Menard, NF EN ISO 22476-4) — MULTI-ENGINE
// (3 slugs tenant : pressiometre / pressio-etalonnage / pressio-calibrage).
// ---------------------------------------------------------------------------

/**
 * Symboles MOTEUR (science confidentielle) SUPPRIMES du clone pressiopro. Source de
 * verite unique pour scripts/audit-excision.mjs (§8). `calcEtalonnage`/`calcCalibrage`/
 * `doCalc`/`renderProfil`/`updateSeuilPreview` sont REECRITS (nom conserve -> pas ici) ;
 * ne sont interdits que les fonctions RETIREES integralement (depouillement pressio,
 * coefficient rheologique alpha, regressions courbe-inverse/lineaire, ajustement 3x3,
 * detection auto de la plage pseudo-elastique §D.5.1).
 *
 * NB calcPh (Ph = 0,1·(Zs+Zc)) : CONSERVE (pas dans cette liste). Arbitrage documente a
 * la config (assistance de SAISIE d'un parametre, formule PRINTED P15/P19, jumelle du
 * calcU0 conserve, AUCUN moteur serveur pour Ph) — reversible avant livraison client.
 */
const PRESSIO_ENGINE_SYMBOLS = [
  'calcDepth', // depouillement d'une profondeur (EM/pL/alpha/categorie) — coeur science
  'getAlpha', // coefficient rheologique alpha de Menard (table)
  'fitAll', // orchestrateur d'extrapolation §D.4.3
  'fitRecip', // regression courbe inverse 1/(V-Vs) = A + B·P
  'linReg', // regression lineaire (moindres carres)
  'autoDetectPhase', // detection auto de la plage pseudo-elastique + beta §D.5.1
  'solve3', // elimination de Gauss 3x3 (ajustement polynomial du calibrage)
];

/** Pont postMessage MULTI-ENGINE (origine opaque) + proxy Store + helpers de mapping
 * (rejeu des SAISIES + lecture de la sortie serveur whitelistee — AUCUNE science).
 * Injecte apres `let depths = [], cur = 0, CC = {};` : depths/cur/CC definis ; les
 * renderers/etats hoistes (etalRows/calibRows/logLayers en `let`, TDZ non touchee au
 * boot) restent appelables au 1er calcul. L'IIFE poste « ready » avant DOMContentLoaded. */
const PRESSIO_BRIDGE_AND_SHIM = [
  '/* ===================== BRIDGE (multi-engine) + MAPPING (injecté — clone excisé, ADR 0015) ===================== */',
  '(function(){',
  '  var TOOL_ID="pressiopro";',
  '  var pending=Object.create(null), stpend=Object.create(null), seq=0, stseq=0;',
  '  var ctx={ engineId:"pressiometre", orgSlug:null, projectLabel:null, readOnly:false };',
  '  function post(msg){ try{ window.parent.postMessage(msg,"*"); }catch(e){} }',
  '  window.addEventListener("message", function(ev){',
  '    if(ev.source !== window.parent) return;',
  '    var d=ev.data; if(!d || d.v!==1 || typeof d.type!=="string") return;',
  '    if(d.type==="init"){ ctx=Object.assign(ctx, d.payload||{}); return; }',
  '    if(d.type==="calc:response"){ var p=pending[d.id]; if(!p) return; delete pending[d.id]; p(d.payload||{ok:false,error:{message:"réponse vide"}}); return; }',
  '    if(d.type==="store:value"){ var pr=d.id?stpend[d.id]:null; if(pr){ delete stpend[d.id]; pr(d.payload&&d.payload.value); } return; }',
  '  });',
  '  /* calc(engineId, params) : engineId choisi par la PAGE/ACTION (liste fermée validée',
  '     côté hôte : pressiometre / pressio-etalonnage / pressio-calibrage). */',
  '  window.__geofamBridge={',
  '    calc:function(engineId, params){ var id=TOOL_ID+":"+(++seq); return new Promise(function(resolve){ pending[id]=resolve; post({v:1,type:"calc:request",id:id,payload:{engineId:engineId,label:(params&&params.projet)||(params&&params.label)||null,params:params}}); }); },',
  '    emitPv:function(calcResultId){ post({v:1,type:"pv:request",payload:{calcResultId:calcResultId}}); },',
  '    storeGet:function(key){ var id=TOOL_ID+":s:"+(++stseq); return new Promise(function(resolve){ stpend[id]=resolve; post({v:1,type:"store:get",id:id,payload:{key:key}}); }); },',
  '    storeSet:function(key,value){ var id=TOOL_ID+":s:"+(++stseq); return new Promise(function(resolve){ stpend[id]=resolve; post({v:1,type:"store:set",id:id,payload:{key:key,value:value}}); }); },',
  '    context:function(){ return ctx; }',
  '  };',
  '  /* input:dirty (correctif PV BQ-1) : signale a l hote que l ecran a change apres un calcul',
  '     -> le bouton d emission du PV scelle se desactive jusqu au prochain calcul (evite un PV perime).',
  '     Emission IMMEDIATE (front de montee), NON debouncee : le bouton doit se desactiver des la 1re frappe.',
  '     Throttle ~1/frame par FLAG booleen (aucun delai temporel sur l emission) pour ne pas inonder l hote,',
  '     lui-meme idempotent. Listener DELEGUE au document (capture) : generique, sans connaitre le DOM de l outil.',
  '     Cible input/change uniquement (la donnee A change) — PAS click : naviguer entre onglets de',
  '     resultats ne change pas le calcul affiche (sinon on desactiverait le PV a tort). Un changement de',
  '     mode de calcul sans recalcul reste couvert cote hote : ce mode n a pas de calcResultId. */',
  '  var __geofamDirtyFrame=false;',
  '  function __geofamEmitDirty(){ if(__geofamDirtyFrame) return; __geofamDirtyFrame=true; post({v:1,type:"input:dirty",payload:{toolId:TOOL_ID}}); var __raf=(typeof requestAnimationFrame==="function")?requestAnimationFrame:function(f){setTimeout(f,0);}; __raf(function(){ __geofamDirtyFrame=false; }); }',
  '  document.addEventListener("input", __geofamEmitDirty, true);',
  '  document.addEventListener("change", __geofamEmitDirty, true);',
  '  post({v:1,type:"ready",payload:{toolId:TOOL_ID}});',
  '})();',
  '',
  "/* engine ids — LISTE FERMEE (l'hôte rejette tout id hors liste sans appeler l'API). */",
  'var ENG_ESSAI="pressiometre", ENG_ETAL="pressio-etalonnage", ENG_CALIB="pressio-calibrage";',
  'var __seuilTimer=null;',
  'window.__pressioLastCalcResultId=null;',
  '',
  '/* --- helpers de mapping (rejeu des SAISIES + lecture whitelistée ; aucune science) --- */',
  'function _pnum(v,def){ return (typeof v==="number"&&isFinite(v))?v:(def===undefined?0:def); }',
  'function _escP(s){ return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }',
  'function _gerrP(e){ if(!e) return "Réponse de calcul vide."; if(typeof e==="string") return e; var m=e.message||"Calcul indisponible."; var r=e.reason?(" ("+e.reason+")"):""; return m+r; }',
  '/* Poids volumique effectif (kN/m³) — parité calcDepth `parseFloat(p_gamma)||19`. */',
  "function _pGamma(){ var e=document.getElementById('p_gamma'); var g=e?parseFloat(e.value):NaN; return (isFinite(g)&&g>0)?g:19; }",
  '/* Profondeur nappe (m) — parité nappeVal() (conservé) ; robuste si nappeVal absent. */',
  "function _pNappe(){ try{ return _pnum(nappeVal(),0); }catch(e){ var n=document.getElementById('p_nappe'); return n?(parseFloat(n.value)||0):0; } }",
  "/* Paliers VALIDES d'une profondeur -> forme contrat (p/v15/v30/v60 finis). */",
  "function _essaiRows(d){ return (d&&d.rows?d.rows:[]).filter(function(r){ return r.p!==''&&r.p!=null&&r.v60!==''&&r.v60!=null; }).map(function(r){ return { p:+r.p, v15:+r.v15||0, v30:+r.v30||0, v60:+r.v60 }; }); }",
  "/* STATE d'une profondeur -> PressiometreInputSchema. getParams() (conservé) divise déjà",
  '   `a` par 10 (cm³/MPa saisie -> cm³/bar interne), comme le HTML. Rejeu pur des entrées. */',
  'function buildEssaiInput(idx){',
  '  var d=depths[idx]; var p=getParams();',
  '  var inp={ label:String((d&&d.label)||"Profondeur"),',
  '    params:{ a:_pnum(p.a), Ph:_pnum(p.Ph), Pe:_pnum(p.Pe), V0:_pnum(p.V0,535), k0:_pnum(p.k0) },',
  '    gamma:_pGamma(), nappe:_pNappe(), rows:_essaiRows(d) };',
  '  if(d && d.pf_idx!=null && d.pf_idx>=0) inp.pf_idx=d.pf_idx;',
  '  if(d && d.plm_idx!=null && d.plm_idx>=0) inp.plm_idx=d.plm_idx;',
  "  var pj=document.getElementById('p_projet'); if(pj&&pj.value) inp.projet=String(pj.value);",
  '  return inp;',
  '}',
  '/* Fermeture de tracé de la courbe inverse (§D.4.3.2) reconstruite depuis les',
  '   COEFFICIENTS A/B renvoyés par le serveur (ADR 0015 : « le serveur renvoie les',
  '   coefficients de courbe à tracer ») ; aucune régression cliente. */',
  'function _recipGen(A,B,V0){ return function(p){ var inv=A+B*p; return inv>0 ? V0+(1/inv) : null; }; }',
  '/* SORTIE serveur (PressiometreOutputSchema) -> `_res` attendu par renderResults/',
  '   drawResCharts/renderProfil (conservés). pfI/plmI reconstruits depuis les PHASES',
  '   contiguës de la courbe serveur (parité HTML L.1255-1258). a/Ph/Pe/V0 rejoués du form. */',
  'function mapEssaiOutput(out, idx){',
  '  var p=getParams(); var V0=_pnum(p.V0,535);',
  '  var courbe=Array.isArray(out.courbe)?out.courbe:[];',
  '  var C=courbe.map(function(cp){ return { pRaw:_pnum(cp.p), p:_pnum(cp.pCorr), v60:_pnum(cp.v60), dv:_pnum(cp.d6030) }; });',
  '  var pfI=0; while(pfI<courbe.length && courbe[pfI].phase==="Recompression") pfI++;',
  '  var plmI=pfI-1; for(var i=pfI;i<courbe.length;i++){ if(courbe[i].phase==="Pseudo-élast.") plmI=i; else break; }',
  '  var ex=out.extrapolation||{}; var A=_pnum(ex.a), B=_pnum(ex.b);',
  '  var recip={ A:A, B:B, PLM:_pnum(ex.plmVLim), PLMasym:_pnum(ex.plmAsymptote),',
  '    errV:(typeof ex.errV==="number"&&isFinite(ex.errV))?ex.errV:Infinity, gen:_recipGen(A,B,V0) };',
  '  var vol=out.volumes||{}, syn=out.synthese||{};',
  '  var pLdir=out.pLDirect?_pnum(out.pL):null;',
  '  var extChoice=(!out.pLDirect && isFinite(recip.PLM) && recip.PLM>_pnum(out.pf))?"recip":null;',
  '  var _res={ C:C, pfI:pfI, plmI:plmI,',
  '    pE:_pnum(out.pE), p0:_pnum(out.p0), Pf:_pnum(out.pf), pL:_pnum(out.pL), pL_direct:pLdir,',
  '    PfS:_pnum(out.pfNette), pLS:_pnum(out.pLNette),',
  '    VE:_pnum(vol.vE), V0c:_pnum(vol.v0), Vf:_pnum(vol.vf), VsP2V1:_pnum(vol.vLim),',
  '    EM:_pnum(out.EM), ratio:_pnum(out.ratioEMpL), alpha:_pnum(out.alpha),',
  '    cat:(typeof out.categorie==="string"?out.categorie:""),',
  '    catName:(typeof out.categorieLibelle==="string"?out.categorieLibelle:""),',
  '    catDesc:(typeof out.categorieDescription==="string"?out.categorieDescription:""),',
  '    consol:(typeof out.consolidation==="string"?out.consolidation:""),',
  '    fluage:C.map(function(c){ return { p:c.p, dv:c.dv }; }),',
  '    ext:{recip:recip}, extChoice:extChoice,',
  '    a:_pnum(p.a), aUsed:_pnum(out.aUsed), aForced:(out.aForced===true),',
  '    Ph:_pnum(p.Ph), Pe:_pnum(p.Pe), V0:V0,',
  '    sigH0:_pnum(out.sigmaH0), z:_pnum(out.z),',
  '    beta:_pnum(syn.beta), mE:_pnum(syn.mE),',
  '    auto_p0I:_pnum(syn.plageAutoDebut,0), auto_pfI:_pnum(syn.plageAutoFin,0) };',
  '  if(idx!=null && depths[idx]) depths[idx]._res=_res;',
  '  return _res;',
  '}',
  'function renderCalcErrorRes(msg){ var el=document.getElementById("resCont"); if(el) el.innerHTML=\'<div class="empty" style="color:var(--re)"><div class="eico">⚠️</div><p><strong>Calcul indisponible.</strong><br>\'+_escP(msg)+\'</p></div>\'; }',
  '/* Calcule UNE profondeur via le pont, mappe -> _res, rend les résultats (exemple/boot). */',
  'function __pressioCalcAndShow(idx){',
  '  var d=depths[idx]; if(!d) return;',
  '  window.__geofamBridge.calc(ENG_ESSAI, buildEssaiInput(idx)).then(function(resp){',
  '    if(resp&&resp.ok&&resp.output&&!resp.output.erreur){ var r=mapEssaiOutput(resp.output, idx); renderResults(r, d.label); }',
  '    else { renderCalcErrorRes(_gerrP(resp&&resp.error)); }',
  '  }).catch(function(e){ renderCalcErrorRes("Pont de calcul indisponible : "+((e&&e.message)||e)); });',
  '}',
  '/* RENDU du profil (reproduit renderProfil L.1647-1691 SANS le calcDepth loop — celui-ci',
  '   est fait en amont via le pont). Alimenté par depths[i]._res (sortie serveur mappée). */',
  'function __pressioDrawProfil(){',
  '  function pd(l){var m=l.match(/[\\d.,]+/);return m?parseFloat(m[0].replace(",",".")):0;}',
  '  var data=depths.filter(function(d){return d._res;}).map(function(d){var o={depth:pd(d.label),label:d.label};for(var k in d._res){o[k]=d._res[k];}return o;}).sort(function(a,b){return a.depth-b.depth;});',
  '  var plc=document.getElementById("pressioLog");',
  '  if(plc) plc.innerHTML=drawPressioLog(logLayers, data, _pNappe());',
  '  var pll=document.getElementById("pressioLogLeg");',
  '  if(pll) pll.innerHTML=soilLegendHTML(logLayers)+catLegendHTML(data);',
  '  var pgp=document.getElementById("pg-profil");',
  '  var tb=(pgp&&pgp.querySelector("#profTbody")) || document.getElementById("profTbody"); if(!tb) return; tb.innerHTML="";',
  '  if(!data.length){',
  '    tb.innerHTML=\'<tr><td colspan="7" style="padding:20px;text-align:center;color:var(--t3);font-style:italic">Calculez chaque profondeur.</td></tr>\';',
  '    ["chartEM","chartPLM","chartSpec"].forEach(function(k){if(CC[k]){try{CC[k].destroy();}catch(e){}CC[k]=null;}});',
  '    return;',
  '  }',
  '  data.forEach(function(d){',
  '    var tr=document.createElement("tr");',
  "    tr.innerHTML='<td>'+d.label+'</td><td>'+d.EM.toFixed(2)+'</td><td>'+(d.pL*0.1).toFixed(3)+'</td><td>'+(d.Pf*0.1).toFixed(3)+'</td><td>'+d.ratio.toFixed(1)+'</td><td>'+d.alpha.toFixed(2)+'</td><td><span class=\"pb el\">'+d.cat+'</span></td>';",
  '    tb.appendChild(tr);',
  '  });',
  '  if(typeof Chart==="undefined") return;',
  '  var deps=data.map(function(d){return d.depth;}), ems=data.map(function(d){return +d.EM.toFixed(3);}), plms=data.map(function(d){return +(d.pL*0.1).toFixed(4);}), pfs=data.map(function(d){return +(d.Pf*0.1).toFixed(4);});',
  "  var gc='rgba(255,255,255,.05)',tc='#8fa3b8';",
  "  var bo=function(xl,xm){return{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:true,labels:{color:tc,font:{size:11},boxWidth:12,padding:14}}},scales:{x:{type:'linear',position:'top',title:{display:true,text:xl,color:tc,font:{size:11}},grid:{color:gc},ticks:{color:tc,font:{size:11}},min:xm},y:{type:'linear',reverse:true,title:{display:true,text:'Profondeur (m)',color:tc,font:{size:11}},grid:{color:gc},ticks:{color:tc,font:{size:11}},min:0}}};};",
  '  if(CC.chartEM){CC.chartEM.destroy();CC.chartEM=null;}',
  "  CC.chartEM=new Chart(document.getElementById('chartEM'),{type:'line',data:{datasets:[{label:'EM (MPa)',data:deps.map(function(d,i){return {x:ems[i],y:d};}),borderColor:'#2484ec',backgroundColor:'rgba(36,132,236,.12)',fill:true,tension:.3,pointRadius:6,pointBackgroundColor:'#2484ec',pointBorderColor:'#0d1b2a',pointBorderWidth:2,borderWidth:2.5}]},options:bo('EM (MPa)',0)});",
  '  if(CC.chartPLM){CC.chartPLM.destroy();CC.chartPLM=null;}',
  "  CC.chartPLM=new Chart(document.getElementById('chartPLM'),{type:'line',data:{datasets:[",
  "    {label:'PLM (MPa)',data:deps.map(function(d,i){return {x:plms[i],y:d};}),borderColor:'#15b896',fill:false,tension:.3,pointRadius:6,pointBackgroundColor:'#15b896',pointBorderColor:'#0d1b2a',pointBorderWidth:2,borderWidth:2.5},",
  "    {label:'Pf (MPa)',data:deps.map(function(d,i){return {x:pfs[i],y:d};}),borderColor:'#e05252',fill:false,tension:.3,borderDash:[5,4],pointRadius:5,pointBackgroundColor:'#e05252',pointBorderColor:'#0d1b2a',pointBorderWidth:2,borderWidth:2}",
  "  ]},options:bo('Pression (MPa)',0)});",
  '  if(CC.chartSpec){CC.chartSpec.destroy();CC.chartSpec=null;}',
  '  var spts=data.map(function(d){return {x:Math.log10(Math.max(0.001,d.pLS*0.1)),y:Math.log10(Math.max(0.5,d.ratio)),label:d.label};});',
  "  var iso=[{r:4,c:'rgba(224,82,82,.3)',l:'E/P=4'},{r:8,c:'rgba(240,165,0,.3)',l:'E/P=8'},{r:14,c:'rgba(36,132,236,.25)',l:'E/P=14'},{r:22,c:'rgba(21,184,150,.25)',l:'E/P=22'}];",
  "  CC.chartSpec=new Chart(document.getElementById('chartSpec'),{type:'line',",
  '    data:{datasets:[',
  '      ...iso.map(function(l){return {label:l.l,data:[{x:Math.log10(0.01),y:Math.log10(l.r)},{x:Math.log10(10),y:Math.log10(l.r)}],borderColor:l.c,borderWidth:1.5,borderDash:[4,4],pointRadius:0,fill:false,tension:0};}),',
  "      {label:'Essais',data:spts,type:'scatter',borderColor:'transparent',backgroundColor:'#f0a500',pointRadius:8,pointHoverRadius:10}",
  '    ]},',
  '    options:{responsive:true,maintainAspectRatio:false,',
  "      plugins:{legend:{display:false},tooltip:{callbacks:{title:function(it){var i=it[0];return i.datasetIndex===iso.length?(spts[i.dataIndex]&&spts[i.dataIndex].label||''):(iso[i.datasetIndex]&&iso[i.datasetIndex].l||'');},label:function(it){if(it.datasetIndex===iso.length){var pp=spts[it.dataIndex];return['PLM*='+Math.pow(10,pp.x).toFixed(3)+' MPa','E/P='+Math.pow(10,pp.y).toFixed(1)];}return '';}}}},",
  "      scales:{x:{type:'linear',title:{display:true,text:'log(PLM*) en MPa',color:tc,font:{size:11}},grid:{color:gc},ticks:{color:tc,font:{size:11},callback:function(v){return Math.pow(10,v).toFixed(2)+' MPa';}}},y:{type:'linear',title:{display:true,text:'log(EM/PLM*)',color:tc,font:{size:11}},grid:{color:gc},ticks:{color:tc,font:{size:11},callback:function(v){return ''+Math.pow(10,v).toFixed(0);}}}}",
  '    }',
  '  });',
  '}',
  '/* =================== FIN BRIDGE + MAPPING =================== */',
].join('\n');

/** doCalc() REECRIT : async, pont (essai), mapping serveur -> _res, renderResults. */
const PRESSIO_DOCALC = [
  'async function doCalc(){',
  '  var d=depths[cur];',
  "  var pfVal=parseInt(document.getElementById('sel_pf').value);",
  "  var plmVal=parseInt(document.getElementById('sel_plm').value);",
  '  d.pf_idx=(pfVal>=0)?pfVal:(d.pf_idx||0);',
  '  d.plm_idx=(plmVal>=0)?plmVal:(d.plm_idx||d.rows.length-1);',
  "  if(d.pf_idx>=d.plm_idx){ toast('⚠ p₀ doit être avant pf — vérifiez les seuils.','err'); return; }",
  "  if(d.rows.filter(function(r){return r.p!==''&&r.v60!=='';}).length<4){ toast('Saisissez au moins 4 lignes complètes.','err'); return; }",
  "  goPage('resultats',4);",
  '  var rc=document.getElementById("resCont"); if(rc) rc.innerHTML=\'<div class="empty"><div class="eico">⏳</div><p>Calcul en cours…</p></div>\';',
  '  var resp;',
  '  try{ resp=await window.__geofamBridge.calc(ENG_ESSAI, buildEssaiInput(cur)); }',
  '  catch(e){ renderCalcErrorRes("Pont de calcul indisponible : "+((e&&e.message)||e)); return; }',
  '  if(!resp||!resp.ok){ renderCalcErrorRes(_gerrP(resp&&resp.error)); return; }',
  '  var out=resp.output||{};',
  '  if(out.erreur){ renderCalcErrorRes(out.erreur); return; }',
  '  window.__pressioLastCalcResultId=resp.calcResultId||null;',
  '  var _res=mapEssaiOutput(out, cur);',
  '  renderResults(_res, d.label);',
  "  toast('Dépouillement OK — '+d.label,'ok');",
  '}',
].join('\n');

/** updateSeuilPreview() REECRIT : APERCU E_M LIVE via le pont (POST débouncé ~300 ms,
 * patron FASTLAB). Le seuil sélectionné (dropdown) est passé en pf_idx/plm_idx ; E_M,
 * ratio, seuils corrigés et suggestion auto β viennent du SERVEUR (aucun calcul client).
 * no-calc-initial : sélection invalide ou < 4 paliers -> pas d'appel serveur. */
const PRESSIO_SEUILPREVIEW = [
  'function updateSeuilPreview(){',
  '  var d=depths[cur];',
  "  var pfI=parseInt(document.getElementById('sel_pf').value);",
  "  var plmI=parseInt(document.getElementById('sel_plm').value);",
  "  var prev=document.getElementById('seuilPreview'); if(!prev) return;",
  '  if(__seuilTimer){ clearTimeout(__seuilTimer); __seuilTimer=null; }',
  "  if(!(pfI>=0)||!(plmI>=0)||pfI>=d.rows.length||plmI>=d.rows.length){ prev.style.display='none'; return; }",
  "  var r1=d.rows[pfI], r2=d.rows[plmI]; if(!r1||!r2){ prev.style.display='none'; return; }",
  "  prev.style.display='block';",
  '  if(!(pfI<plmI)){',
  "    prev.style.borderLeft='3px solid var(--re)';",
  "    prev.innerHTML='<span style=\"color:var(--re)\">⚠ P1 doit être avant P2 (ligne '+(pfI+1)+' > ligne '+(plmI+1)+')</span>';",
  '    return;',
  '  }',
  "  prev.style.borderLeft='3px solid var(--te)';",
  '  if(_essaiRows(d).length<4){ prev.innerHTML=\'<span style="color:var(--t3);font-size:10px">Saisissez au moins 4 paliers complets pour l\\u2019aperçu E_M.</span>\'; return; }',
  '  prev.innerHTML=\'<span style="color:var(--t3);font-size:10px">Aperçu E_M…</span>\';',
  '  var inp=buildEssaiInput(cur); inp.pf_idx=pfI; inp.plm_idx=plmI;',
  '  __seuilTimer=setTimeout(function(){ __seuilTimer=null;',
  '    window.__geofamBridge.calc(ENG_ESSAI, inp).then(function(resp){',
  "      var pv=document.getElementById('seuilPreview'); if(!pv) return;",
  '      if(!resp||!resp.ok||!resp.output||resp.output.erreur){ pv.innerHTML=\'<span style="color:var(--re);font-size:10px">Aperçu indisponible.</span>\'; return; }',
  '      var o=resp.output, vol=o.volumes||{}, syn=o.synthese||{};',
  '      var Pf_c=_pnum(o.p0), PLM_c=_pnum(o.pf), V1=_pnum(vol.v0), V2=_pnum(vol.vf);',
  '      var dP=PLM_c-Pf_c, dV=V2-V1, n=plmI-pfI+1;',
  "      var autoTxt='<span style=\"color:var(--t3);font-size:10px\">Auto β='+_pnum(syn.beta).toFixed(2)+': suggestion L'+(_pnum(syn.plageAutoDebut,0)+1)+'→L'+(_pnum(syn.plageAutoFin,0)+1)+'</span>';",
  "      pv.innerHTML='🔴 <span style=\"color:var(--re)\">Pf=P1</span> = <strong style=\"color:var(--tx)\">'+Pf_c.toFixed(3)+' bar</strong> V1='+V1+'cm³  '+",
  "        '🟢 <span style=\"color:var(--te)\">PLM=P2</span> = <strong style=\"color:var(--tx)\">'+PLM_c.toFixed(3)+' bar</strong> V2='+V2+'cm³<br>'+",
  "        n+' paliers · ΔP='+dP.toFixed(3)+' bar · ΔV='+dV+'cm³<br>'+",
  "        '→ <strong style=\"color:var(--bl)\">E<sub>M</sub> ≈ '+_pnum(o.EM).toFixed(2)+' MPa</strong>  ratio='+_pnum(o.ratioEMpL).toFixed(1)+'<br>'+autoTxt;",
  "    }).catch(function(){ var pv=document.getElementById('seuilPreview'); if(pv) pv.innerHTML='<span style=\"color:var(--re);font-size:10px\">Aperçu indisponible.</span>'; });",
  '  }, 300);',
  '}',
].join('\n');

/** renderProfil() REECRIT : dépouillement AUTO de toute profondeur non calculée VIA LE PONT
 * (fidélité F7 : l'utilisateur n'a jamais à demander le profil), puis rendu (__pressioDrawProfil).
 * Séquentiel (Promise chain) -> ordre stable, déterministe. */
const PRESSIO_RENDERPROFIL = [
  'function renderProfil(){',
  '  var todo=[];',
  '  for(var i=0;i<depths.length;i++){ if(!depths[i]._res && _essaiRows(depths[i]).length>=4) todo.push(i); }',
  '  if(!todo.length){ __pressioDrawProfil(); return; }',
  '  var chain=Promise.resolve();',
  '  todo.forEach(function(i){ chain=chain.then(function(){ return window.__geofamBridge.calc(ENG_ESSAI, buildEssaiInput(i)).then(function(resp){ if(resp&&resp.ok&&resp.output&&!resp.output.erreur){ mapEssaiOutput(resp.output, i); } }); }); });',
  '  chain.then(function(){ __pressioDrawProfil(); }).catch(function(){ __pressioDrawProfil(); });',
  '}',
].join('\n');

/** calcEtalonnage() REECRIT : async, pont (pressio-etalonnage) ; `e` reconstruit depuis la
 * sortie whitelistée (Vs/Pe/a/R²/RMS/vsReel/vPe/residus) + les points SAISIS (etalRows) ;
 * renderEtalResult/drawEtalChart CONSERVES. */
const PRESSIO_CALCETAL = [
  'function calcEtalonnage(){',
  "  var pts=etalRows.filter(function(r){return r.p!==''&&r.v60!==''&&r.v60!==undefined;}).map(function(r){return {p:+r.p,v:+r.v60};});",
  "  if(pts.length<3){ toast('Saisissez au moins 3 points.','err'); return; }",
  '  var el=document.getElementById("etalResult"); if(el) el.innerHTML=\'<div class="hint">Calcul en cours…</div>\';',
  "  var rows=etalRows.filter(function(r){return r.p!==''&&r.v60!==''&&r.v60!==undefined;}).map(function(r){return {p:+r.p,v15:+r.v15||0,v30:+r.v30||0,v60:+r.v60};});",
  '  var inp={rows:rows}; var pj=document.getElementById("p_projet"); if(pj&&pj.value)inp.projet=String(pj.value);',
  '  window.__geofamBridge.calc(ENG_ETAL, inp).then(function(resp){',
  "    if(!resp||!resp.ok||!resp.output){ if(el) el.innerHTML='<div class=\"warnbox\">Étalonnage indisponible : '+_escP(_gerrP(resp&&resp.error))+'</div>'; return; }",
  '    var o=resp.output;',
  '    var e={ a:_pnum(o.a), Vs:_pnum(o.Vs), Pe:_pnum(o.Pe), R2:_pnum(o.R2), rmsError:_pnum(o.rms),',
  '      pts:pts, V_pe:_pnum(o.vPe), Vs_reel:_pnum(o.vsReel),',
  '      residuals:(Array.isArray(o.residus)?o.residus:[]).map(function(r){return {p:_pnum(r.p),v:_pnum(r.vMesure),vhat:_pnum(r.vAjuste),res:_pnum(r.residu)};}) };',
  '    renderEtalResult(e);',
  '    setTimeout(function(){ try{ drawEtalChart(e); }catch(e2){} }, 100);',
  "  }).catch(function(err){ if(el) el.innerHTML='<div class=\"warnbox\">Pont de calcul indisponible : '+_escP((err&&err.message)||err)+'</div>'; });",
  '}',
].join('\n');

/** calcCalibrage() REECRIT : async, pont (pressio-calibrage) ; `e` reconstruit depuis la
 * sortie whitelistée (a/c0/c1/c2/R²/RMS/residus) + les points SAISIS TRIÉS par P (parité
 * du tri de calcCalibrage) ; renderCalibResult/drawCalibChart CONSERVES. */
const PRESSIO_CALCCALIB = [
  'function calcCalibrage(){',
  "  var pts=calibRows.filter(function(r){return r.p!==''&&r.v60!==''&&r.v60!==undefined;}).map(function(r){return {p:+r.p,v:+r.v60};});",
  "  if(pts.length<3){ toast('Saisissez au moins 3 points.','err'); return; }",
  '  pts.sort(function(a,b){return a.p-b.p;});',
  '  var el=document.getElementById("calibResult"); if(el) el.innerHTML=\'<div class="hint">Calcul en cours…</div>\';',
  '  var rows=pts.map(function(r){return {p:r.p,v60:r.v};});',
  '  var inp={rows:rows}; var pj=document.getElementById("p_projet"); if(pj&&pj.value)inp.projet=String(pj.value);',
  '  window.__geofamBridge.calc(ENG_CALIB, inp).then(function(resp){',
  "    if(!resp||!resp.ok||!resp.output){ if(el) el.innerHTML='<div class=\"warnbox\">Calibrage indisponible : '+_escP(_gerrP(resp&&resp.error))+'</div>'; return; }",
  '    var o=resp.output;',
  '    var e={ pts:pts, c0:_pnum(o.c0), c1:_pnum(o.c1), c2:_pnum(o.c2), R2:_pnum(o.R2), rms:_pnum(o.rms), a_calib:_pnum(o.a),',
  '      residuals:(Array.isArray(o.residus)?o.residus:[]).map(function(r){return {v:_pnum(r.p),pc:_pnum(r.v60Mesure),phat:_pnum(r.v60Ajuste),res:_pnum(r.residu)};}) };',
  '    renderCalibResult(e);',
  '    setTimeout(function(){ try{ drawCalibChart(e); }catch(e2){} }, 100);',
  "  }).catch(function(err){ if(el) el.innerHTML='<div class=\"warnbox\">Pont de calcul indisponible : '+_escP((err&&err.message)||err)+'</div>'; });",
  '}',
].join('\n');

/** saveLocal()/loadLocal() REECRITS : persistance de la SAISIE proxifiée via le bridge
 * store:set/get (namespace org/projet géré par l'hôte, ADR 0015) — plus de localStorage.
 * loadLocal renvoie false (boot -> initEmpty) puis HYDRATE en asynchrone si un état existe. */
const PRESSIO_SAVELOCAL = [
  "function saveLocal(){ try{ window.__geofamBridge.storeSet(\"state\", gatherAll()); }catch(e){} toast('Sauvegardé ✓','ok'); }",
].join('\n');
const PRESSIO_LOADLOCAL = [
  'function loadLocal(){',
  '  try{ window.__geofamBridge.storeGet("state").then(function(v){ if(v){ try{ applyData(typeof v==="string"?JSON.parse(v):v); }catch(e){} } }); }catch(e){}',
  '  return false;',
  '}',
].join('\n');

export const TOOLS = {
  terzaghi: {
    engineId: 'fondation-superficielle',
    referencePath: 'packages/engines/reference/terzaghi_V13.html',
    // sha256 = registre (packages/engines/src/registry/registry.ts).
    expectedSha256: '43214960a014d64e76c8d06e8d9c9746157ba0f75220afc425d6e87fd102c291',
    outputPath: 'apps/web/src/tools-cloned/terzaghi.html',
    sourceFileName: 'terzaghi_V13.html',
    // Fonctions science supprimees INTEGRALEMENT (top-level ; les closures
    // internes partent avec leur parent). = ENGINE_SYMBOLS sans elasticRaid/IzAt.
    removeFunctions: TERZAGHI_ENGINE_SYMBOLS.filter(
      (n) => n !== 'elasticRaid' && n !== 'IzAt',
    ),
    // Tables de calibration supprimees (LAMB/CF_GIROUD) ; KP/KC remplacees par
    // leurs LABELS seuls (buildNote lit KP[cat].lib).
    removeConsts: ['LAMB', 'CF_GIROUD'],
    // caseSteps / refCapSteps : RESTAURES TELS QUELS depuis la source (ADR 0015 reco A
    // du 16/07 — dé-stub). Ce sont des RENDERERS PURS : ils lisent l'objet `C`/`R.refCap`
    // reconstruit par mapOutputToR a partir de la sortie serveur WHITELISTEE (grandeurs
    // d'affichage normatives — h_r/p_le*/D_e/k_p/i_δ/q_net/E_c/E_d/s_c/s_d/K_v… ; cf.
    // TerzaghiOutputSchema). Les COEFFICIENTS DE COURBE k_p/k_c (curveStr) proviennent du
    // serveur (cas[].coefCourbeF/C) et sont injectes dans KP/KC au mapping — jamais la table
    // complete cote clone. RESIDU FERME §8 : le detail des facteurs de portance c–φ annexe F
    // (N_q/N_c/N_γ), HORS allowlist nominative, n'est pas fourni — les modes c–φ/labo
    // affichent ce sous-detail incomplet (verdict + resistances restent fideles).
    replaceDecls: {
      KP: KP_LABELS,
      KC: KC_LABELS,
      recalc: RECALC_ASYNC,
    },
    // Bloc injecte juste apres l'ouverture du bloc UI (garde `if(document)`).
    insertAfterAnchor: "if(typeof document!=='undefined'){",
    insertBlock: '\n' + BRIDGE_AND_SHIM + '\n',
    // Symboles interdits dans le clone (audit-excision). Renderers/consts conserves
    // (caseSteps/refCapSteps re-injectes, KP/KC labels) NE sont PAS interdits.
    forbiddenSymbols: TERZAGHI_ENGINE_SYMBOLS,
  },
  roadsens: {
    engineId: 'chaussee-burmister',
    referencePath: 'packages/engines/reference/roadsens_burmister_definitive.html',
    // sha256 = registre (chaussee-burmister v2.0.0, ADR 0013) — LA définitive scellée.
    expectedSha256: '42bb46aa5da085cd5605664ce125e361392c77fbc717f9abc4b8d5910f1546f2',
    outputPath: 'apps/web/src/tools-cloned/roadsens.html',
    sourceFileName: 'roadsens_burmister_definitive.html',
    // Propagateur Burmister + calibration LCPC + orchestrateur doCalc supprimés.
    removeFunctions: BURMISTER_ENGINE_SYMBOLS,
    // Aucune const de calibration séparée : la table est PORTÉE par M (réduite via
    // replaceDecls). Rien à retirer ici.
    removeConsts: [],
    // M -> réduit aux champs d'affichage ; runCalc -> async/bridge ; loadPreset ->
    // doCalc(interdit) remplacé par runCalc() ; rFT -> liste sans table de calage.
    replaceDecls: {
      M: BURMISTER_M_DISPLAY,
      runCalc: BURMISTER_RUNCALC,
      loadPreset: BURMISTER_LOADPRESET,
      rFT: BURMISTER_RFT,
    },
    // Le script burmister n'a pas de garde `if(document)` : on injecte après la
    // déclaration d'état (`let nid=4;`, unique) — M/ly/pf/tr/cp sont alors définis,
    // les renderers (hoistés) restent appelables plus tard.
    insertAfterAnchor: 'let nid=4;',
    insertBlock: '\n' + BURMISTER_BRIDGE_AND_SHIM + '\n',
    // CONDITION §8 (titulaire) : chaque valeur AFFICHÉE vient du SERVEUR, jamais d'une
    // re-dérivation cliente. renderDetails l.1558 re-dérivait « et_adm/st_adm r=50 % »
    // (e50 = e6·kθ·(1e6/NE)^(1/b)·kc·ks) DANS le navigateur pour l'AFFICHER. On rebranche
    // sur la valeur serveur whitelistée `d.adm50` (= details.adm_r50, même formule côté
    // moteur) : plus aucun nombre affiché n'est calculé côté client.
    patchText: [
      {
        find: 'var e50=d.e6<Infinity?d.e6*d.ukth*Math.pow(1e6/d.NE,1/d.ub)*d.ukc*d.ks:null;',
        replace: 'var e50=(d.adm50!=null?d.adm50:null);',
        count: 1,
      },
    ],
    forbiddenSymbols: BURMISTER_ENGINE_SYMBOLS,
  },
  geoplaque: {
    // engineId « par défaut » (mode principal radier) ; les 3 modes 2D émettent leur
    // propre engineId via le bridge (plane-strain/axi/tri-raft), validé côté hôte.
    engineId: 'radier',
    referencePath: 'packages/engines/reference/GEOPLAQUE_V10.html',
    // sha256 = registre (radier-plaque / plane-strain / axi-plaque / radier-tri).
    expectedSha256: '45e3e24c405c35c21c0ae8e1d92f214036390f36f7215b96d97ac61feed9bbab',
    outputPath: 'apps/web/src/tools-cloned/geoplaque.html',
    sourceFileName: 'GEOPLAQUE_V10.html',
    // 4 solveurs EF + toute la science (algèbre dense, noyaux de tassement, matrices
    // élémentaires, maillage triangulaire) SUPPRIMÉS. La couche CAO reste intégrale.
    removeFunctions: GEOPLAQUE_ENGINE_SYMBOLS,
    removeConsts: [],
    // Renderers/entrées de calcul RÉÉCRITS : doSolve/runSolve (async bridge radier),
    // bakeField/drawContours (grille 48×48 serveur), drawCritical (couple whitelisté),
    // refreshResults/printReport (scalaires whitelistés), psPlot/axiPlot (profils
    // serveur), triMeshSvg (champDeflexion), init (auto-test ACM retiré).
    replaceDecls: {
      doSolve: GEOPLAQUE_DOSOLVE,
      runSolve: GEOPLAQUE_RUNSOLVE,
      bakeField: GEOPLAQUE_BAKEFIELD,
      drawContours: GEOPLAQUE_DRAWCONTOURS,
      drawCritical: GEOPLAQUE_DRAWCRITICAL,
      refreshResults: GEOPLAQUE_REFRESHRESULTS,
      printReport: GEOPLAQUE_PRINTREPORT,
      psPlot: GEOPLAQUE_PSPLOT,
      axiPlot: GEOPLAQUE_AXIPLOT,
      triMeshSvg: GEOPLAQUE_TRIMESHSVG,
      init: GEOPLAQUE_INIT,
    },
    // Handlers 2D anonymes (onclick) réécrits en async/bridge (chacun son engineId).
    replaceOnclick: {
      'ps-run': GEOPLAQUE_PSRUN,
      'ax-run': GEOPLAQUE_AXRUN,
      'tri-run': GEOPLAQUE_TRIRUN,
    },
    // Injecté après l'enregistrement du listener de boot : tout l'état (state/view/iso/
    // bakeTiles) et les renderers hoistés sont alors définis ; l'IIFE du bridge poste
    // « ready » avant que l'événement `load` (init) ne se déclenche.
    insertAfterAnchor: "window.addEventListener('load',init);",
    insertBlock: '\n' + GEOPLAQUE_BRIDGE_AND_SHIM + '\n',
    forbiddenSymbols: GEOPLAQUE_ENGINE_SYMBOLS,
  },
  casagrande: {
    engineId: 'pieux',
    referencePath: 'packages/engines/reference/casagrande_V5.html',
    // sha256 = registre (fondation-profonde-pieux v1.2.0).
    expectedSha256: '54c5d7d4cfd0d88998b26010335c888b9361163e0eb2825814f0c6430e4d86b0',
    outputPath: 'apps/web/src/tools-cloned/casagrande.html',
    sourceFileName: 'casagrande_V5.html',
    // Science NF P 94-262 supprimée INTÉGRALEMENT + helpers publics dead (mResist =
    // sélection EC7.M publique ; qcAt = interpolation du pénétrogramme saisi) retirés.
    removeFunctions: CASAGRANDE_ENGINE_SYMBOLS.concat(['mResist', 'qcAt']),
    // Tables d'abaques (portance/frottement) + coefficients de courbe SUPPRIMÉS : ne
    // partent jamais au navigateur. EC7/DA_COMBOS/PILES restent (publics).
    removeConsts: [
      'KP_MAX',
      'KC_MAX',
      'ALPHA_PMT',
      'ALPHA_CPT',
      'QSMAX',
      'PMT_CURVE',
      'CPT_CURVE',
    ],
    // Entrées de calcul → async/bridge ; renderers de résultat → sortie whitelistée.
    // renderResults/drawCoupe/drawQcLog CONSERVÉS (fed par mapPieuxOutput / saisie).
    replaceDecls: {
      compute: CASAGRANDE_COMPUTE,
      computeDowndrag: CASAGRANDE_DOWNDRAG,
      drawDowndrag: CASAGRANDE_DRAWDOWNDRAG,
      drawSettle: CASAGRANDE_DRAWSETTLE,
      drawBeton: CASAGRANDE_DRAWBETON,
      drawPortance: CASAGRANDE_DRAWPORTANCE,
      buildSoilCoefTable: CASAGRANDE_BUILDSOILCOEF,
      updateXiInfo: CASAGRANDE_UPDATEXI,
    },
    // Injecté après la déclaration du helper `num` (état `state`/`$`/`num` définis ;
    // `fmt` et les fonctions hoistées disponibles au 1er appel, jamais au chargement).
    insertAfterAnchor: 'const num = id => parseFloat($(id).value)||0;',
    insertBlock: '\n' + CASAGRANDE_BRIDGE_AND_SHIM + '\n',
    // compute/computeDowndrag sont RÉÉCRITS (noms conservés) → NON interdits (comme
    // recalc/runCalc/doSolve). Interdits = la science RETIRÉE.
    forbiddenSymbols: CASAGRANDE_ENGINE_SYMBOLS,
  },
  fastlab: {
    engineId: 'labo',
    referencePath: 'packages/engines/reference/FASTLAB7.html',
    // sha256 = registre (labo-classification-gtr v1.0.0).
    expectedSha256: '3271287e551448ea5ce8396a2e9687e38c7245a3c49259a02a5f4f393f48599a',
    outputPath: 'apps/web/src/tools-cloned/fastlab.html',
    sourceFileName: 'FASTLAB7.html',
    // ~20 kernels calc* + classify + helpers de calcul (lreg/fitPar/rsq/interpP/dAt/
    // granuloPts/rhoWaterT) + tables de decision (subFine/subB/stateFromRatio) SUPPRIMES.
    // CONSERVES : SAISIE + SPEC normatives (MOULES/PRPROC/MDE_CLASS/SIEVES/CBR_ENF…),
    // renderers canvas (draw*), fiche de synthese (renderRecap), pastilles (updateDots),
    // helpers de rendu (chip/f/setv), mdeClassKey (assiste la saisie via applyMdeVar).
    removeFunctions: FASTLAB_ENGINE_SYMBOLS,
    removeConsts: [],
    // recalc -> POST unique debounce ; Store -> proxy bridge ; saveSample -> classe serveur.
    replaceDecls: {
      recalc: FASTLAB_RECALC,
      Store: FASTLAB_STORE,
      saveSample: FASTLAB_SAVESAMPLE,
    },
    // Le script FASTLAB n a pas de garde `if(document)` : on injecte apres `const D={};`
    // (helpers de base $/chip/f/CFG/prType definis ; les fonctions de rendu/saisie hoistees
    // restent appelables au 1er recalc, jamais au boot). L IIFE du pont poste « ready »
    // AVANT le boot (renderThresholds();writeForm({});loadDB();).
    insertAfterAnchor: 'const D={};',
    insertBlock: '\n' + FASTLAB_BRIDGE_AND_RENDER + '\n',
    forbiddenSymbols: FASTLAB_ENGINE_SYMBOLS,
  },
  pressiopro: {
    // engineId « par défaut » (essai) ; les pages Étalonnage/Calibrage émettent leur
    // propre engineId via le bridge (liste fermée validée côté hôte : pressiometre,
    // pressio-etalonnage, pressio-calibrage).
    engineId: 'pressiometre-menard',
    referencePath: 'packages/engines/reference/pressiometre__1_.html',
    // sha256 = registre (pressiometre-menard / pressio-etalonnage / pressio-calibrage —
    // MEME fichier mono-source, meme sha256 pour les 3 slugs).
    expectedSha256: 'b5a06e1c34e1928b06a3e9dcd5628d516ba7d0d2818a67c62bdb43e93c65e4dc',
    outputPath: 'apps/web/src/tools-cloned/pressiopro.html',
    sourceFileName: 'pressiometre__1_.html',
    // Science NF EN ISO 22476-4 SUPPRIMEE : depouillement calcDepth (EM/pL/alpha/
    // categorie), coefficient rheologique getAlpha, extrapolation courbe-inverse
    // (fitAll/fitRecip/linReg), detection auto de la plage §D.5.1 (autoDetectPhase),
    // ajustement 3x3 du calibrage (solve3). Les renderers (renderResults/drawResCharts/
    // renderEtalResult/drawEtalChart/renderCalibResult/drawCalibChart/drawBoreholeLog/
    // drawPressioLog), TOUTE la saisie dynamique, les exports/imports (JSON/CSV) et la
    // nomenclature 22 sols ISO (SOILS/ETATS/QUAL_BY_CAT) restent INTEGRAUX.
    removeFunctions: PRESSIO_ENGINE_SYMBOLS,
    // Pas de const de calibration separee : SOILS/ETATS/QUALCOL/CATCOL sont la
    // NOMENCLATURE de SAISIE (couleurs/motifs des sols) -> conservees.
    removeConsts: [],
    // Entrees de calcul REECRITES (nom conserve) -> async/pont ; calcPh CONSERVE (arbitrage
    // ci-dessus). saveLocal/loadLocal -> proxy store bridge. updateSeuilPreview -> apercu
    // E_M live DEBOUNCE (patron FASTLAB). renderProfil -> auto-depouillement via pont (F7).
    replaceDecls: {
      doCalc: PRESSIO_DOCALC,
      updateSeuilPreview: PRESSIO_SEUILPREVIEW,
      renderProfil: PRESSIO_RENDERPROFIL,
      calcEtalonnage: PRESSIO_CALCETAL,
      calcCalibrage: PRESSIO_CALCCALIB,
      saveLocal: PRESSIO_SAVELOCAL,
      loadLocal: PRESSIO_LOADLOCAL,
    },
    // Injecte apres l'etat racine (`let depths = [], cur = 0, CC = {};`, unique) : depths/
    // cur/CC definis ; l'IIFE du pont poste « ready » AVANT DOMContentLoaded (boot).
    insertAfterAnchor: 'let depths = [], cur = 0, CC = {};',
    insertBlock: '\n' + PRESSIO_BRIDGE_AND_SHIM + '\n',
    // Le calcDepth loop est PARTAGE par applyData ET loadExempleFictif (CONSERVES) : on
    // le neutralise par patchText (count 2) au lieu de reecrire ces 2 fonctions volumineuses
    // (loadExempleFictif porte le gros jeu de demonstration inline). Le rendu final de
    // l'exemple part alors du pont (__pressioCalcAndShow), fidele « calcule + affiche le 1er ».
    patchText: [
      {
        find: 'depths.forEach((_,i)=>calcDepth(i));',
        replace: 'depths.forEach(function(dd){dd._res=null;});',
        count: 2,
      },
      {
        find: 'setTimeout(()=>renderResults(depths[0]._res, depths[0].label),100);',
        replace: 'setTimeout(function(){__pressioCalcAndShow(0);},100);',
        count: 1,
      },
    ],
    // doCalc/updateSeuilPreview/renderProfil/calcEtalonnage/calcCalibrage sont REECRITS
    // (noms conserves) -> NON interdits. Interdits = la science RETIREE (PRESSIO_ENGINE_SYMBOLS).
    forbiddenSymbols: PRESSIO_ENGINE_SYMBOLS,
  },
};

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

/** Genere le HTML du clone pour un outil (chaine). Ne touche PAS au disque. */
export function generateCloneHtml(toolId) {
  const cfg = TOOLS[toolId];
  if (!cfg) throw new Error(`Outil inconnu : ${toolId}`);
  const refAbs = resolve(REPO_ROOT, cfg.referencePath);
  const src = readFileSync(refAbs, 'utf8');
  const actual = sha256(src);
  if (actual !== cfg.expectedSha256) {
    throw new Error(
      `sha256 de la reference ${cfg.referencePath} = ${actual} != attendu ${cfg.expectedSha256}. ` +
        'La reference gelee a change : re-sceller le registre AVANT de regenerer.',
    );
  }

  // Collecte des operations (spans a supprimer / remplacer).
  const ops = [];
  for (const name of cfg.removeFunctions) {
    ops.push({ ...findDecl(src, name), text: '', name });
  }
  for (const name of cfg.removeConsts) {
    ops.push({ ...findDecl(src, name), text: '', name });
  }
  for (const [name, text] of Object.entries(cfg.replaceDecls)) {
    ops.push({ ...findDecl(src, name), text, name });
  }
  // Handlers onclick anonymes (GEOPLAQUE 2D) reecrits en async/bridge.
  for (const [id, text] of Object.entries(cfg.replaceOnclick ?? {})) {
    ops.push({ ...findOnclickAssignment(src, id), text, name: `onclick:${id}` });
  }

  // Verifie l'absence de chevauchement (spans disjoints).
  const sorted = [...ops].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start < sorted[i - 1].end) {
      throw new Error(
        `Chevauchement de spans entre « ${sorted[i - 1].name} » et « ${sorted[i].name} ».`,
      );
    }
  }

  // Applique de la fin vers le debut (indices stables).
  let out = src;
  for (let i = sorted.length - 1; i >= 0; i--) {
    const op = sorted[i];
    out = out.slice(0, op.start) + op.text + out.slice(op.end);
  }

  // Injection du bloc bridge apres l'ancre (recherche literale, robuste aux edits).
  const anchorIdx = out.indexOf(cfg.insertAfterAnchor);
  if (anchorIdx < 0) {
    throw new Error(`Ancre d'injection introuvable : ${cfg.insertAfterAnchor}`);
  }
  const at = anchorIdx + cfg.insertAfterAnchor.length;
  out = out.slice(0, at) + cfg.insertBlock + out.slice(at);

  // Correctifs textuels cibles (find/replace litteral) sur des LIGNES CONSERVEES qu'on
  // ne peut pas atteindre par une remise en cause de declaration entiere. Chaque patch
  // exige un NOMBRE d'occurrences precis (defaut 1) -> echec dur si la source derive
  // (fidelite du portage). Ex. roadsens : rebrancher l'affichage « adm r=50 % » sur la
  // valeur SERVEUR (adm50) au lieu de la re-derivation cliente (condition §8 titulaire).
  for (const patch of cfg.patchText ?? []) {
    const want = patch.count ?? 1;
    const parts = out.split(patch.find);
    const found = parts.length - 1;
    if (found !== want) {
      throw new Error(
        `patchText « ${patch.find.slice(0, 48)}… » : ${found} occurrence(s) trouvée(s), ${want} attendue(s) (source dérivée ?).`,
      );
    }
    out = parts.join(patch.replace);
  }

  // Hygiene §8 — retrait des COMMENTAIRES mentionnant un symbole moteur excise (nom du
  // propagateur, coefficients de calage…) DANS LES <script> uniquement (le scanner JS ne
  // doit pas courir sur le HTML brut). Ne touche jamais le code ni les chaines.
  out = out.replace(
    /(<script\b[^>]*>)([\s\S]*?)(<\/script>)/gi,
    (_m, open, body, close) =>
      open + stripForbiddenComments(body, cfg.forbiddenSymbols) + close,
  );

  // En-tete byte-stable (sha, PAS de date).
  const header =
    '<!--\n' +
    '  CLONE EXCISÉ — NE PAS ÉDITER À LA MAIN. Artefact généré par scripts/clone-tool.mjs.\n' +
    `  Outil            : ${toolId} (${cfg.engineId})\n` +
    `  Source (gelée)   : ${cfg.sourceFileName}\n` +
    `  sha256 source    : ${cfg.expectedSha256}\n` +
    '  Calcul           : EXCISÉ — exécuté côté serveur via bridge postMessage (ADR 0015, DoD §8).\n' +
    '  Régénérer        : pnpm clone:tools   ·   Auditer : pnpm audit:excision\n' +
    '-->\n';
  return header + out;
}

/** Genere ET ecrit le clone d'un outil. Renvoie { outputPath, bytes }. */
export function writeClone(toolId) {
  const cfg = TOOLS[toolId];
  const html = generateCloneHtml(toolId);
  const outAbs = resolve(REPO_ROOT, cfg.outputPath);
  mkdirSync(dirname(outAbs), { recursive: true });
  writeFileSync(outAbs, html, 'utf8');
  return { outputPath: cfg.outputPath, bytes: Buffer.byteLength(html) };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function isMain() {
  return (
    process.argv[1] &&
    resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
  );
}

if (isMain()) {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const ids = Object.keys(TOOLS);
  let drift = false;
  for (const id of ids) {
    if (check) {
      // Mode idempotence : regenere en memoire, compare au fichier commite.
      const cfg = TOOLS[id];
      const outAbs = resolve(REPO_ROOT, cfg.outputPath);
      const generated = generateCloneHtml(id);
      let onDisk = null;
      try {
        onDisk = readFileSync(outAbs, 'utf8');
      } catch {
        onDisk = null;
      }
      if (onDisk !== generated) {
        drift = true;
        console.error(
          `[clone-tool] DRIFT : ${cfg.outputPath} != sortie regeneree (lancer « pnpm clone:tools »).`,
        );
      } else {
        console.log(`[clone-tool] OK (idempotent) : ${cfg.outputPath}`);
      }
    } else {
      const r = writeClone(id);
      console.log(`[clone-tool] écrit ${r.outputPath} (${r.bytes} octets)`);
    }
  }
  if (check && drift) process.exit(1);
}
