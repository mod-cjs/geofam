/**
 * CONTRAT radier (#56) — la SORTIE est une whitelist stricte de DIAGNOSTICS : aucun
 * champ NODAL ni aucune TOPOLOGIE DE MAILLAGE ne fuit (DoD §8, criteres 3 & 7).
 *
 * On verifie que `runRadier` ne renvoie QUE des champs declares, et qu'aucun champ
 * de la solution EF (deplacements/reactions/moments par nœud, geometrie de maillage,
 * coefficient de reaction local) n'apparait NULLE PART dans la sortie serialisee, a
 * tout niveau d'imbrication.
 */
import { describe, expect, it } from 'vitest';

import { RadierOutputSchema } from './contract.js';
import { RADIER_FIXTURES } from './test-fixtures.js';

import { runRadier } from './index.js';

/**
 * Cles d'INTERMEDIAIRES EF qui ne doivent JAMAIS apparaitre dans la sortie client.
 * Couvre : champs nodaux, topologie de maillage, coefficient de reaction local,
 * sommes/etats internes, ET les localisations *At (coords de nœuds, MAJEUR-1 #54).
 *
 * PORTEE HONNETE (M-2/M-5 du challenge) : ce test verifie l'absence de ces CLES
 * EXACTES dans la sortie projetee (collectKeys parcourt les cles d'objet). Il ne
 * "mesure" PAS l'absence de valeurs nodales arbitraires — la barriere reelle est la
 * whitelist `.strict()` du schema (re-parse) + la construction champ-a-champ de
 * shapeOutput. La barriere PRIMAIRE anti-fuite est le schema, ce test en est la
 * sentinelle de cle. (Le test `*At` dedie ci-dessous verifie en plus qu'aucune cle
 * x/y de localisation ne subsiste hors worstLoadPair.)
 *
 * NB SCIENCE (@science-unsigned) : engine.ts contient un `catch(_){}` MUET autour de
 * l'ajustement du plan moyen par plaque (solveDense 3×3 pour tilt/betaIntra). Il est
 * transcrit VERBATIM du HTML (on ne corrige PAS la science). Si ce solve 3×3 echoue,
 * b=c=0 -> tilt/betaIntra silencieusement 0 : point a VALIDER cote science (expert +
 * cas-tests STARFIRE), pas un defaut de portage.
 */
