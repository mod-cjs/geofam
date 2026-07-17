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
import {
  PIEUX_BETON_FIXTURES,
  PIEUX_DOWNDRAG_FIXTURES,
  PIEUX_FIXTURES,
} from './test-fixtures.js';

import { runPieux } from './index.js';

/**
 * Cles d'INTERMEDIAIRES qui ne doivent JAMAIS apparaitre dans la sortie client.
 *
 * RECLASSIFICATION §8 (directive titulaire « tolerance 0 » + avis expert A) : les VALEURS
 * affichees par l'outil client sont DESORMAIS exposees en display-only — Rb/Rs bruts,
 * p*le/qce equivalents, facteurs de portance appliques kfac(kp/kc) et plafond kmax,
 * hauteur d'encastrement Def/debR, correlations xi3/xi4, modele gammaR;d1, effet de
 * groupe Ce, tableau de frottement `fric`, et les courbes portance/tassement/downdrag
 * (re-echantillonnees). Ces cles sont donc RETIREES de la liste ci-dessous.
 *
 * Ce qui reste INTERDIT = le CODE / les objets de solveur bruts, jamais affiches :
 * terme de pointe nu `qb`, chaine `qbDetail`, objet d'interpolation `qceDetail`, objet
 * `settle` brut et ses rigidites t-z (ktau/kq), facteurs partiels par combinaison
 * (Rbf/Rsf/comb/crit), decomposition RbD/RsD, geometrie interne (Ab/perim/Bsurf/hInLayer),
 * profil de couches brut (layers/baseLayer/ztop/zbot/pl/em), `pile`, `cls`, RsKsum, CeF,
 * floating, et le NOM BRUT `grd` (expose seulement sous `gammaRd1`).
 */
