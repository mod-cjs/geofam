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

import { TOOLS, stripCommentsAndStrings } from './clone-tool.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');

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
        sample: code
          .slice(from, hit.index + sym.length + 8)
          .replace(/\s+/g, ' ')
          .trim(),
      });
    }
  }
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
        console.error(`   - ${v.symbol}   (…${v.sample}…)`);
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
