#!/usr/bin/env node
/**
 * audit-excision.mjs — GARDE-FOU MECANIQUE §8 pour les clones d'UI (ADR 0015).
 *
 * Echoue si un SYMBOLE MOTEUR (liste nominative par outil, source de verite dans
 * scripts/clone-tool.mjs) apparait comme CODE dans un clone servi
 * (apps/web/src/tools-cloned/*.html). Complete les barrieres du §8 (ESLint
 * engines->web + controle de bundle) : ici on prouve que le CALCUL n'a pas fuite
 * dans l'UI clonee servie au navigateur.
 *
 * PRECISION anti faux-positif / anti faux-negatif :
 *  - on n'inspecte que le CONTENU des <script> (le calcul ne vit que la) ;
 *  - on DEPOUILLE chaines de caracteres et commentaires AVANT de chercher : un
 *    nom moteur en PROSE (label « raideurs J.3 », commentaire) n'est pas du code
 *    moteur fuite ; on cherche l'usage APPELANT `NAME(` dans le code executable ;
 *  - « 0 clone inspecte » = ECHEC dur (jamais un faux-vert) ;
 *  - le clone reel doit PASSER, un temoin contenant `computeAll(` doit ECHOUER
 *    (--self-test).
 *
 * Ne s'appuie PAS sur la reference gelee (hors git en CI) : il lit le clone
 * COMMITE. Branche au review-gate a cote de la barriere de bundle §8.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { TOOLS, stripCommentsAndStrings, scanForbiddenComments } from './clone-tool.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');

/**
 * PHRASES INTERDITES dans TOUT clone servi (directive titulaire) : plus aucun texte
 * « placeholder » du type « en attente de validation » — chaque restitution est soit
 * le rendu réel de la sortie serveur, soit le comportement natif de l'outil. NB : on ne
 * bannit PAS « méthode confidentielle » ici — c'est une divulgation LÉGITIME et validée
 * (heatmap GEOPLAQUE design-sûr) ; la bannir casserait un clone conforme.
 */
const BANNED_PHRASES = ['attente de validation'];

/** Recense les PHRASES interdites (placeholders bannis) dans le HTML brut d'un clone. */
function bannedPhraseViolations(html) {
  const hits = [];
  for (const phrase of BANNED_PHRASES) {
    const idx = html.indexOf(phrase);
    if (idx >= 0) {
      const from = Math.max(0, idx - 24);
      hits.push({
        symbol: phrase,
        kind: 'phrase',
        sample: html
          .slice(from, idx + phrase.length + 8)
          .replace(/\s+/g, ' ')
          .trim(),
      });
    }
  }
  return hits;
}

/** Concatene le CODE (hors chaines/commentaires) de tous les <script> d'un HTML. */
function scriptCodeOf(html) {
  const re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  let code = '';
  while ((m = re.exec(html)) !== null) {
    code += stripCommentsAndStrings(m[1]) + '\n';
  }
  return code;
}

/** Recense les COMMENTAIRES des <script> mentionnant un symbole moteur excise (filet
 * prose §8 : le nom d'une methode confidentielle ne doit pas partir en prose non plus). */
function scriptCommentViolations(html, forbiddenSymbols) {
  const re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  const hits = [];
  while ((m = re.exec(html)) !== null) {
    for (const h of scanForbiddenComments(m[1], forbiddenSymbols)) hits.push(h);
  }
  return hits;
}

/**
 * Audite une chaine HTML de clone contre une liste de symboles interdits.
 * Renvoie la liste des violations [{ symbol, sample }]. Vide = propre.
 */
