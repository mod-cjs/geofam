/**
 * META DE VERSION burmister (ADR 0013) — bout-en-bout local.
 *
 * Prouve que la sortie publique `runBurmister` estampille la meta ATTENDUE apres la
 * bascule : `engineVersion === '2.0.0'` et `engineSourceHash === sha256(reference
 * definitive) === 42bb`. C'est le pendant LOCAL (module) de la sentinelle Playwright
 * `test.fail()` qui vise le SERVEUR Render (encore sur 259a tant qu'il n'est pas
 * redeploye) : ici, en local, la meta reflete deja le registre bascule.
 *
 * resolveMeta (index.ts) lit `sha256`/`version` du registre : ce test ferme la
 * boucle registre -> meta -> fichier de reference (aucune valeur codee en double
 * cote moteur).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { runBurmister } from './index.js';

const here = dirname(fileURLToPath(import.meta.url));
// packages/engines/src/burmister -> packages/engines/reference (2 niveaux up).
const DEFINITIVE_HTML = resolve(
  here,
  '..',
  '..',
  'reference',
  'roadsens_burmister_definitive.html',
);
const DEFINITIVE_SHA = '42bb46aa5da085cd5605664ce125e361392c77fbc717f9abc4b8d5910f1546f2';

describe('burmister — meta de version scellee (ADR 0013)', () => {
  const env = runBurmister({
    layers: [
      { mat: 'BBSG1', h: 0.06, E: 1512, nu: 0.45 },
      { mat: 'GB3', h: 0.1, E: 2588, nu: 0.45 },
      { mat: 'GL1', h: 0.25, E: 200, nu: 0.35 },
    ],
    subgrade: { cls: 'PF2', E: 50, nu: 0.35 },
    traffic: { T: 150, C: 0.9, N: 20, tau: 4.0, dir: 1.0, tv: 1.0 },
    // Mode production (definitive) — le front l'envoie toujours ; materialsRev est
    // inerte (table unique) mais accepte au contrat.
    load: {
      p: 0.662,
      a: 0.125,
      d: 0.375,
      r: 'auto',
      sh: 'auto',
      ks: 'auto',
      materialsRev: 'definitive',
      ifaceAuto: true,
      gntAuto: true,
    },
  });

  it('scelle engineId=chaussee-burmister et engineVersion=2.0.0', () => {
    expect(env.meta.engineId).toBe('chaussee-burmister');
    expect(env.meta.engineVersion).toBe('2.0.0');
  });

  it('engineSourceHash == sha256(reference definitive) == 42bb (registre <-> fichier <-> meta)', () => {
    const sha = createHash('sha256').update(readFileSync(DEFINITIVE_HTML)).digest('hex');
    expect(sha, 'le fichier de reference doit valoir 42bb').toBe(DEFINITIVE_SHA);
    expect(
      env.meta.engineSourceHash,
      'la meta doit sceller la source qui reproduit la production (definitive)',
    ).toBe(sha);
  });
});
