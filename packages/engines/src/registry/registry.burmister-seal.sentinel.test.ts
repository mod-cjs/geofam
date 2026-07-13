/**
 * SENTINELLE (passe 0) — LE SCEAU BURMISTER DOIT POINTER LA REFERENCE DEFINITIVE.
 *
 * Contexte (traçabilité du scellement, décisions ACTEES par le titulaire) :
 *   - le FRONT force en production le mode DEFINITIVE (`materialsRev:'definitive'`,
 *     `ifaceAuto:true`) : le moteur ne calcule QUE selon la reference definitive
 *     (retrait du mode historique — décision 1-fort actée) ;
 *   - la reference definitive versionnee dans le depot est
 *     `packages/engines/reference/roadsens_burmister_definitive.html`
 *     (sha256 42bb46aa…), c'est ELLE qui reproduit les calculs de production ;
 *   - or le REGISTRE (`registry.ts`, entree `chaussee-burmister`) scelle encore le
 *     HTML « moderne » (sha256 259a58a8…). La meta serveur (`engineSourceHash`)
 *     estampille donc 259a alors que la production calcule selon 42bb :
 *     MENSONGE DE TRACABILITE. Un PV recalculable doit pointer la source qui l'a
 *     REELLEMENT produit.
 *
 * Ce que prouve cette sentinelle : le sha256 recalcule de la reference DEFINITIVE
 * DOIT egaler `entry.sha256` du registre. C'EST VRAI depuis la BASCULE (passe 2,
 * ADR 0013) : le registre scelle desormais 42bb (definitive). L'invariant est donc
 * PERMANENT — le sceau pointe toujours la source qui reproduit les calculs de
 * production. Toute derive (registre modifie sans re-figer le fichier, ou fichier
 * altere) fait MORDRE ce test.
 *
 * HISTORIQUE : avant la bascule, ce test etait marque `it.fails` (echec ATTENDU
 * tant que le registre scellait encore le moderne 259a ≠ 42bb) ; `.fails` a ete
 * RETIRE a la bascule (l'assertion reussit) — l'invariant est maintenant un ancrage
 * PERMANENT registre <-> fichier, redondant et complementaire du gate
 * `registry.hash.test.ts` (coherence hash intra-depot, CI incluse).
 *
 * ANCRAGE (anti faux-vert) : un test NORMAL ci-dessous prouve d'abord que la
 * reference definitive est PRESENTE et vaut bien 42bb — sans quoi une egalite
 * accidentelle pourrait masquer un probleme.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { findEngine } from './registry.js';

const here = dirname(fileURLToPath(import.meta.url));
// packages/engines/src/registry -> packages/engines/reference (2 niveaux up).
const DEFINITIVE_HTML = resolve(
  here,
  '..',
  '..',
  'reference',
  'roadsens_burmister_definitive.html',
);
/** SHA-256 GELE de la reference definitive (versionnee dans le depot). */
const DEFINITIVE_SHA = '42bb46aa5da085cd5605664ce125e361392c77fbc717f9abc4b8d5910f1546f2';

function sha256File(absPath: string): string {
  return createHash('sha256').update(readFileSync(absPath)).digest('hex');
}

describe('Sceau burmister ↔ reference definitive (passe 0)', () => {
  it('ANCRAGE : la reference definitive est presente et vaut bien 42bb (versionnee)', () => {
    expect(
      existsSync(DEFINITIVE_HTML),
      `reference definitive ABSENTE (${DEFINITIVE_HTML}) — versionnee dans packages/engines/reference/`,
    ).toBe(true);
    expect(
      sha256File(DEFINITIVE_HTML),
      'le contenu de la reference definitive a change : la sentinelle ci-dessous ne serait plus fiable',
    ).toBe(DEFINITIVE_SHA);
  });

  it('le registre expose bien l entree chaussee-burmister avec un sha256 valide', () => {
    const entry = findEngine('chaussee-burmister');
    expect(entry, 'entree "chaussee-burmister" introuvable au registre').toBeDefined();
    expect(entry?.sha256, 'sha256 du sceau burmister').toMatch(/^[0-9a-f]{64}$/);
  });

  // INVARIANT PERMANENT (ex-sentinelle it.fails, `.fails` retire a la bascule passe 2) :
  // le sceau du registre == le sha de la reference definitive. Toute derive mord.
  it('le sceau du registre egale le sha de la reference definitive (42bb) — ancrage registre <-> fichier', () => {
    const entry = findEngine('chaussee-burmister');
    expect(entry).toBeDefined();
    const shaDefinitive = sha256File(DEFINITIVE_HTML);
    expect(
      shaDefinitive,
      'le sceau doit pointer la reference qui reproduit les calculs de production (definitive, 42bb) — ' +
        'sinon la meta engineSourceHash MENT sur la source du calcul',
    ).toBe(entry?.sha256);
  });
});
