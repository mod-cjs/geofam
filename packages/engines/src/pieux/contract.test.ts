/**
 * CONTRAT pieux (#56) — la SORTIE est une whitelist stricte : aucun intermediaire de
 * calcul ne fuit (DoD §8, criteres 3 & 7).
 *
 * On verifie que `runPieux` ne renvoie QUE des champs declares, et qu'aucun
 * intermediaire connu du moteur (terme de pointe qb, pression/resistance equivalente
 * ple/qce, facteurs de portance kp/kc/kfac/kmax, hauteur d'encastrement Def/debR,
 * detail de frottement par couche `fric`, chaine `qbDetail`, courbe de tassement
 * `settle.pts`, facteurs de correlation xi3/xi4, facteurs partiels par combinaison
 * Rbf/Rsf/comb...) n'apparait NULLE PART dans la sortie serialisee, a tout niveau.
 */
import { describe, expect, it } from 'vitest';

import { PieuxOutputSchema } from './contract.js';
import { computePieux } from './engine.js';
import { PIEUX_FIXTURES } from './test-fixtures.js';

import { runPieux } from './index.js';

/**
 * Cles d'INTERMEDIAIRES qui ne doivent JAMAIS apparaitre dans la sortie client.
 * Couvre : terme de pointe, resistances/pressions equivalentes, facteurs de portance,
 * hauteur d'encastrement, detail de frottement, courbe de tassement, facteurs de
 * correlation, facteurs partiels intermediaires, et les champs internes de `R`.
 */
const FUITES_INTERDITES = [
  // Terme de pointe et pressions/resistances equivalentes (methode F.4.2 / G.4.2).
  'qb',
  'Rb',
  'ple',
  'qce',
  // Facteurs de portance (Tableaux F.4.2.1 / G.4.2.1) + hauteur d'encastrement.
  'kfac',
  'kmax',
  'Def',
  'debR',
  'cls',
  // Detail de frottement par couche (revele courbes F.5.2.2 / α annexes F/G).
  'fric',
  'qs',
  'qsm',
  'dRs',
  'deg',
  'RsKsum',
  // Chaines d'affichage qui interpolent des intermediaires.
  'qbDetail',
  'qceDetail',
  // Courbe de mobilisation du tassement + ses coefficients.
  'settle',
  'pts',
  'ktau',
  'kq',
  'Fmax',
  // Facteurs de correlation / modele / partiels par combinaison.
  'xi3',
  'xi4',
  'grd',
  'Rbf',
  'Rsf',
  'comb',
  'crit',
  // Profil de couches brut (cotes ztop/zbot, parametres de sol).
  'layers',
  'baseLayer',
  'ztop',
  'zbot',
  'pl',
  'em',
  'pile',
  // Decomposition de resistance / geometrie intermediaire.
  'RbD',
  'RsD',
  'hInLayer',
  'Bsurf',
  'Ab',
  'perim',
  'CeF',
  'floating',
];

/** Collecte toutes les cles d'objet presentes dans une structure (recursif). */
function collectKeys(value: unknown, acc: Set<string>): void {
  if (Array.isArray(value)) {
    value.forEach((v) => collectKeys(v, acc));
  } else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      acc.add(k);
      collectKeys(v, acc);
    }
  }
}