const FUITES_INTERDITES = [
  // Terme de pointe nu + chaines/objets de solveur (jamais affiches tels quels).
  'qb',
  'qbDetail',
  'qceDetail',
  // Objet de mobilisation du tassement BRUT + ses coefficients t-z (seule la courbe
  // re-echantillonnee `courbeTassement.{pts,Fmax}` sort, pas l'objet `settle`).
  'settle',
  'ktau',
  'kq',
  // Facteurs partiels par combinaison + decomposition de resistance.
  'RsKsum',
  'Rbf',
  'Rsf',
  'comb',
  'crit',
  'RbD',
  'RsD',
  // Nom BRUT du coef de modele (expose uniquement sous `gammaRd1`) + classe/famille.
  'grd',
  'cls',
  'pile',
  // Profil de couches brut (cotes ztop/zbot, parametres de sol).
  'layers',
  'baseLayer',
  'ztop',
  'zbot',
  'pl',
  'em',
  // Geometrie intermediaire (reconstruite cote clone depuis la saisie publique).
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

  // --- FROTTEMENT NÉGATIF (#94) : Gsn/Nmax/pointNeutre + profils re-échantillonnés -----
  // RECLASSIFICATION §8 : le profil re-échantillonné (`profilsDowndrag.{wHead,prof[{z,w,
  // g,f,qsP,qsN,N}]}`) est DÉSORMAIS exposé display-only (il est tracé par l'outil). Ce
  // qui reste SERVEUR = les objets/coefficients BRUTS jamais affichés : rigidités t-z,
  // efforts de pointe intermédiaires (Ntip/qbM), tassement de pointe wtip/wTip, cote
  // BRUTE zN (exposée sous 'pointNeutre'), zone zt/zb, coefficient de F.N. KtanD/Hc/s0.
  const DOWNDRAG_FUITES_INTERDITES = [
    'Ntip',
    'qbM',
    'wtip',
    'wTip',
    'zN', // la cote du point neutre est exposée sous le nom 'pointNeutre', jamais 'zN'
    'zt',
    'zb',
    'KtanD',
    'Hc',
    's0',
  ];

  const ddFixtures = PIEUX_DOWNDRAG_FIXTURES.filter((f) => !f.horsDomaine);

  it('PRECONDITION : au moins un jeu downdrag comparable (sinon test vide)', () => {
    expect(ddFixtures.length).toBeGreaterThanOrEqual(1);
  });

  for (const fx of ddFixtures) {
    it(`[${fx.id}] downdrag : prof/qsN par couche N APPARAISSENT PAS dans la sortie projetée`, () => {
      const env = runPieux(fx.input);
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      const keys = new Set<string>();
      collectKeys(env.output, keys);
      const fuites = DOWNDRAG_FUITES_INTERDITES.filter((k) => keys.has(k));
      expect(fuites, `clés d intermédiaire downdrag trouvées dans la sortie`).toEqual([]);
      // Symétrie POSITIVE : les 3 résultats livrables SONT bien présents (non undefined).
      expect(Object.prototype.hasOwnProperty.call(env.output, 'Gsn')).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(env.output, 'Nmax')).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(env.output, 'pointNeutre')).toBe(true);
      // Gsn/Nmax sont finis (downdrag demandé) ; pointNeutre fini OU null (mode auto
      // sans point neutre trouvé). Aucun n'est un objet/tableau (pas de fuite de structure).
      expect(env.output.Gsn === null || Number.isFinite(env.output.Gsn)).toBe(true);
      expect(env.output.Nmax === null || Number.isFinite(env.output.Nmax)).toBe(true);
      expect(
        env.output.pointNeutre === null || Number.isFinite(env.output.pointNeutre),
      ).toBe(true);
      // Re-parse strict : toute clé non whitelistée qui aurait survécu serait rejetée.
      expect(() => PieuxOutputSchema.parse(env.output)).not.toThrow();
    });
  }

  it('SANS groupe frottementNegatif : Gsn/Nmax/pointNeutre valent null (downdrag non calculé)', () => {
    // Une fixture nominale SANS downdrag : les 3 champs existent mais valent null.
    const fx = PIEUX_FIXTURES.find((f) => f.id === 'pmt-fore-da2-comp');
    expect(fx).toBeDefined();
    if (!fx) return;
    expect(fx.input.frottementNegatif).toBeUndefined();
    const env = runPieux(fx.input);
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.output.Gsn).toBeNull();
    expect(env.output.Nmax).toBeNull();
    expect(env.output.pointNeutre).toBeNull();
  });

  // --- VÉRIFICATION BÉTON (#95) : seul le RÉSULTAT sort, jamais les facteurs de calage --
  // Le retour BRUT de betonCheck porte les FACTEURS DE CALAGE de la méthode NF P 94-262
  // §4.4 (C_max et k₁ du Tableau 12, k₂ d'élancement, la résistance calée f_ck*, α_cc,
  // k₃, γ_c) ET les contraintes NUES σ_ELU/σ_ELS/limite ELS. Tout cela révèle la méthode
  // et reste SERVEUR. Seuls le verdict (okELU/okELS), les taux et f_cd (résistance de
  // calcul EC2, publique) sont whitelistés — sous des noms préfixés `beton*`.
  const BETON_FUITES_INTERDITES = [
    'Cmax',
    'k1',
    'k2',
    'fck',
    'fckStar',
    'acc',
    'k3',
    'gc',
    'sELU',
    'sELS',
    'limELS',
    'na',
    'reason',
    // Les taux/verdicts NUS (sans préfixe beton*) ne doivent pas non plus apparaître.
    'okELU',
    'okELS',
    'tauxELU',
    'tauxELS',
    'fcd',
  ];

  const btFixtures = PIEUX_BETON_FIXTURES.filter((f) => !f.horsDomaine);

  it('PRECONDITION béton : au moins 8 jeux comparables (sinon test vide)', () => {
    expect(btFixtures.length).toBeGreaterThanOrEqual(8);
  });

  for (const fx of btFixtures) {
    it(`[${fx.id}] béton : aucun facteur de calage (Cmax/k1/k2/fckStar/acc/k3/gc) ne fuit`, () => {
      const env = runPieux(fx.input);
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      const keys = new Set<string>();
      collectKeys(env.output, keys);
      const fuites = BETON_FUITES_INTERDITES.filter((k) => keys.has(k));
      expect(fuites, `facteurs de calage béton trouvés dans la sortie`).toEqual([]);
      // Symétrie POSITIVE : les 6 champs client-safe SONT présents (non undefined).
      for (const k of [
        'betonApplicable',
        'betonOkELU',
        'betonOkELS',
        'betonTauxELU',
        'betonTauxELS',
        'betonFcd',
      ]) {
        expect(Object.prototype.hasOwnProperty.call(env.output, k)).toBe(true);
      }
      // Re-parse strict : toute clé non whitelistée qui aurait survécu serait rejetée.
      expect(() => PieuxOutputSchema.parse(env.output)).not.toThrow();
    });
  }

  it('béton APPLICABLE (compression) : verdict/taux/f_cd finis, betonApplicable=true', () => {
    const fx = PIEUX_BETON_FIXTURES.find((f) => f.id === 'bt-arme-comp-courant-fore');
    expect(fx).toBeDefined();
    if (!fx) return;
    const env = runPieux(fx.input);
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.output.betonApplicable).toBe(true);
    expect(typeof env.output.betonOkELU).toBe('boolean');
    expect(typeof env.output.betonOkELS).toBe('boolean');
    expect(Number.isFinite(env.output.betonTauxELU)).toBe(true);
    expect(Number.isFinite(env.output.betonTauxELS)).toBe(true);
    expect(Number.isFinite(env.output.betonFcd)).toBe(true);
  });

  it('béton NON APPLICABLE (traction) : betonApplicable=false, verdicts/taux/f_cd = null', () => {
    const fx = PIEUX_BETON_FIXTURES.find((f) => f.id === 'bt-arme-traction-na');
    expect(fx).toBeDefined();
    if (!fx) return;
    const env = runPieux(fx.input);
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.output.betonApplicable).toBe(false);
    expect(env.output.betonOkELU).toBeNull();
    expect(env.output.betonOkELS).toBeNull();
    expect(env.output.betonTauxELU).toBeNull();
    expect(env.output.betonTauxELS).toBeNull();
    expect(env.output.betonFcd).toBeNull();
  });

  it('SANS groupe beton : les 6 champs beton* valent null (vérification non calculée)', () => {
    const fx = PIEUX_FIXTURES.find((f) => f.id === 'pmt-fore-da2-comp');
    expect(fx).toBeDefined();
    if (!fx) return;
    expect(fx.input.beton).toBeUndefined();
    const env = runPieux(fx.input);
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.output.betonApplicable).toBeNull();
    expect(env.output.betonOkELU).toBeNull();
    expect(env.output.betonOkELS).toBeNull();
    expect(env.output.betonTauxELU).toBeNull();
    expect(env.output.betonTauxELS).toBeNull();
    expect(env.output.betonFcd).toBeNull();
  });

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
    // Sanity positive : un cas nominal produit bien les grandeurs FINALES exposees.
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
    // RECLASSIFICATION §8 : les intermediaires d'AFFICHAGE (kfac/ple/qce/Def/xi3/fric)
    // SONT desormais exposes display-only. Ce qui reste INTERDIT = les objets/chaines de
    // solveur BRUTS jamais affiches : `qb` nu, `qbDetail`, `qceDetail`, l'objet `settle`,
    // les facteurs par combinaison `comb`, le nom brut `grd`.
    const s = JSON.stringify(env.output);
    expect(s).not.toMatch(/"(qb|qbDetail|qceDetail|settle|comb|grd)"\s*:/);
  });

  it('§8 reclassification : les valeurs d affichage traversent avec les valeurs REELLES du moteur', () => {
    // Chemin POSITIF de la reclassification : chaque nouveau champ display porte la
    // valeur BRUTE du moteur (pas un placeholder). Compare a la source de verite R.
    const fx = PIEUX_FIXTURES.find((f) => f.id === 'pmt-fore-da2-comp');
    expect(fx).toBeDefined();
    if (!fx) return;
    const R = computePieux(fx.input) as Record<string, unknown>;
    const rn = (k: string): number => R[k] as number; // accesseur typé (source de vérité brute)
    const env = runPieux(fx.input);
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    const o = env.output;
    // Scalaires : egalite stricte avec le brut R (aucune transformation).
    expect(o.Rb).toBeCloseTo(rn('Rb'), 9);
    expect(o.Rs).toBeCloseTo(rn('Rs'), 9);
    expect(o.ple).toBeCloseTo(rn('ple'), 9); // fixture PMT -> ple defini
    expect(o.qce).toBeNull(); // pas de qce en methode pressiometrique
    expect(o.kfac).toBeCloseTo(rn('kfac'), 9);
    expect(o.kmax).toBeCloseTo(rn('kmax'), 9);
    expect(o.Def).toBeCloseTo(rn('Def'), 9);
    expect(o.debR).toBeCloseTo(rn('debR'), 9);
    expect(o.xi3).toBeCloseTo(rn('xi3'), 9);
    expect(o.xi4).toBeCloseTo(rn('xi4'), 9);
    expect(o.gammaRd1).toBeCloseTo(rn('grd'), 9); // R.grd -> gammaRd1
    expect(o.Ce).toBeCloseTo(rn('Ce'), 9);
    // Tableau de frottement : une ligne par couche, qs/dRs reels.
    const fricR = R.fric as Array<{ qs: number; dRs: number }>;
    expect(o.fric).not.toBeNull();
    expect(o.fric!.length).toBe(fricR.length);
    expect(o.fric![0]!.qs).toBeCloseTo(fricR[0]!.qs, 9);
    expect(o.fric![0]!.dRs).toBeCloseTo(fricR[0]!.dRs, 9);
    // Courbes re-echantillonnees : nombre de points FIXE (decouple de l interne),
    // extremites finies et coherentes avec le balayage/settle bruts.
    expect(o.courbePortance).not.toBeNull();
    expect(o.courbePortance!.rows.length).toBe(48);
    expect(o.courbeTassement).not.toBeNull();
    expect(o.courbeTassement!.pts.length).toBe(48);
    expect(o.courbeTassement!.pts[0]!.F).toBe(0); // la courbe part de F=0
    const settle = (R.settle ?? null) as { Fmax: number } | null;
    expect(o.courbeTassement!.Fmax).toBeCloseTo(settle!.Fmax, 9);
    // Toutes les valeurs de courbe sont finies (fail-closed : jamais de NaN).
    const allNums = [
      ...o.courbePortance!.rows.flatMap((r) => [
        r.D,
        r.elufond,
        r.eluacc,
        r.elscar,
        r.elsqp,
      ]),
      ...o.courbeTassement!.pts.flatMap((p) => [p.F, p.s]),
    ];
    expect(allNums.every((n) => Number.isFinite(n))).toBe(true);
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
