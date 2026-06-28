/**
 * CONTRAT terzaghi (#56) — la SORTIE est une whitelist stricte : aucun
 * intermediaire de calcul ne fuit (DoD §8, critere 3 & 7).
 *
 * On verifie que `runTerzaghi` ne renvoie QUE des champs declares, et qu'aucun
 * symbole/intermediaire connu du moteur (kp, ple, De, Nq, A', kf, kc, bv...)
 * n'apparait NULLE PART dans la sortie serialisee, a tout niveau d'imbrication.
 */
import { describe, expect, it } from 'vitest';

import { TerzaghiOutputSchema } from './contract.js';
import { TERZAGHI_FIXTURES } from './test-fixtures.js';

import { runTerzaghi } from './index.js';

/** Cles d'INTERMEDIAIRES qui ne doivent JAMAIS apparaitre dans la sortie client. */
const FUITES_INTERDITES = [
  'kp',
  'kf',
  'kc',
  'kpx',
  'ple',
  'De',
  'DeB',
  'qce',
  'Nq',
  'Nc',
  'Ng',
  'bv',
  'bB',
  'bL',
  'Ap', // surface comprimee (intermediaire Meyerhof)
  'cphi',
  'geom',
  'rows',
  'ctx',
  'qnet',
  'idel',
  'ibet',
  'idb',
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

describe('terzaghi — contrat de sortie (whitelist stricte, anti-fuite)', () => {
  for (const fx of TERZAGHI_FIXTURES) {
    it(`[${fx.id}] sortie conforme au schema declare (re-parse strict)`, () => {
      const env = runTerzaghi(fx.input);
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      // Re-parse a travers le schema : si un champ non whiteliste avait survecu,
      // .strict() le rejetterait (les objets de sortie sont en .strict()).
      const reparsed = TerzaghiOutputSchema.parse(env.output);
      expect(reparsed).toEqual(env.output);
    });

    it(`[${fx.id}] aucun intermediaire de calcul ne fuit dans la sortie`, () => {
      const env = runTerzaghi(fx.input);
      if (!env.ok) return;
      const keys = new Set<string>();
      collectKeys(env.output, keys);
      const fuites = FUITES_INTERDITES.filter((k) => keys.has(k));
      expect(fuites, `cles d intermediaire trouvees dans la sortie`).toEqual([]);
    });
  }

  it('la meta porte l identite, la version et le hash source (tracabilite PV)', () => {
    const fx = TERZAGHI_FIXTURES[0];
    expect(fx).toBeDefined();
    if (!fx) return;
    const env = runTerzaghi(fx.input);
    expect(env.meta.engineId).toBe('fondation-superficielle');
    expect(env.meta.engineVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(env.meta.engineSourceHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('une cle non whitelistee au sommet de la sortie est REJETEE (.strict(), fail-closed)', () => {
    // Anti faux-vert : la sortie est en .strict() -> une cle inconnue au niveau
    // racine n est pas silencieusement stripee, elle FAIT ECHOUER le parse. C est
    // plus fort qu un strip : on prefere casser que laisser passer (DoD §8).
    const pollue = {
      erreur: null,
      warnings: [],
      cas: [],
      __intermediaire_secret__: 42, // cle non declaree
    };
    expect(() => TerzaghiOutputSchema.parse(pollue)).toThrow(/[Uu]nrecognized/);
  });

  it('une cle non whitelistee DANS un cas de charge est REJETEE (.strict() imbrique)', () => {
    // Defense en profondeur : meme rejet a un niveau imbrique (objet de cas).
    const pollue = {
      erreur: null,
      warnings: [],
      cas: [
        { idx: 0, etat: 'ELS_QP', invalide: false, kp: 0.9 /* intermediaire interdit */ },
      ],
    };
    expect(() => TerzaghiOutputSchema.parse(pollue)).toThrow(/[Uu]nrecognized/);
  });
});
