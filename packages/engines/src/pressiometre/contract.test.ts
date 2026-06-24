/**
 * CONTRAT pressiometre (#56) — la SORTIE est une whitelist stricte : aucun
 * intermediaire de calcul ne fuit (DoD §8, criteres 3 & 7).
 *
 * On verifie que `runPressiometre` ne renvoie QUE des champs declares, et qu'aucun
 * intermediaire connu du moteur (courbe corrigee C, decomposition de contrainte
 * sigH0/sigV0/u0, pressions/volumes de calage bruts pE/p0/Pf/VE/V0c/Vf, analyse de
 * pente mE/beta/iE, coefficients A/B de la courbe inverse `ext`, fluage...)
 * n'apparait NULLE PART dans la sortie serialisee, a tout niveau d'imbrication.
 */
import { describe, expect, it, vi } from 'vitest';

import { PressiometreOutputSchema } from './contract.js';
import { PRESSIOMETRE_FIXTURES } from './test-fixtures.js';

import { runPressiometre } from './index.js';

/**
 * Cles d'INTERMEDIAIRES qui ne doivent JAMAIS apparaitre dans la sortie client.
 * Couvre : courbe corrigee, decomposition de contrainte au repos, pressions/volumes
 * de calage, analyse de pente, coefficients de regression, et les champs internes
 * de l'objet `_res`.
 */
const FUITES_INTERDITES = [
  // Courbe corrigee + fluage + extrapolation (methode).
  // NB (MINEUR-2) : ce test ne verifie QUE l'absence de ces CLES dans la sortie
  // (collectKeys parcourt les cles d'objet). Les coefficients de regression 'A'/'B'
  // y sont listes au titre de CLE — leur valeur en TEXTE LIBRE n'est PAS couverte
  // par la redaction (on ne redacte pas `A=`/`B=` : faux positifs sur les libelles
  // « cat. A »/« cat. B »). En pratique 'A'/'B' ne sont jamais des cles de la sortie
  // (la whitelist .strict() les rejetterait) ; ils ne transitent pas non plus en
  // texte (le moteur ne pose aucun warn). La whitelist de cles est donc la barriere.
  'C',
  'fluage',
  'ext',
  'recip',
  'PLMasym',
  'A',
  'B',
  'gen',
  // Decomposition de la contrainte au repos
  'sigH0',
  'sigV0',
  'sigVp',
  'u0',
  'z',
  'gamma',
  // Pressions/volumes de calage bruts
  'pE',
  'p0',
  'Pf',
  'VE',
  'V0c',
  'Vf',
  'VsP2V1',
  'pL_direct',
  // Analyse de pente de la plage pseudo-elastique
  'mE',
  'beta',
  'iE',
  'auto_p0I',
  'auto_pfI',
  'pfI',
  'plmI',
  // Indices/parametres internes
  'aUsed',
  'aForced',
  'pS',
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

describe('pressiometre — contrat de sortie (whitelist stricte, anti-fuite)', () => {
  // console.warn legitime du moteur (a force / dV-dP) : on le fait taire.
  vi.spyOn(console, 'warn').mockImplementation(() => {});

  for (const fx of PRESSIOMETRE_FIXTURES) {
    it(`[${fx.id}] sortie conforme au schema declare (re-parse strict)`, () => {
      const env = runPressiometre(fx.input);
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      // Re-parse a travers le schema : si un champ non whiteliste avait survecu,
      // .strict() le rejetterait.
      const reparsed = PressiometreOutputSchema.parse(env.output);
      expect(reparsed).toEqual(env.output);
    });

    it(`[${fx.id}] aucun intermediaire de calcul ne fuit dans la sortie`, () => {
      const env = runPressiometre(fx.input);
      if (!env.ok) return;
      const keys = new Set<string>();
      collectKeys(env.output, keys);
      const fuites = FUITES_INTERDITES.filter((k) => keys.has(k));
      expect(fuites, `cles d intermediaire trouvees dans la sortie`).toEqual([]);
    });
  }

  it('la meta porte l identite, la version et le hash source (tracabilite PV)', () => {
    const fx = PRESSIOMETRE_FIXTURES[0];
    expect(fx).toBeDefined();
    if (!fx) return;
    const env = runPressiometre(fx.input);
    expect(env.meta.engineId).toBe('pressiometre-menard');
    expect(env.meta.engineVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(env.meta.engineSourceHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('une cle non whitelistee au sommet de la sortie est REJETEE (.strict(), fail-closed)', () => {
    // Anti faux-vert : la sortie est en .strict() -> une cle inconnue au niveau
    // racine n est pas silencieusement stripee, elle FAIT ECHOUER le parse.
    const pollue = {
      erreur: null,
      warnings: [],
      pL: 12,
      pLNette: 11,
      pfNette: 8,
      EM: 9.5,
      ratioEMpL: 7.9,
      alpha: 0.5,
      pLDirect: true,
      categorie: 'C',
      categorieLibelle: 'Sol ferme (cat. C)',
      consolidation: 'Sol normalement consolidé',
      sigH0: 0.42 /* intermediaire interdit */,
    };
    expect(() => PressiometreOutputSchema.parse(pollue)).toThrow(/[Uu]nrecognized/);
  });

  it('le depouillement expose pL/EM/alpha (resultats d ingenierie du PV)', () => {
    // Sanity positive : un cas nominal produit bien les grandeurs FINALES exposees,
    // et la sortie ne contient PAS la courbe corrigee C ni la decomposition sigH0.
    const fx = PRESSIOMETRE_FIXTURES.find((f) => f.id === 'demo-4m-seuils-manuels');
    expect(fx).toBeDefined();
    if (!fx) return;
    const env = runPressiometre(fx.input);
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(Number.isFinite(env.output.pL)).toBe(true);
    expect(Number.isFinite(env.output.EM)).toBe(true);
    expect(Number.isFinite(env.output.alpha)).toBe(true);
    expect(env.output.categorie).toMatch(/^[A-E]$/);
    // La courbe corrigee ne doit jamais sortir.
    expect(JSON.stringify(env.output)).not.toMatch(/"(C|ext|sigH0|fluage)"\s*:/);
  });
});