export function auditHtml(html, forbiddenSymbols) {
  const code = scriptCodeOf(html);
  const violations = [];
  for (const sym of forbiddenSymbols) {
    const esc = sym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Usage APPELANT : `NAME(` (appel ou declaration). Ignore la prose depouillee.
    const re = new RegExp(`(?<![\\w.$])${esc}\\s*\\(`);
    const hit = re.exec(code);
    if (hit) {
      const from = Math.max(0, hit.index - 24);
      violations.push({
        symbol: sym,
        kind: 'code',
        sample: code
          .slice(from, hit.index + sym.length + 8)
          .replace(/\s+/g, ' ')
          .trim(),
      });
    }
  }
  // FILET PROSE §8 : un COMMENTAIRE trahissant le nom d'une methode moteur excisee
  // (ex. « burIntegrateML ») est aussi une fuite -> viole l'audit. Meme predicat que le
  // generateur (stripForbiddenComments) : l'audit ne peut donc echouer que si le clone
  // servi n'a PAS ete regenere (drift), jamais sur du code legitime.
  for (const h of scriptCommentViolations(html, forbiddenSymbols)) {
    violations.push({ symbol: h.symbol, kind: 'prose', sample: h.sample });
  }
  // PLACEHOLDERS BANNIS (directive titulaire) — transverse à tous les clones.
  for (const h of bannedPhraseViolations(html)) violations.push(h);
  return violations;
}

/** Audite le clone COMMITE d'un outil. Renvoie { toolId, path, violations }. */
export function auditTool(toolId) {
  const cfg = TOOLS[toolId];
  if (!cfg) throw new Error(`Outil inconnu : ${toolId}`);
  const abs = resolve(REPO_ROOT, cfg.outputPath);
  const html = readFileSync(abs, 'utf8');
  return {
    toolId,
    path: cfg.outputPath,
    violations: auditHtml(html, cfg.forbiddenSymbols),
  };
}

