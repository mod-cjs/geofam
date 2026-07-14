/**
 * DETAILS CLIENT — presence des 11 champs whitelistes + FAIL-CLOSED sur erreur
 * (decision titulaire 13/07, alignement outil client).
 *
 * Contrat de sortie consomme TEL QUEL par le front :
 *   details.ktheta, details.sn, details.sh_cm, details.delta, details.kr,
 *   details.kc, details.ks, details.ub, details.adm_r50, details.sigmaZ_psc_kpa,
 *   details.sigmaR_psc_kpa.
 *
 * 1. Un calcul NOMINAL bitumineux expose les 11 champs, valeurs finies.
 * 2. Un chemin d'ERREUR (materiau hors-domaine) N'EXPOSE PAS `details` (fail-closed).
 * 3. Une famille GRANULAIRE (aucune couche dimensionnante, e6=Infinity) expose les
 *    coefficients (defauts) mais `adm_r50 == null` (N/A, comme l'outil client).
 */
import { describe, expect, it } from 'vitest';

import { BurmisterOutputSchema } from './contract.js';
import { BURMISTER_FIXTURES } from './test-fixtures.js';

import { runBurmister } from './index.js';

/** Les 11 champs NOMMES exposes par decision titulaire du 13/07. */
const CHAMPS_CLIENT = [
  'ktheta',
  'sn',
  'sh_cm',
  'delta',
  'kr',
  'kc',
  'ks',
  'ub',
  'adm_r50',
  'sigmaZ_psc_kpa',
  'sigmaR_psc_kpa',
] as const;

function fixture(id: string) {
  const fx = BURMISTER_FIXTURES.find((f) => f.id === id);
  if (!fx) throw new Error(`fixture ${id} introuvable`);
  return fx;
}

describe('burmister — details client (11 champs, decision titulaire 13/07)', () => {
  it('NOMINAL bitumineux : les 11 champs sont exposes et FINIS', () => {
    const env = runBurmister(fixture('bitumineuse-epaisse-defaut').input);
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    const d = (env.output as { details?: Record<string, unknown> }).details;
    expect(d, 'details present').toBeTruthy();
    if (!d) return;
    for (const k of CHAMPS_CLIENT) {
      expect(Object.prototype.hasOwnProperty.call(d, k), `champ ${k} present`).toBe(true);
      expect(
        typeof d[k] === 'number' && Number.isFinite(d[k] as number),
        `champ ${k} fini`,
      ).toBe(true);
    }
    // La sortie re-parse strict (le schema whiteliste desormais ces cles).
    expect(() => BurmisterOutputSchema.parse(env.output)).not.toThrow();
  });

  it('ERREUR (trafic nul, fail-closed) : `details` ABSENT — les 11 champs ne fuient pas', () => {
    // T=0 -> NE=0 -> admissibles Infinity : le moteur REFUSE (chemin erreur, cf.
    // shapeOutput). Aucun `details` n'est projete : les grandeurs de l'outil client
    // ne sortent que sur un calcul VALIDE (fail-closed).
    const base = fixture('bitumineuse-epaisse-defaut').input;
    const env = runBurmister({ ...base, traffic: { ...base.traffic, T: 0 } });
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.output.erreur, 'message d erreur present').toBeTruthy();
    expect(
      (env.output as { details?: unknown }).details,
      'aucun details sur le chemin d erreur',
    ).toBeUndefined();
  });

  it('GRANULAIRE (aucune couche dimensionnante) : coefficients exposes mais adm_r50 = null (N/A)', () => {
    const env = runBurmister(fixture('granulaire-pur').input);
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    const d = (env.output as { details?: Record<string, unknown> }).details;
    expect(d, 'details present').toBeTruthy();
    if (!d) return;
    // Les coefficients (defauts moteur) restent finis...
    for (const k of ['ktheta', 'sn', 'sh_cm', 'delta', 'kr', 'kc', 'ks', 'ub'] as const) {
      expect(Number.isFinite(d[k] as number), `coefficient ${k} fini`).toBe(true);
    }
    // ...mais l'admissible a 50 % est N/A (e6 = Infinity, aucun materiau dimensionnant).
    expect(d.adm_r50, 'adm_r50 null quand aucune couche dimensionnante').toBeNull();
    // σ PSC restent finis (le sommet PSC est toujours calcule).
    expect(Number.isFinite(d.sigmaZ_psc_kpa as number)).toBe(true);
    expect(Number.isFinite(d.sigmaR_psc_kpa as number)).toBe(true);
  });
});
