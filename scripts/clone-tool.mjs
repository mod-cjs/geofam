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
  '    context:function(){ return ctx; }',
  '  };',
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
  "  catch(e){ var el=document.getElementById('resout'); if(el) el.innerHTML='<div class=\"note note-a\" style=\"margin-top:1rem\"><strong>Erreur de rendu :</strong> '+_esc(e&&e.message)+'</div>'; }",
  '  _restoreCalcBtn(); _gotoResults();',
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
  '    context:function(){ return ctx; }',
  '  };',
  '  post({v:1,type:"ready",payload:{toolId:TOOL_ID}});',
  '})();',
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
// mm-echelle (piege d'unite deja tranche, memoire radier-units) -> le clone AFFICHE
// les tassements SANS le x1000 de l'outil d'origine (« GEOPLAQUE sur-rapporte x1000,
// ne pas copier »). Les autres grandeurs (moments/reactions/EI/ratios) sont rendues
// telles quelles depuis la sortie serveur.
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
 * whitelistés (jamais de champ nodal ni de localisation de nœud). Tassements SANS ×1000
 * (déjà en mm-échelle côté serveur). Masquages §8 documentés inline. */
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
  '  var wmaxmm=d.wMax, diffmm=d.diff;',
  '  var betaGov=d.betaGov, tilt=d.tiltMax;',
  '  h+=\'<div class="secth" style="margin-top:14px">Vérifications · EC7 annexe H</div>\';',
  '  h+=chk("Tassement total max", wmaxmm.toFixed(1)+" mm", lvlSettle(wmaxmm), "repère \\u2248 50 mm pour fondations isolées");',
  '  h+=chk("Tassement différentiel", diffmm.toFixed(1)+" mm", lvlDiff(diffmm), "repère \\u2248 20 mm entre appuis adjacents");',
  '  h+=chk("Distorsion angulaire β", ratio1(betaGov)+"  ("+betaGov.toExponential(1)+" rad)", lvlBeta(betaGov), "rotation relative · limite ELS \\u2248 1/500, ELU \\u2248 1/150");',
  '  h+=chk("Inclinaison d\\u2019ensemble ϖ", ratio1(tilt), tilt<=1/500?"ok":tilt<=1/150?"warn":"bad", "basculement rigide (séparé de la distorsion) · visible vers 1/500");',
  '  if(d.nRafts>1) h+=chk("Distorsion entre plaques", ratio1(d.interBeta)+"  · Δs "+(d.interDiff).toFixed(1)+" mm", lvlBeta(d.interBeta), "rotation relative entre centres de plaques voisines");',
  '  var lp=d.loadPairs;',
  '  if(lp && lp.worst){ var w=lp.worst;',
  '    h+=chk("Distorsion entre charges (max)", ratio1(w.beta)+"  · Δs "+(w.ds).toFixed(1)+" mm / "+w.L.toFixed(2)+" m", lvlBeta(w.beta), "colonnes adjacentes les plus défavorables : charge "+w.ki+" \\u2194 "+w.kj); }',
  '  h+=\'<div class="secth" style="margin-top:16px">Synthèse</div>\';',
  "  var st=function(a,v){ return '<div class=\"stat\"><span>'+a+'</span><b>'+v+'</b></div>'; };",
  '  if(d.nRafts>1) h+=st("Plaques modélisées", d.nRafts);',
  '  h+=st("Tassement max / min", wmaxmm.toFixed(1)+" / "+(d.wMin).toFixed(1)+" mm");',
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
  '  h+=\'<p style="font-size:10.5px;color:var(--ink-dim);margin-top:10px;line-height:1.5">θx = ∂w/∂y (rotation autour de X), θy = −∂w/∂x. La distorsion β est la pente résiduelle après retrait du plan moyen de chaque plaque ; l\\u2019inclinaison ϖ est ce basculement. Hypothèses : plaque mince de Kirchhoff, sol élastique linéaire (Steinbrenner + Boussinesq, substratum rigide). Calcul et cartographie exécutés côté serveur (méthode confidentielle) ; la carte est une grille d\\u2019affichage ré-échantillonnée (48×48) découplée du maillage.</p>\';',
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
  '  s+=band(wD.x,wD.v,pad,"#5ea9ff","tassement w","mm");',
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
  '  s+=band(wD.x,wD.v,pad,"#5ea9ff","tassement w","mm");',
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
  '  s+=\'<text x="\'+(W/2)+\'" y="\'+(Hh-3)+\'" fill="var(--ink-dim,#789)" font-size="9" text-anchor="middle" font-family="var(--mono)">tassement — bleu \'+wmn.toFixed(1)+\' mm \\u2192 rouge \'+wmx.toFixed(1)+\' mm · grille d\\u2019affichage 48×48</text>\';',
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
  '  if(R && R.diag){ var d=R.diag; var wmaxmm=d.wMax, diffmm=d.diff;',
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
  '    +(d.nRafts>1?"<tr><td>Distorsion entre plaques</td><td>"+ratio1(d.interBeta)+" · Δs "+(d.interDiff).toFixed(1)+" mm</td><td>ELS 1/500</td><td>"+verdict(lvlBeta(d.interBeta))+"</td></tr>":"")',
  '    +(d.loadPairs&&d.loadPairs.worst?"<tr><td>Distorsion entre charges (max) — P"+d.loadPairs.worst.ki+"↔P"+d.loadPairs.worst.kj+"</td><td>"+ratio1(d.loadPairs.worst.beta)+" · Δs "+(d.loadPairs.worst.ds).toFixed(1)+" mm / "+d.loadPairs.worst.L.toFixed(2)+" m</td><td>ELS 1/500 · ELU 1/150</td><td>"+verdict(lvlBeta(d.loadPairs.worst.beta))+"</td></tr>":"")',
  '    +"</table>"',
  '    +"<h2>Synthèse des résultats</h2>"',
  '    +\'<table class="syn">\'',
  '    +(d.nRafts>1?"<tr><td>Plaques modélisées</td><td>"+d.nRafts+"</td></tr>":"")',
  '    +"<tr><td>Tassement max / min</td><td>"+wmaxmm.toFixed(1)+" / "+(d.wMin).toFixed(1)+" mm</td></tr>"',
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

