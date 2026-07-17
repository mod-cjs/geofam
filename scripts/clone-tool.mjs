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
