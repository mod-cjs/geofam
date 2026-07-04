/**
 * CONTRAT burmister (#56) — la SORTIE est une whitelist stricte : aucun
 * intermediaire de calcul ne fuit (DoD §8, critere 3 & 7).
 *
 * On verifie que `runBurmister` ne renvoie QUE des champs declares, et qu'aucun
 * symbole/intermediaire connu du moteur (contraintes brutes sz/sr/sth, coefficients
 * de fatigue kr/ks/kc/sh/e6, deformations intermediaires et0/etM, etat brut _D :
 * bz/ezL/rigL/lys...) n'apparait NULLE PART dans la sortie serialisee, a tout
 * niveau d'imbrication.
 */
import { describe, expect, it } from 'vitest';

import { BurmisterInputSchema, BurmisterOutputSchema } from './contract.js';
import { BURMISTER_FIXTURES } from './test-fixtures.js';

import { runBurmister } from './index.js';

/**
 * Cles d'INTERMEDIAIRES qui ne doivent JAMAIS apparaitre dans la sortie client.
 * Couvre : tenseur de contraintes brut, coefficients de calage de fatigue,
 * deformations intermediaires par position, et les champs internes de l'objet `_D`.
 */
const FUITES_INTERDITES = [
  // Tenseur de contraintes brut (propagateur 4×4)
  'sz',
  'sr',
  'sth',
  'srT',
  'sthT',
  's0',
  'sd2',
  'bz',
  // Coefficients de calage des lois de fatigue
  'kr',
  'ks',
  'kc',
  'sh',
  'e6',
  'ub',
  'ukc',
  'usn',
  'ukth',
  'sig',
  // Deformations intermediaires par position (distinctes des valeurs FINALES)
  'et0',
  'etM',
  'ez0',
  'ezM',
  // Etat brut interne de _D
  'ezL',
  'rigL',
  'lys',
  'pfs',
  'cps',
  'trs',
  'be',
  'etA',
  'ezA',
  'et2',
  'st2',
  'rEff',
  'Eref',
  'nuRef',
  'E1',
  'nu1',
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

describe('burmister — contrat de sortie (whitelist stricte, anti-fuite)', () => {
  for (const fx of BURMISTER_FIXTURES) {
    it(`[${fx.id}] sortie conforme au schema declare (re-parse strict)`, () => {
      const env = runBurmister(fx.input);
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      // Re-parse a travers le schema : si un champ non whiteliste avait survecu,
      // .strict() le rejetterait (les objets de sortie sont en .strict()).
      const reparsed = BurmisterOutputSchema.parse(env.output);
      expect(reparsed).toEqual(env.output);
    });

    it(`[${fx.id}] aucun intermediaire de calcul ne fuit dans la sortie`, () => {
      const env = runBurmister(fx.input);
      if (!env.ok) return;
      const keys = new Set<string>();
      collectKeys(env.output, keys);
      const fuites = FUITES_INTERDITES.filter((k) => keys.has(k));
      expect(fuites, `cles d intermediaire trouvees dans la sortie`).toEqual([]);
    });
  }

  it('la meta porte l identite, la version et le hash source (tracabilite PV)', () => {
    const fx = BURMISTER_FIXTURES[0];
    expect(fx).toBeDefined();
    if (!fx) return;
    const env = runBurmister(fx.input);
    expect(env.meta.engineId).toBe('chaussee-burmister');
    expect(env.meta.engineVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(env.meta.engineSourceHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('une cle non whitelistee au sommet de la sortie est REJETEE (.strict(), fail-closed)', () => {
    // Anti faux-vert : la sortie est en .strict() -> une cle inconnue au niveau
    // racine n est pas silencieusement stripee, elle FAIT ECHOUER le parse.
    const pollue = {
      erreur: null,
      warnings: [],
      conforme: true,
      NE: 1e6,
      famille: 'souple',
      epaisseurLiee: 0.16,
      epaisseurTotale: 0.41,
      ornierage: { valeur: 300, admissible: 500, ok: true },
      __intermediaire_secret__: 42, // cle non declaree
    };
    expect(() => BurmisterOutputSchema.parse(pollue)).toThrow(/[Uu]nrecognized/);
  });

  it('une contrainte brute (sz/sr) DANS le critere fatigue est REJETEE (.strict() imbrique)', () => {
    // Defense en profondeur : meme rejet a un niveau imbrique (objet fatigue).
    const pollue = {
      erreur: null,
      warnings: [],
      conforme: true,
      NE: 1e6,
      famille: 'souple',
      epaisseurLiee: 0.16,
      epaisseurTotale: 0.41,
      ornierage: { valeur: 300, admissible: 500, ok: true },
      fatigue: {
        rigide: false,
        valeur: 200,
        admissible: 250,
        ok: true,
        requis: true,
        sz: 0.12 /* brut interdit */,
      },
    };
    expect(() => BurmisterOutputSchema.parse(pollue)).toThrow(/[Uu]nrecognized/);
  });

  it('details expose les intermediaires PUBLICS mais AUCUN coefficient de calage (rescope §8)', () => {
    const fx = BURMISTER_FIXTURES[0];
    if (!fx) return;
    const env = runBurmister(fx.input);
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    const d = (env.output as { details?: Record<string, unknown> }).details;
    expect(d, 'details present').toBeTruthy();
    if (!d) return;
    // Intermediaires PUBLICS presents (methode transparente)
    for (const k of ['E1_pond', 'nu1_pond', 'epsilonZ', 'epsilonZ_adm', 'risque_pct']) {
      expect(Object.prototype.hasOwnProperty.call(d, k), `public ${k} present`).toBe(true);
    }
    // AUCUN coefficient de CALAGE ne doit apparaitre dans details (fail-closed)
    const dk = new Set<string>();
    collectKeys(d, dk);
    const CALAGE = ['e6', 'b', 'kc', 'kr', 'ks', 'sh', 'ub', 'ukc', 'usn', 'ukth', 'sig', 'kmix', 'Kmix'];
    expect(CALAGE.filter((k) => dk.has(k)), 'aucun coefficient de calage dans details').toEqual([]);
  });

  it('CALIBRATION VERROUILLEE : une entree forgee portant `materials` (calibration substituee) est REJETEE (400, fail-closed)', () => {
    // INTEGRITE PV : le contrat d'entree ne doit JAMAIS accepter une calibration de
    // fatigue fournie par le client — sinon une requete forgee pourrait la faire
    // sceller dans le PV sous l'identite methode STARFIRE. Le schema etant
    // `.strict()`, la cle `materials` est INCONNUE -> le parse ECHOUE (aucune
    // calibration client n'atteint le calcul ni le PV).
    const fxBase = BURMISTER_FIXTURES.find((f) => f.id === 'bitumineuse-epaisse-defaut');
    expect(fxBase).toBeDefined();
    if (!fxBase) return;

    // Preuve 1 : l'entree LEGITIME (sans materials) reste ACCEPTEE.
    expect(() => BurmisterInputSchema.parse(fxBase.input)).not.toThrow();

    // Preuve 2 : la MEME entree + un referentiel de fatigue substitue (GB3 « raidi »
    // : e6=200, E10=20000) est REJETEE au niveau schema...
    const forge = {
      ...fxBase.input,
      materials: {
        GB3: {
          n: 'GB3 raidi',
          E: 2588,
          E10: 20000,
          nu: 0.45,
          bit: 1,
          e6: 200,
          b: 5,
          kc: 1.3,
          sn: 0.3,
        },
      },
    };
    expect(() => BurmisterInputSchema.parse(forge)).toThrow(/[Uu]nrecognized/);

    // Preuve 3 : ...et le point d'entree serveur `runBurmister` la rejette AUSSI
    // (le calcul/PV n'est jamais atteint).
    expect(() => runBurmister(forge)).toThrow(/[Uu]nrecognized/);
  });

  it('CALIBRATION VERROUILLEE : meme un coefficient de calage isole en entree est REJETE (aucun contournement de champ)', () => {
    // Defense en profondeur : on ne peut pas non plus glisser un coefficient de
    // calage a un autre niveau. Toute cle inconnue (`kc`, `e6`...) au sommet de
    // l'entree fait echouer le parse strict.
    const fxBase = BURMISTER_FIXTURES.find((f) => f.id === 'bitumineuse-epaisse-defaut');
    expect(fxBase).toBeDefined();
    if (!fxBase) return;
    expect(() => BurmisterInputSchema.parse({ ...fxBase.input, kc: 0.5 })).toThrow(
      /[Uu]nrecognized/,
    );
    expect(() => BurmisterInputSchema.parse({ ...fxBase.input, e6: 200 })).toThrow(
      /[Uu]nrecognized/,
    );
  });
});