const FUITES_INTERDITES = [
  // Champs nodaux (la solution EF complete = la methode).
  'w',
  'p',
  'Mx',
  'My',
  'Mxy',
  'kr',
  'tx',
  'ty',
  'slope',
  'active',
  'u',
  // Topologie de maillage.
  'nodeX',
  'nodeY',
  'blocks',
  'loc',
  'NX',
  'NY',
  'N',
  'elements',
  // Sommes / etats internes du solveur.
  'sumReact',
  'sumWink',
  'sumSpr',
  'sumSprPt',
  'totalLoad',
  'iters',
  'Acell',
  'C',
  'K',
  'sext',
  'stateN',
  'winkState',
  // diag interne non whiteliste (loadPairs.edges/perLoad = topologie de charges).
  'edges',
  'perLoad',
  'loadPairs',
  'interPair',
  'interEnds',
  'interDiffEnds',
  // LOCALISATIONS *At — coordonnees de NŒUDS de maillage / centroides derives du
  // maillage = la METHODE EF (MAJEUR-1 #54). JAMAIS exposees.
  'wMaxAt',
  'wMinAt',
  'slopeMaxAt',
  'tiltAt',
  'betaGovAt',
  'betaIntraAt',
  'interAt',
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

describe('radier — contrat de sortie (whitelist stricte, anti-fuite)', () => {
  for (const fx of RADIER_FIXTURES) {
    it(`[${fx.id}] sortie conforme au schema declare (re-parse strict)`, () => {
      const env = runRadier(fx.input);
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      const reparsed = RadierOutputSchema.parse(env.output);
      expect(reparsed).toEqual(env.output);
    });

    it(`[${fx.id}] aucun champ nodal / maillage ne fuit dans la sortie`, () => {
      const env = runRadier(fx.input);
      if (!env.ok) return;
      const keys = new Set<string>();
      collectKeys(env.output, keys);
      const fuites = FUITES_INTERDITES.filter((k) => keys.has(k));
      expect(fuites, `cles d intermediaire EF trouvees dans la sortie`).toEqual([]);
    });
  }

  it('la meta porte l identite, la version et le hash source (tracabilite PV)', () => {
    const fx = RADIER_FIXTURES[0];
    expect(fx).toBeDefined();
    if (!fx) return;
    const env = runRadier(fx.input);
    expect(env.meta.engineId).toBe('radier-plaque');
    expect(env.meta.engineVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(env.meta.engineSourceHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('une cle non whitelistee au sommet de la sortie est REJETEE (.strict(), fail-closed)', () => {
    const valide = {
      erreur: null,
      warnings: [],
      wMax: 0.01,
      wMin: 0.001,
      diff: 0.009,
      slopeMax: 0.002,
      tiltMax: 0.001,
      betaIntra: 0.0015,
      betaInter: 0,
      interDiff: 0,
      betaGov: 0.0015,
      nRafts: 1,
      worstLoadPair: null,
    };
    // Sanity : la forme exacte de la whitelist passe.
    expect(() => RadierOutputSchema.parse(valide)).not.toThrow();
    // Une localisation *At (coord de nœud de maillage) est REJETEE par .strict().
    expect(() => RadierOutputSchema.parse({ ...valide, wMaxAt: { x: 3, y: 3 } })).toThrow(
      /[Uu]nrecognized/,
    );
    // Un champ nodal est REJETE par .strict().
    expect(() => RadierOutputSchema.parse({ ...valide, w: [0.01, 0.009] })).toThrow(
      /[Uu]nrecognized/,
    );
  });

  // --- MAJEUR-1 (#54) : AUCUNE localisation `*At` / coordonnee de nœud ne fuit -------
  // Les `*At` sont des coordonnees de NŒUDS DE MAILLAGE ou des centroides derives du
  // maillage : en faisant varier `mesh`, on reconstruirait le pas = la METHODE EF.
  // Sentinelle : ROUGE si on re-expose une localisation derivee du maillage.
  it('AUCUN champ *At ni cle x/y de localisation derivee du maillage dans la sortie', () => {
    const AT_KEYS = [
      'wMaxAt',
      'wMinAt',
      'slopeMaxAt',
      'tiltAt',
      'betaGovAt',
      'betaIntraAt',
    ];
    for (const fx of RADIER_FIXTURES) {
      const env = runRadier(fx.input);
      if (!env.ok) continue;
      const keys = new Set<string>();
      collectKeys(env.output, keys);
      const fuites = AT_KEYS.filter((k) => keys.has(k));
      expect(fuites, `localisation maillage exposee sur ${fx.id}`).toEqual([]);
      // Les SEULES cles x/y admises sont sous worstLoadPair.p1/p2 (coords de charges
      // saisies). On verifie qu'aucune cle x/y n'apparait HORS de worstLoadPair.
      const sansLoadPair = { ...env.output, worstLoadPair: null };
      const k2 = new Set<string>();
      collectKeys(sansLoadPair, k2);
      expect([...k2].filter((k) => k === 'x' || k === 'y')).toEqual([]);
    }
  });

  it('le radier expose wMax / diff / betaGov (resultats d ingenierie du PV) sans champ nodal ni *At', () => {
    const fx = RADIER_FIXTURES.find((f) => f.id === 'carre-charge-centree');
    expect(fx).toBeDefined();
    if (!fx) return;
    const env = runRadier(fx.input);
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(Number.isFinite(env.output.wMax)).toBe(true);
    expect(Number.isFinite(env.output.diff)).toBe(true);
    expect(Number.isFinite(env.output.betaGov)).toBe(true);
    // Aucun champ nodal, maillage, NI localisation *At dans la serialisation.
    expect(JSON.stringify(env.output)).not.toMatch(
      /"(w|p|Mx|My|Mxy|kr|nodeX|nodeY|blocks|loc|elements|Acell|wMaxAt|wMinAt|slopeMaxAt|tiltAt|betaGovAt)"\s*:/,
    );
  });

  it('cas MULTI-plaques : betaInter / interDiff exposes, mais pas la topologie inter', () => {
    const fx = RADIER_FIXTURES.find((f) => f.id === 'deux-plaques-inter');
    expect(fx).toBeDefined();
    if (!fx) return;
    const env = runRadier(fx.input);
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.output.nRafts).toBe(2);
    expect(Number.isFinite(env.output.betaInter)).toBe(true);
    expect(Number.isFinite(env.output.interDiff)).toBe(true);
    // interPair / interEnds (indices/coords de centres de plaques internes) ECARTES.
    expect(JSON.stringify(env.output)).not.toMatch(
      /"(interPair|interEnds|interDiffEnds)"\s*:/,
    );
  });

  it('cas MULTI-charges : worstLoadPair expose la pire distorsion (coords de charges saisies)', () => {
    const fx = RADIER_FIXTURES.find((f) => f.id === 'carre-quatre-poteaux');
    expect(fx).toBeDefined();
    if (!fx) return;
    const env = runRadier(fx.input);
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    const wp = env.output.worstLoadPair;
    expect(wp).not.toBeNull();
    if (!wp) return;
    expect(Number.isFinite(wp.beta)).toBe(true);
    // Seuls les champs d'ingenierie + coords de charges : pas de mesh/loc nodal.
    expect(Object.keys(wp).sort()).toEqual(['L', 'beta', 'ds', 'ki', 'kj', 'p1', 'p2']);
  });
});