/** Audite TOUS les outils configures. Jette si 0 clone (faux-vert interdit). */
export function auditAll() {
  const ids = Object.keys(TOOLS);
  if (ids.length === 0)
    throw new Error('Aucun outil configure : audit vide interdit (§8).');
  return ids.map((id) => auditTool(id));
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
  const selfTest = process.argv.includes('--self-test');
  if (selfTest) {
    // TEMOINS NEGATIFS — POUR CHAQUE outil, un clone forge contenant un APPEL a son
    // 1er symbole moteur DOIT etre capture (sinon l'audit est trop laxiste / un
    // faux-vert masquerait une fuite de calcul). On teste aussi le temoin historique
    // `computeAll` (terzaghi) pour non-regression.
    let allCaught = true;
    for (const [toolId, cfg] of Object.entries(TOOLS)) {
      const sym = cfg.forbiddenSymbols[0];
      const witness = `<html><script>"use strict"; function recalc(){ const R=${sym}(state); return R; }</script></html>`;
      const caught = auditHtml(witness, cfg.forbiddenSymbols).some(
        (v) => v.symbol === sym,
      );
      console.log(
        `[audit] self-test temoin ${toolId} (${sym}) capturé : ${caught ? 'OUI' : 'NON'}`,
      );
      if (!caught) allCaught = false;
    }
    // Temoin transverse explicite (terzaghi computeAll) — garde de non-regression.
    const terzForb = TOOLS.terzaghi?.forbiddenSymbols ?? [];
    const computeAllWitness =
      '<html><script>"use strict"; function recalc(){ const R=computeAll(state); return R; }</script></html>';
    const computeAllCaught = auditHtml(computeAllWitness, terzForb).some(
      (v) => v.symbol === 'computeAll',
    );
    console.log(
      `[audit] self-test temoin transverse (computeAll) capturé : ${computeAllCaught ? 'OUI' : 'NON'}`,
    );
    if (!computeAllCaught) allCaught = false;

    // Temoins geoplaque explicites (solveModel appelant + solveDense LU) — un clone qui
    // laisserait fuiter l'ORCHESTRATEUR EF ou le SOLVEUR DENSE doit ECHOUER.
    const geoForb = TOOLS.geoplaque?.forbiddenSymbols ?? [];
    for (const sym of ['solveModel', 'solveDense']) {
      const witness = `<html><script>"use strict"; function doSolve(){ const R=${sym}(opts); return R; }</script></html>`;
      const caught = auditHtml(witness, geoForb).some((v) => v.symbol === sym);
      console.log(
        `[audit] self-test temoin geoplaque (${sym}) capturé : ${caught ? 'OUI' : 'NON'}`,
      );
      if (!caught) allCaught = false;
    }

    // Temoins casagrande explicites (science NF P 94-262) — un clone pieux qui laisserait
    // fuiter la METHODE DE PORTANCE (portanceCore), le TASSEMENT (settlement), la
    // VERIFICATION BETON (betonCheck) ou l'ECRETAGE q_ce (computeQce) doit ECHOUER.
    const casaForb = TOOLS.casagrande?.forbiddenSymbols ?? [];
    for (const sym of ['portanceCore', 'settlement', 'betonCheck', 'computeQce']) {
      const witness = `<html><script>"use strict"; function compute(){ const R=${sym}(state); return R; }</script></html>`;
      const caught = auditHtml(witness, casaForb).some((v) => v.symbol === sym);
      console.log(
        `[audit] self-test temoin casagrande (${sym}) capturé : ${caught ? 'OUI' : 'NON'}`,
      );
      if (!caught) allCaught = false;
    }

    // Temoins fastlab explicites — un clone labo qui laisserait fuiter un KERNEL de calcul
    // (calcGranulo) ou l ARBRE de classification GTR (classify) doit ECHOUER.
    const fastForb = TOOLS.fastlab?.forbiddenSymbols ?? [];
    for (const sym of ['calcGranulo', 'classify']) {
      const witness = `<html><script>"use strict"; function recalc(){ const R=${sym}(state); return R; }</script></html>`;
      const caught = auditHtml(witness, fastForb).some((v) => v.symbol === sym);
      console.log(
        `[audit] self-test temoin fastlab (${sym}) capturé : ${caught ? 'OUI' : 'NON'}`,
      );
      if (!caught) allCaught = false;
    }

    // Temoin PROSE (roadsens) — un COMMENTAIRE trahissant le nom du propagateur excise
    // (« burIntegrateML », abreviation de burIntegrateMLWithPSC) doit ECHOUER meme sans
    // appel de code : le filet prose §8 le capture.
    const burmForb = TOOLS.roadsens?.forbiddenSymbols ?? [];
    const proseWitness =
      '<html><script>function renderDetails(){ /* le resultat est deja dans sr_acc du burIntegrateML si on indexe */ return 0; }</script></html>';
    const proseCaught = auditHtml(proseWitness, burmForb).some((v) => v.kind === 'prose');
    console.log(
      `[audit] self-test temoin prose (burIntegrateML) capturé : ${proseCaught ? 'OUI' : 'NON'}`,
    );
    if (!proseCaught) allCaught = false;

    // Temoin PHRASE INTERDITE — un clone qui contiendrait un placeholder « en attente de
    // validation » (rendu ou prose) doit ECHOUER (directive titulaire, transverse aux 5).
    const phraseWitness =
      '<html><body><div>Restitution en attente de validation (défaut NON).</div></body></html>';
    const phraseCaught = auditHtml(phraseWitness, []).some((v) => v.kind === 'phrase');
    console.log(
      `[audit] self-test temoin phrase (attente de validation) capturé : ${phraseCaught ? 'OUI' : 'NON'}`,
    );
    if (!phraseCaught) allCaught = false;

    // Le clone reel DOIT passer.
    let realClean = true;
    try {
      realClean = auditAll().every((r) => r.violations.length === 0);
    } catch (e) {
      console.error('[audit] self-test : lecture du clone reel impossible :', e.message);
      realClean = false;
    }
    console.log(
      `[audit] self-test clone réel propre          : ${realClean ? 'OUI' : 'NON'}`,
    );
    if (!allCaught) {
      console.error(
        '[audit] ECHEC : un temoin moteur n a PAS ete capture (audit trop laxiste).',
      );
      process.exit(1);
    }
    if (!realClean) {
      console.error('[audit] ECHEC : le clone reel n est PAS propre.');
      process.exit(1);
    }
    console.log('[audit] self-test OK.');
    process.exit(0);
  }

  let failed = false;
  const results = auditAll();
  for (const r of results) {
    if (r.violations.length === 0) {
      console.log(`[audit] OK : aucun symbole moteur dans ${r.path}`);
    } else {
      failed = true;
      console.error(`[audit] FUITE dans ${r.path} :`);
      for (const v of r.violations) {
        console.error(`   - ${v.symbol} [${v.kind || 'code'}]   (…${v.sample}…)`);
      }
    }
  }
  if (failed) {
    console.error(
      '[audit] ECHEC : du calcul moteur a fuite dans un clone servi (DoD §8).',
    );
    process.exit(1);
  }
  console.log(`[audit] ${results.length} clone(s) audité(s) — conformes §8.`);
}
