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

/**
 * Cles d'INTERMEDIAIRES qui ne doivent JAMAIS apparaitre dans la sortie client.
 *
 * RECLASSIFICATION (ADR 0015 reco A, 16/07) : le deroule pas-a-pas terzaghi est
 * EXPOSE (grandeurs normatives/textbook — h_r, p_le* , D_e, k_p/k_f/k_c, i_δ/i_β/i_δβ,
 * q_net, A', E_c/E_d, s_c/s_d, K_v… deja affichees par l'outil desktop du client). Ces
 * cles NE sont donc PLUS interdites. Restent STRICTEMENT INTERDITS :
 *   - les FACTEURS DE PORTANCE c–φ annexe F (N_q/N_c/N_γ/s_q/s_g/b_q/b_g/i_q/i_g/
 *     drained/gEff/q0eff) — HORS allowlist nominative (residu ferme §8) ;
 *   - les internes JAMAIS affiches (facteurs de forme Gazetas bv/bB/bL, etat de
 *     solveur, ctx/rows brut, qce alias, shapeR…).
 * La garantie PRINCIPALE reste le re-parse `.strict()` (toute cle hors schema est
 * REJETEE, a tout niveau) ; cette liste est une defense secondaire ciblee.
 */
const FUITES_INTERDITES = [
  // qce : alias interne (la pression nette penetro est exposee SOUS la cle `ple`).
  'qce',
  // Facteurs de portance c–φ (annexe F) — residu ferme, hors allowlist reco A.
  'Nq',
  'Nc',
  'Ng',
  'sq',
  'sg',
  'bq',
  'bg',
  'iq',
  'ig',
  'drained',
  'gEff',
  'q0eff',
  'cphiF',
  // Internes de raideur (Gazetas) jamais affiches : seuls K_v/K_h/K_θ sont exposes.
  'bv',
  'bB',
  'bL',
  // Objets bruts internes du moteur.
  'geom',
  'rows',
  'ctx',
  'shapeR',
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

  // --- MAJEUR-1 : l'excentrement (grandeur PUBLIQUE) TRAVERSE la projection ---
  it('[excentrement] exc / excLim / excOk sont projetes pour un cas requis (fin du strip)', () => {
    const fx = TERZAGHI_FIXTURES.find((f) => f.id === 'pressio-carree-excentree');
    expect(fx).toBeDefined();
    if (!fx) return;
    const env = runTerzaghi(fx.input);
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    const c0 = env.output.cas[0];
    expect(c0, 'un cas de charge attendu').toBeDefined();
    // ELU_F : excentrement REQUIS -> le verdict booleen + la valeur + la limite existent.
    expect(typeof c0?.excOk).toBe('boolean');
    expect(Number.isFinite(c0?.exc)).toBe(true);
    expect(Number.isFinite(c0?.excLim)).toBe(true);
    expect(typeof c0?.excLimLib).toBe('string');
  });

  // --- MAJEUR-2 : la portance complementaire c–φ TRAVERSE en methode in situ ---
  it('[cphi in situ] le bloc cphi (verdict + resistances) est projete quand l option est cochee, SANS facteurs de portance', () => {
    const fx = TERZAGHI_FIXTURES.find((f) => f.id === 'pressio-nappe'); // cphiOn: true, essai pressio
    expect(fx).toBeDefined();
    if (!fx) return;
    const env = runTerzaghi(fx.input);
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    const cphi = env.output.cas[0]?.cphi;
    expect(
      cphi,
      'le bloc cphi doit etre present en in situ + option cochee',
    ).toBeDefined();
    // Grandeurs de RESULTAT presentes...
    expect(Number.isFinite(cphi?.Rtot)).toBe(true);
    expect(Number.isFinite(cphi?.qRvd)).toBe(true);
    expect(Number.isFinite(cphi?.taux)).toBe(true);
    // ...mais AUCUN facteur de portance (assainissement §8).
    const cphiKeys = Object.keys(cphi as Record<string, unknown>);
    for (const forbidden of ['Nq', 'Nc', 'Ng', 'sq', 'sc', 'bq', 'bc', 'iq', 'ig', 'm']) {
      expect(cphiKeys, `facteur c–φ « ${forbidden} » ne doit pas fuir`).not.toContain(
        forbidden,
      );
    }
  });

  it('[cphi labo] en methode c–φ labo, le bloc complementaire cphi n est PAS reproduit (fidelite HTML : porte deja par la portance principale)', () => {
    const fx = TERZAGHI_FIXTURES.find((f) => f.id === 'labo-cphi-draine');
    expect(fx).toBeDefined();
    if (!fx) return;
    const env = runTerzaghi(fx.input);
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    // Portance principale portee par Rtot/portanceOk ; pas de bloc cphi redondant.
    expect(env.output.cas[0]?.cphi).toBeUndefined();
    expect(env.output.cas[0]?.portanceOk).toBe(true);
  });

  // --- Clone UI (ADR 0015) : grandeurs de DEMANDE affichees TRAVERSENT ---
  it('[demande] q_ref, H_d et contraintesBase sont projetes (affichage clone), SANS methode', () => {
    const fx = TERZAGHI_FIXTURES.find((f) => f.id === 'pressio-carree-excentree');
    expect(fx).toBeDefined();
    if (!fx) return;
    const env = runTerzaghi(fx.input);
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    const c0 = env.output.cas[0];
    expect(c0, 'un cas de charge attendu').toBeDefined();
    // POSITIF : les grandeurs de demande affichees existent (cas ELU_F avec F_x).
    expect(Number.isFinite(c0?.qref), 'q_ref affiche (V_d/A)').toBe(true);
    expect(Number.isFinite(c0?.Hd), 'H_d affiche (glissement)').toBe(true);
    // contraintesBase (u/q0/sv0) affiche par la note §2.
    expect(env.output.contraintesBase).toBeDefined();
    expect(Number.isFinite(env.output.contraintesBase?.u)).toBe(true);
    expect(Number.isFinite(env.output.contraintesBase?.q0)).toBe(true);
    expect(Number.isFinite(env.output.contraintesBase?.sv0)).toBe(true);
    // NEGATIF : ces nouveaux champs n'ont PAS ouvert la porte a la methode — les
    // intermediaires confidentiels restent strippes a tout niveau.
    const keys = new Set<string>();
    collectKeys(env.output, keys);
    for (const forbidden of FUITES_INTERDITES) {
      expect(keys.has(forbidden), `intermediaire « ${forbidden} » ne doit pas fuir`).toBe(
        false,
      );
    }
    // NB : `A'` (Ap), e_B/e_L, B'/L' — surface effective de Meyerhof — sont desormais
    // EXPOSES comme grandeurs d'affichage du deroule (ADR 0015 reco A ; re-derivables des
    // efforts saisis, meme rationale que q_ref = V_d/A'). Ce qui reste SERVEUR : le CODE et
    // les FACTEURS DE PORTANCE c–φ annexe F (FUITES_INTERDITES ci-dessus).
  });

  it('[demande] contraintesBase est un objet BORNE {u,q0,sv0} en strict (rien d autre)', () => {
    const fx = TERZAGHI_FIXTURES[0];
    if (!fx) return;
    const env = runTerzaghi(fx.input);
    if (!env.ok) return;
    const cb = env.output.contraintesBase;
    if (cb) {
      expect(Object.keys(cb).sort()).toEqual(['q0', 'sv0', 'u']);
    }
    // Une cle etrangere dans contraintesBase est REJETEE (.strict()).
    expect(() =>
      TerzaghiOutputSchema.parse({
        erreur: null,
        warnings: [],
        cas: [],
        contraintesBase: { u: 1, q0: 2, sv0: 3, secret: 9 },
      }),
    ).toThrow(/[Uu]nrecognized/);
  });

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
    // Defense en profondeur : meme rejet a un niveau imbrique (objet de cas). `kp` est
    // desormais whitelisté (reco A) ; on prend un facteur de portance c–φ (N_q) qui reste
    // HORS allowlist -> doit toujours faire ECHOUER le parse.
    const pollue = {
      erreur: null,
      warnings: [],
      cas: [
        {
          idx: 0,
          etat: 'ELS_QP',
          invalide: false,
          Nq: 5 /* facteur c–φ : hors allowlist */,
        },
      ],
    };
    expect(() => TerzaghiOutputSchema.parse(pollue)).toThrow(/[Uu]nrecognized/);
  });

  // --- DE-STUB pas-a-pas (ADR 0015 reco A) : POSITIF + NEGATIF sur le deroule ---
  it('[pas-a-pas] les grandeurs du deroule (reco A) TRAVERSENT la projection (in situ pressio)', () => {
    const fx = TERZAGHI_FIXTURES.find((f) => f.id === 'nominal-pressio-rect');
    expect(fx).toBeDefined();
    if (!fx) return;
    const env = runTerzaghi(fx.input);
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    const c0 = env.output.cas[0] as Record<string, unknown> | undefined;
    expect(c0, 'un cas de charge attendu').toBeDefined();
    // Geometrie effective + coefficients de portance/reduction + resistances (annexes D/H).
    for (const k of [
      'A',
      'Ap',
      'hr',
      'ple',
      'De',
      'DeB',
      'kpx',
      'kf',
      'kc',
      'kp',
      'idel',
      'ibet',
      'idb',
      'qnet',
      'R0',
      'gRv',
      'gRdv',
      'Bp',
      'Lp',
    ]) {
      expect(Number.isFinite(c0?.[k]), `pas-a-pas: ${k} projete`).toBe(true);
    }
    // Coefficients de courbe (categorie du calcul) — table publiee annexe D (4 nombres).
    expect(
      Array.isArray(c0?.coefCourbeF) && (c0?.coefCourbeF as number[]).length === 4,
    ).toBe(true);
    expect(
      Array.isArray(c0?.coefCourbeC) && (c0?.coefCourbeC as number[]).length === 4,
    ).toBe(true);
    // Tassement de Menard decompose (E_c/E_d, α/λ, s_c + s_d = s_f).
    const tass = c0?.tass as Record<string, unknown> | undefined;
    expect(tass, 'sous-objet tassement present').toBeDefined();
    for (const k of ['Ec', 'Ed', 'alc', 'ald', 'lc', 'ld', 'sc', 'sd', 'sf']) {
      expect(Number.isFinite(tass?.[k]), `tassement: ${k} projete`).toBe(true);
    }
    // Raideurs equivalentes (K_v/K_h/K_θ) au niveau racine.
    const raid = (env.output as Record<string, unknown>).raideurs as
      | Record<string, unknown>
      | undefined;
    expect(raid, 'raideurs projetees').toBeDefined();
    expect(Number.isFinite(raid?.Kv)).toBe(true);
  });

  it('[pas-a-pas] les facteurs de portance c–φ annexe F (N_q/N_c/N_γ) NE traversent PAS (residu ferme)', () => {
    // Meme sur un cas c–φ (labo) ou la portance est analytique, les facteurs restent SERVEUR :
    // la sortie ne porte que le verdict + les resistances (Rtot/qRvd/taux/portanceOk).
    const fx = TERZAGHI_FIXTURES.find((f) => f.id === 'labo-cphi-draine');
    expect(fx).toBeDefined();
    if (!fx) return;
    const env = runTerzaghi(fx.input);
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    const keys = new Set<string>();
    collectKeys(env.output, keys);
    for (const forbidden of [
      'Nq',
      'Nc',
      'Ng',
      'sq',
      'sg',
      'bq',
      'bg',
      'iq',
      'ig',
      'drained',
      'gEff',
    ]) {
      expect(keys.has(forbidden), `facteur c–φ « ${forbidden} » ne doit pas fuir`).toBe(
        false,
      );
    }
  });

  it('[pas-a-pas] une cle non whitelistee DANS un sous-objet tassement/raideurs est REJETEE (.strict())', () => {
    // tass en .strict() : un intermediaire non declare (ex. `integral` du solveur) echoue.
    expect(() =>
      TerzaghiOutputSchema.parse({
        erreur: null,
        warnings: [],
        cas: [
          { idx: 0, etat: 'ELS_QP', invalide: false, tass: { sf: 0.01, integral: 3.2 } },
        ],
      }),
    ).toThrow(/[Uu]nrecognized/);
    // raideurs en .strict() : un ratio interne (ex. `bv` de Gazetas) echoue.
    expect(() =>
      TerzaghiOutputSchema.parse({
        erreur: null,
        warnings: [],
        cas: [],
        raideurs: { Kv: 100, bv: 1.4 },
      }),
    ).toThrow(/[Uu]nrecognized/);
  });
});