/** Handler ps-run RÉÉCRIT : async, bridge (plane-strain). Tassements SANS ×1000. */
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
  '  var h=st("Tassement max / min",(R.wMax).toFixed(1)+" / "+(R.wMin).toFixed(1)+" mm");',
  '  h+=st("Tassement différentiel",(R.diff).toFixed(1)+" mm");',
  '  h+=st("Moment max (+/−)",(R.mMax).toFixed(1)+" / "+(R.mMin).toFixed(1)+" kN·m/m");',
  '  h+=st("Réaction sol max",(R.pMax).toFixed(1)+" kPa");',
  '  h+=st("Charge / réaction Σ",(R.totalLoad).toFixed(0)+" / "+(R.sumReact).toFixed(0)+" kN/m"+_eqSuffix(R.totalLoad,R.sumReact));',
  '  if(foundD>0) h+=st("Cote d\\u2019assise D",(R.z0).toFixed(2)+" m");',
  '  if(decol) h+=st("Décollement",(R.decolN)+" nœud(s)");',
  '  h+=st("Rigidité D (E·e³/12(1−ν²))",(R.EI).toExponential(2)+" kN·m");',
  '  out.innerHTML=h+psPlot(R);',
  '}',
].join('\n');

/** Handler ax-run RÉÉCRIT : async, bridge (axi ; clé opts = `o`). Tassements SANS ×1000. */
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
  '  var h=st("Tassement centre / bord",(R.wc).toFixed(1)+" / "+(R.wEdge).toFixed(1)+" mm");',
  '  h+=st("Tassement différentiel",(R.diff).toFixed(1)+" mm");',
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
  '  h+=st("Tassement max / min",(R.wMax).toFixed(1)+" / "+(R.wMin).toFixed(1)+" mm");',
  '  h+=st("Tassement différentiel",(R.diff).toFixed(1)+" mm");',
  '  h+=st("Réaction sol max",(R.reactionMax).toFixed(1)+" kPa");',
  '  h+=st("Charge / réaction Σ",(R.totalLoad).toFixed(0)+" / "+(R.sumReact).toFixed(0)+" kN"+_eqSuffix(R.totalLoad,R.sumReact));',
  '  if(foundD>0) h+=st("Cote d\\u2019assise D",(R.z0).toFixed(2)+" m");',
  '  out.innerHTML=h+triMeshSvg(R);',
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