describe('pieux — contrat de sortie (whitelist stricte, anti-fuite)', () => {
  for (const fx of PIEUX_FIXTURES) {
    it(`[${fx.id}] sortie conforme au schema declare (re-parse strict)`, () => {
      const env = runPieux(fx.input);
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      // Re-parse a travers le schema : si un champ non whiteliste avait survecu,
      // .strict() le rejetterait.
      const reparsed = PieuxOutputSchema.parse(env.output);
      expect(reparsed).toEqual(env.output);
    });

    it(`[${fx.id}] aucun intermediaire de calcul ne fuit dans la sortie`, () => {
      const env = runPieux(fx.input);
      if (!env.ok) return;
      const keys = new Set<string>();
      collectKeys(env.output, keys);
      const fuites = FUITES_INTERDITES.filter((k) => keys.has(k));
      expect(fuites, `cles d intermediaire trouvees dans la sortie`).toEqual([]);
    });
  }

  it('la meta porte l identite, la version et le hash source (tracabilite PV)', () => {
    const fx = PIEUX_FIXTURES[0];
    expect(fx).toBeDefined();
    if (!fx) return;
    const env = runPieux(fx.input);
    expect(env.meta.engineId).toBe('fondation-profonde-pieux');
    expect(env.meta.engineVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(env.meta.engineSourceHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('une cle non whitelistee au sommet de la sortie est REJETEE (.strict(), fail-closed)', () => {
    // Anti faux-vert : la sortie est en .strict() -> une cle inconnue au niveau racine
    // n est pas silencieusement stripee, elle FAIT ECHOUER le parse.
    const pollue = {
      erreur: null,
      warnings: [],
      B: 0.6,
      D: 15,
      categorie: 1,
      methode: 'pmt',
      sens: 'comp',
      RbK: 1000,
      RsK: 800,
      RcK: 1800,
      RcD: 1400,
      RcrK: 1100,
      RcrCar: 1200,
      RcrQp: 1000,
      FduELU: 1605,
      FdCar: 1150,
      FdQp: 905,
      verifications: [],
      allOk: true,
      tauxGouvernant: 0.9,
      tassementELS: 8.2,
      qb: 4200 /* intermediaire interdit */,
    };
    expect(() => PieuxOutputSchema.parse(pollue)).toThrow(/[Uu]nrecognized/);
  });

  it('le dimensionnement expose Rc;k / Rc;d / fluage (resultats d ingenierie du PV)', () => {
    // Sanity positive : un cas nominal produit bien les grandeurs FINALES exposees,
    // et la sortie ne contient PAS le detail de frottement ni les facteurs de portance.
    const fx = PIEUX_FIXTURES.find((f) => f.id === 'pmt-fore-da2-comp');
    expect(fx).toBeDefined();
    if (!fx) return;
    const env = runPieux(fx.input);
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(Number.isFinite(env.output.RcK)).toBe(true);
    expect(Number.isFinite(env.output.RcD)).toBe(true);
    expect(Number.isFinite(env.output.RcrK)).toBe(true);
    expect(env.output.verifications.length).toBeGreaterThan(0);
    // Le detail de frottement et les facteurs de portance ne doivent jamais sortir.
    expect(JSON.stringify(env.output)).not.toMatch(
      /"(fric|qb|ple|qce|kfac|kmax|Def|qbDetail|settle|xi3|comb)"\s*:/,
    );
  });

  it('chaque verification expose le verdict (taux, ok) sans la formule de combinaison', () => {
    const fx = PIEUX_FIXTURES.find((f) => f.id === 'pmt-fore-da1');
    expect(fx).toBeDefined();
    if (!fx) return;
    const env = runPieux(fx.input);
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    for (const v of env.output.verifications) {
      expect(typeof v.nom).toBe('string');
      expect(Number.isFinite(v.taux)).toBe(true);
      expect(typeof v.ok).toBe('boolean');
      // Pas de fuite de la formule ('comb') ni des facteurs partiels (Rbf/Rsf).
      expect(Object.keys(v).sort()).toEqual(['Fd', 'Rd', 'nom', 'ok', 'taux']);
    }
  });

  // --- MINEUR-3 (#48) : SOURCE DE VERITE UNIQUE pour le verdict --------------------
  // La projection DERIVE allOk/tauxGouvernant des per-check (Fd/Rd, Fd<=Rd). On prouve
  // que ces valeurs derivees EGALENT le verdict propre du moteur (R.allOk / R.govern,
  // formule `max(Fd/Rd)` / `every(Fd<=Rd)`), y compris le cas Rd=0 (Infinity cote
  // moteur -> sentinel fini cote sortie). Pas de double verite non testee.
  it('allOk / tauxGouvernant projetes == verdict du moteur (R.allOk / R.govern) sur TOUT le jeu', () => {
    for (const fx of PIEUX_FIXTURES) {
      const R = computePieux(fx.input) as Record<string, unknown>;
      const env = runPieux(fx.input);
      expect(env.ok).toBe(true);
      if (!env.ok) continue;
      if (typeof R.err === 'string') {
        // Cas garde du moteur : pas de checks ; la sortie est le verdict d'erreur.
        expect(env.output.allOk).toBe(false);
        continue;
      }
      // allOk : egalite stricte avec le verdict moteur.
      expect(env.output.allOk, `allOk diverge sur ${fx.id}`).toBe(R.allOk === true);
      // tauxGouvernant : egal a R.govern si fini, sinon converti au MEME sentinel que
      // la projection (1e9). On reproduit la conversion pour comparer a perimetre egal.
      const govern = typeof R.govern === 'number' ? R.govern : 0;
      const expectedTaux = Number.isFinite(govern) ? govern : 1e9;
      expect(env.output.tauxGouvernant, `taux diverge sur ${fx.id}`).toBeCloseTo(
        expectedTaux,
        9,
      );
      // Coherence interne : tauxGouvernant == max des taux par check.
      const maxCheck = env.output.verifications.reduce((a, v) => Math.max(a, v.taux), 0);
      if (env.output.verifications.length > 0) {
        expect(env.output.tauxGouvernant).toBeCloseTo(maxCheck, 9);
      }
      // allOk == every(check.ok).
      const everyOk = env.output.verifications.every((v) => v.ok);
      if (env.output.verifications.length > 0) {
        expect(env.output.allOk).toBe(everyOk);
      }
    }
  });
});
