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
 *
 * --- MISE A JOUR « zero ecart » (decision titulaire 14/07) ---
 * La sortie expose desormais TOUT ce que renderResults AFFICHE (pf/pE/p0/sigmaH0/z,
 * volumes, extrapolation, synthese beta/mE, courbe corrigee). Les cles CORRESPONDANTES
 * ont donc quitte cette liste (elles sont legitimes). Ce qui RESTE interdit = ce que le
 * client N'AFFICHE PAS : les cles BRUTES de `_res` non projetees (C/ext/recip/`gen`, les
 * raw VE/V0c/Vf/Pf/sigH0/auto_*), la decomposition sigV0/sig'v0/u0, la pression nette
 * par palier pS, l'analyse de pente brute _slopes, l'indice iE. Le moteur `_res` PORTE
 * REELLEMENT sigV0/sigVp/u0/iE : ce test MORD donc sur donnees reelles (ces cles sont
 * dans le brut mais jamais dans la sortie projetee).
 */
const FUITES_INTERDITES = [
  // Courbe/fluage/extrapolation BRUTS (on expose 'courbe'/'extrapolation', pas ces cles).
  'C',
  'fluage',
  'ext',
  'recip',
  'PLMasym',
  'A',
  'B',
  'gen',
  // Decomposition de la contrainte au repos (le client n'affiche QUE le total sigmaH0).
  'sigH0', // cle BRUTE (_res.sigH0) — la sortie expose 'sigmaH0', jamais 'sigH0'
  'sigV0',
  'sigVp',
  'u0',
  'gamma',
  // Pressions/volumes de calage BRUTS (_res) — la sortie expose pE/p0/pf + volumes.{…}.
  'Pf', // _res.Pf (majuscule) — la sortie expose 'pf'
  'VE',
  'V0c',
  'Vf',
  'VsP2V1',
  'pL_direct',
  // Analyse de pente : indice de pente minimale + slopes bruts (NON affiches).
  'iE',
  '_slopes',
  'auto_p0I', // cles BRUTES — la sortie expose synthese.plageAutoDebut/Fin
  'auto_pfI',
  'pfI',
  'plmI',
  // Pression nette PAR PALIER (non affichee ; la sortie n'expose que la courbe corrigee).
  'pS',
  // NB : `aUsed`/`aForced` NE sont PLUS interdits — ELARGISSEMENT NOMINATIF (R1, ADR 0014) :
  // le client AFFICHE l'avertissement « Resultat non corrige » (« a force a 0 ») qui teste
  // ces deux champs ; ils sont donc desormais whitelistes (cf. test positif ci-dessous).
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
      aUsed: 0.5,
      aForced: false,
      ratioEMpL: 7.9,
      alpha: 0.5,
      Ey: 19,
      pLDirect: true,
      categorie: 'C',
      categorieLibelle: 'Sol ferme (cat. C)',
      consolidation: 'Sol normalement consolidé',
      // Sortie elargie « zero ecart » — champs requis (objet complet, seul sigH0 pollue).
      pf: 3.2,
      pE: 0.3,
      p0: 1.1,
      sigmaH0: 0.42,
      z: 4,
      categorieDescription: 'Argile raide, sable.',
      volumes: { vE: 24, v0: 69, vf: 129, vLim: 673 },
      extrapolation: { a: 0.014, b: -0.003, plmVLim: 4.4, plmAsymptote: 4.9, errV: 0.13 },
      synthese: { beta: 1.5, mE: 49.5, plageAutoDebut: 0, plageAutoFin: 6 },
      courbe: [],
      sigH0: 0.42 /* cle BRUTE interdite : la sortie n'expose que 'sigmaH0' */,
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

  it('expose le module d Young Ey = EM/alpha (grandeur de resultat publique)', () => {
    // Ey est une grandeur FINALE (module d'Young derive), affichee par l'outil
    // d'origine (renderResults : « Ey = E/α »). Elle est calculee SERVEUR a partir
    // de deux resultats deja publics (EM, alpha) : aucun intermediaire de methode.
    const fx = PRESSIOMETRE_FIXTURES.find((f) => f.id === 'demo-4m-seuils-manuels');
    expect(fx).toBeDefined();
    if (!fx) return;
    const env = runPressiometre(fx.input);
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(Number.isFinite(env.output.Ey)).toBe(true);
    // Ey == EM / alpha (parite HTML : r.EM / r.alpha).
    expect(env.output.Ey).toBeCloseTo(env.output.EM / env.output.alpha, 9);
  });

  it('ELARGISSEMENT R1 : expose aUsed/aForced (garde-fou « Resultat non corrige » du client)', () => {
    // POSITIF #1 — cas d'ecretage : `a` volontairement trop grand -> le moteur force a=0.
    // Le client AFFICHE « a force a 0 » (renderResults teste r.aForced) : ces champs
    // DOIVENT donc sortir (ADR 0014, R1). Ils survivent au re-parse strict.
    const fxForced = PRESSIOMETRE_FIXTURES.find((f) => f.id === 'borne-a-trop-grand');
    expect(fxForced, 'fixture d ecretage a introuvable').toBeDefined();
    if (!fxForced) return;
    const envF = runPressiometre(fxForced.input);
    expect(envF.ok).toBe(true);
    if (!envF.ok) return;
    // a_raw > 0 dans l'entree mais ecrete -> aUsed === 0 ET aForced === true.
    expect(fxForced.input.params.a, 'la fixture doit fournir a > 0').toBeGreaterThan(0);
    expect(envF.output.aUsed).toBe(0);
    expect(envF.output.aForced).toBe(true);
    // Survit au re-parse .strict() (champ legitimement whiteliste, pas un residu strippe).
    expect(PressiometreOutputSchema.parse(envF.output).aForced).toBe(true);

    // POSITIF #2 — calibrage non renseigne (a=0 saisi) : aUsed===0 mais aForced===false
    // (le client affiche « a = 0 : calibrage non renseigne », PAS « force a 0 »).
    const fxNul = PRESSIOMETRE_FIXTURES.find((f) => f.id === 'demo-4m-a-nul');
    expect(fxNul).toBeDefined();
    if (!fxNul) return;
    const envN = runPressiometre(fxNul.input);
    expect(envN.ok).toBe(true);
    if (!envN.ok) return;
    expect(envN.output.aUsed).toBe(0);
    expect(envN.output.aForced).toBe(false);

    // POSITIF #3 — cas nominal a > 0 non ecrete : aUsed === a saisi, aForced === false.
    const fxOk = PRESSIOMETRE_FIXTURES.find((f) => f.id === 'demo-4m-seuils-manuels');
    if (!fxOk) return;
    const envOk = runPressiometre(fxOk.input);
    if (!envOk.ok) return;
    expect(envOk.output.aForced).toBe(false);
    expect(envOk.output.aUsed).toBeCloseTo(fxOk.input.params.a, 9);
  });
});
