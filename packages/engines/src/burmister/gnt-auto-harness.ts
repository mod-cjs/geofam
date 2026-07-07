/**
 * Harnais d'EQUIVALENCE-PORTAGE du MODULE GNT AUTOMATIQUE : reference DEFINITIVE
 * (`packages/engines/reference/roadsens_burmister_definitive.html`, non gelee —
 * copiee dans le depot) <-> module TS (`applyGntAuto` + `computeBurmister`,
 * flag `gntAuto`, #87 etape 1/2).
 *
 * PARTICULARITE (vs `equivalence-harness.ts`, qui pilote l'ANCIENNE reference via
 * le registre) : ce harnais pointe EXPLICITEMENT vers le fichier de reference
 * definitive (chemin fixe, pas le registre — la reference du registre reste
 * l'ancien HTML tant que l'etape 2/2 [rebase de l'interface] n'est pas faite).
 * Meme mecanisme de pilotage que `loadOriginalCompute` : `doCalc()` lit son etat
 * dans des globales lexicales (`ly`,`pf`,`tr`,`cp`) ; on les REASSIGNE via un eval
 * dans le contexte jsdom, on appelle `doCalc()`, on capture `_D`.
 *
 * PORTEE : ce harnais sert UNIQUEMENT a prouver l'equivalence du pre-traitement
 * GNT (gntAuto=true) sur des jeux de couches SANS deux couches RIGIDES (MTLH/
 * beton) ADJACENTES — la reference definitive generalise le traitement des
 * conditions d'interface (Tab. 68, `ifaceAuto`/`_solveSet`) a TOUTE paire de
 * couches rigides consecutives, alors que le module TS actuel (engine.ts,
 * transcription de l'ANCIENNE reference) ne traite ce cas que pour le critere
 * sigma_t local (`rigL`). Sur les fixtures GNT choisies ici, `ifaceAuto` renvoie
 * TOUJOURS 'collee' (aucune paire rig/rig adjacente) : les deux chemins de calcul
 * sont alors STRICTEMENT identiques, et la comparaison isole le SEUL delta du
 * portage : le module GNT. Le rebase complet du reste de la science (conditions
 * d'interface generalisees, table materiaux mise a jour) est HORS PERIMETRE de
 * cette etape (#87 etape 2/2, a traiter separement).
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { JSDOM } from 'jsdom';

import type { BurmisterInput } from './contract.js';

const here = dirname(fileURLToPath(import.meta.url));
// packages/engines/src/burmister -> packages/engines/reference (2 niveaux up).
const DEFINITIVE_PATH = resolve(
  here,
  '..',
  '..',
  'reference',
  'roadsens_burmister_definitive.html',
);

/** Localise la reference DEFINITIVE burmister (chemin fixe, hors registre). */
export function burmisterDefinitiveSourcePath(): string {
  return DEFINITIVE_PATH;
}

/**
 * Verifie si la reference definitive est presente localement. Permet au test de
 * SKIP BRUYAMMENT sans faux-vert si le fichier est absent (ex. CI sans ce fichier
 * copie).
 */
export function burmisterDefinitiveSourceAvailable(): boolean {
  try {
    readFileSync(DEFINITIVE_PATH);
    return true;
  } catch {
    return false;
  }
}

/**
 * Charge la reference DEFINITIVE dans jsdom et renvoie `computeHtml` : pour un
 * etat donne, pilote `doCalc()` (qui applique `applyGntAuto()` en tete si
 * `cp.gntAuto` est vrai — l.1055-1056 de la reference) et renvoie `_D` BRUT.
 *
 * @throws si le fichier est absent — l'appelant doit alors SKIP BRUYAMMENT.
 */
export function loadDefinitiveCompute(): {
  computeHtml: (state: BurmisterInput) => unknown;
  cleanup: () => void;
} {
  const html = readFileSync(DEFINITIVE_PATH, 'utf8');
  const dom = new JSDOM(html, { runScripts: 'dangerously' });
  const win = dom.window as unknown as { eval: (code: string) => unknown };

  if (win.eval('typeof doCalc') !== 'function') {
    throw new Error(
      "La reference definitive n'expose pas doCalc : structure du moteur modifiee ?",
    );
  }

  const computeHtml = (state: BurmisterInput): unknown => {
    const code = `
      ly = ${JSON.stringify(state.layers)};
      pf = ${JSON.stringify(state.subgrade)};
      tr = ${JSON.stringify(state.traffic)};
      cp = ${JSON.stringify(state.load)};
      let __err = null;
      try { doCalc(); } catch (e) { __err = e && e.message ? String(e.message) : 'Erreur de calcul'; }
      __err !== null ? JSON.stringify({ err: __err }) : JSON.stringify(_D);
    `;
    return JSON.parse(win.eval(code) as string);
  };

  return { computeHtml, cleanup: () => dom.window.close() };
}
