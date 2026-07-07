/**
 * Tests — adaptCalcResult : normalisation client-safe des 5 moteurs ajoutés hors
 * burmister (terzaghi, pieux, radier, labo, pressiomètre).
 *
 * Complète adapters.burmister.test.ts. Le test de fuite de ce dernier n'exerçait
 * qu'une sortie SYNTHÉTIQUE (`{qadm, methode}`) tombant sur `null` : il ne prouvait
 * PAS l'étanchéité des VRAIES formes de sortie de ces moteurs. Ici, chaque cas part
 * d'une sortie moteur RÉELLE (capturée depuis @roadsen/engines, champs confidentiels
 * inclus) et vérifie, en BDD :
 *   - le bon AIGUILLAGE (dispatch) + le verdict attendu ;
 *   - la présence des grandeurs de RÉSULTAT attendues (pas de suite vide) ;
 *   - fail-closed (DoD §8) : AUCUN champ confidentiel du brut n'atteint le navigateur.
 *
 * ⚠️ Confidentialité (DoD §8) : ce test N'IMPORTE PAS @roadsen/engines (garde-fou
 * engines→web). Les sorties sont des ÉCHANTILLONS FIGÉS, comme LIVE_BURMISTER_OUTPUT.
 */
import { describe, it, expect } from 'vitest';

import { adaptCalcResult, type PrismaCalcResult } from '../adapters';
import type { CalcOutputRow, NormalizedCalcOutput } from '../types';

// ── Sorties RÉELLES capturées (fixtures nominales de chaque moteur) ────────────────
// Champs confidentiels VOLONTAIREMENT conservés (warnings, methode, capaciteReference,
// classe.path/desc, alpha, slopeMax…) : ils servent de cibles au scan de fuite.

const REAL_TERZAGHI = {
  erreur: null,
  warnings: [
    'Sondage très court (13,5 m < D + 2,5·B) : tassement indicatif (formule H.2.1.2.7).',
  ],
  regime: 'superficielle',
  capaciteReference: {
    ok: true,
    A: 60,
    R0: 5400,
    states: [{ etat: 'ELU_F', gRv: 1.4, Rvd: 68891.08, qRvd: 1148.18 }],
  },
  cas: [
    {
      idx: 0,
      etat: 'ELS_QP',
      invalide: false,
      Rtot: 44046.74,
      qRvd: 734.11,
      taux: 0.2778,
      portanceOk: true,
      tassement: 0.010667,
      deplacementVertical: 0.019088,
    },
  ],
};

const REAL_PIEUX = {
  erreur: null,
  warnings: [],
  B: 0.6,
  D: 15,
  categorie: 1,
  methode: 'pmt',
  sens: 'comp',
  RbK: 891.25,
  RsK: 1494.15,
  RcK: 2385.4,
  RcD: 2168.55,
  RcrK: 1491.53,
  RcrCar: 1657.26,
  RcrQp: 1355.94,
  FduELU: 1605,
  FdCar: 1150,
  FdQp: 905,
  verifications: [
    { nom: 'ELU portance — DA2', Fd: 1605, Rd: 2168.55, taux: 0.7401, ok: true },
    { nom: 'ELS caractéristique', Fd: 1150, Rd: 1657.26, taux: 0.6939, ok: true },
  ],
  allOk: true,
  tauxGouvernant: 0.7401,
  tassementELS: 3.19,
};

const REAL_LABO = {
  erreur: null,
  warnings: [],
  wn: 17.99,
  dmax: 20,
  p80: 52,
  p2: 73,
  wl: 38,
  wp: 20,
  ip: 18,
  ic: 1.11,
  vbs: 3.5,
  wopn: 16.21,
  rdmax: 1.84,
  cbr: null,
  cbrType: 'cbr',
  es: null,
  la: null,
  sz: null,
  mde: null,
  so3: null,
  c_cis: 8.19,
  phi_cis: 24.97,
  Cc_oedo: 0.1215,
  Cs_oedo: 0.01446,
  k: null,
  classe: {
    fam: 'A',
    code: 'A2',
    full: 'A2 h',
    desc: 'Sables fins argileux, limons, argiles peu plastiques',
    path: [
      'Passant 80µm = 52.0 % > 35 % → sol fin → famille A.',
      'Ip = 18.0 (préférentiel) → A2.',
    ],
    warn: [],
    etat: 'h',
    stApplies: true,
    rNote: null,
  },
};

const REAL_PRESSIOMETRE = {
  erreur: null,
  warnings: [],
  pL: 4.3911,
  pLNette: 4.2011,
  pfNette: 2.11,
  EM: 3.4064,
  ratioEMpL: 7.7574,
  alpha: 0.67,
  Ey: 5.0842,
  pLDirect: false,
  categorie: 'B',
  categorieLibelle: 'Sol mou (cat. B)',
  consolidation: 'Sol normalement consolidé',
};

const REAL_RADIER = {
  erreur: null,
  warnings: [],
  wMax: 8.7895,
  wMin: 5.4271,
  diff: 3.3624,
  slopeMax: 0.933,
  tiltMax: 4.3e-13,
  betaIntra: 0.933,
  betaInter: 0,
  interDiff: 0,
  betaGov: 0.933,
  nRafts: 1,
  worstLoadPair: null,
};

function makeRaw(engineId: string, output: unknown): PrismaCalcResult {
  return {
    id: 'calc_x',
    projectId: 'proj_01',
    orgId: 'org_01',
    engineId,
    input: {},
    output,
    createdAt: '2026-07-02T10:00:00.000Z',
  };
}

function normalizedOf(engineId: string, output: unknown): NormalizedCalcOutput {
  const norm = adaptCalcResult(makeRaw(engineId, output)).output;
  expect(norm, `${engineId} : sortie normalisée non nulle (dispatch ok)`).not.toBeNull();
  return norm as NormalizedCalcOutput;
}

/** Asserte qu'AUCUN marqueur confidentiel n'apparaît dans la sortie normalisée sérialisée. */
function expectNoLeak(norm: NormalizedCalcOutput, forbidden: string[]): void {
  const serialized = JSON.stringify(norm);
  for (const marker of forbidden) {
    expect(serialized, `fuite détectée : "${marker}"`).not.toContain(marker);
  }
}

function labels(norm: NormalizedCalcOutput): string {
  return (norm.rows as CalcOutputRow[]).map((r) => r.label).join(' | ');
}

describe('adaptCalcResult — terzaghi (fondation superficielle)', () => {
  it('given une sortie {cas:[…]} portante, when adapté, then verdict PASS + rows de résultat', () => {
    const norm = normalizedOf('fondation-superficielle', REAL_TERZAGHI);
    expect(norm.verdict).toBe('PASS');
    expect(norm.rows.length).toBeGreaterThan(0);
    expect(labels(norm)).toMatch(/résistance R|taux de mobilisation|tassement/);
  });

  it('fail-closed : ni warnings, ni régime, ni capaciteReference, ni intermédiaires', () => {
    const norm = normalizedOf('fondation-superficielle', REAL_TERZAGHI);
    expectNoLeak(norm, [
      'regime',
      'capaciteReference',
      'deplacementVertical',
      'H.2.1.2.7',
      'Sondage',
      'superficielle',
      'states',
      'invalide',
      'ELS_QP',
    ]);
  });

  it('durcissement : état-limite NON reconnu → placeholder « — », jamais le texte moteur brut', () => {
    const tampered = {
      ...REAL_TERZAGHI,
      cas: [{ ...REAL_TERZAGHI.cas[0], etat: 'FORMULE_H.2.1.2.7_DEBUG' }],
    };
    const norm = normalizedOf('fondation-superficielle', tampered);
    expect(JSON.stringify(norm)).not.toContain('FORMULE_H.2.1.2.7_DEBUG');
    expect((norm.rows as CalcOutputRow[]).some((r) => r.label.startsWith('—'))).toBe(
      true,
    );
  });
});

// ── MAJEUR-1 : l'excentrement DOIT peser dans le verdict global (fin du faux PASS) ──
// Sentinelle de non-régression. AVANT correctif : terzaghiVerdict ne testait que
// portanceOk + glissementOk ; un cas excentrement NON vérifié (excOk:false) affichait
// « Fondation vérifiée » (PASS) — faux PASS scellable dans un PV.
describe('adaptCalcResult — terzaghi : excentrement dans le verdict (MAJEUR-1)', () => {
  const CAS_EXC_KO = {
    idx: 0,
    etat: 'ELU_F',
    invalide: false,
    Rtot: 44046.74,
    qRvd: 734.11,
    taux: 0.2778,
    portanceOk: true, // portance OK
    Rhd: 900,
    tauxH: 0.3,
    glissementOk: true, // glissement OK
    exc: 0.033, // < limite
    excLim: 0.06666666666666667,
    excLimLib: '1/15',
    excOk: false, // MAIS excentrement NON vérifié
  };

  it('given un cas portanceOk+glissementOk mais excOk=false, when adapté, then verdict FAIL (plus de faux PASS)', () => {
    const norm = normalizedOf('fondation-superficielle', {
      ...REAL_TERZAGHI,
      cas: [CAS_EXC_KO],
    });
    expect(norm.verdict).toBe('FAIL');
  });

  it('given un cas excOk=true, when adapté, then verdict PASS + ligne excentrement OK affichée', () => {
    const norm = normalizedOf('fondation-superficielle', {
      ...REAL_TERZAGHI,
      cas: [{ ...CAS_EXC_KO, exc: 0.9, excOk: true }],
    });
    expect(norm.verdict).toBe('PASS');
    const excRow = (norm.rows as CalcOutputRow[]).find((r) => /excentr/i.test(r.label));
    expect(excRow, 'une ligne excentrement doit être affichée').toBeDefined();
    expect(excRow?.status).toBe('ok');
  });

  it('given ELU accidentel (excOk absent = non requis), when adapté, then l’excentrement ne fait pas échouer le verdict', () => {
    const casNonRequis = {
      idx: 0,
      etat: 'ELU_A',
      invalide: false,
      Rtot: 44046.74,
      qRvd: 734.11,
      taux: 0.2778,
      portanceOk: true,
      // excOk/exc/excLim absents (ELU_A : excentrement non requis, tab. 5.5)
    };
    const norm = normalizedOf('fondation-superficielle', {
      ...REAL_TERZAGHI,
      cas: [casNonRequis],
    });
    expect(norm.verdict).toBe('PASS');
  });
});

// ── MAJEUR-2 : la portance complémentaire c–φ (annexe F) doit s'afficher ──────────
describe('adaptCalcResult — terzaghi : portance complémentaire c–φ (MAJEUR-2)', () => {
  it('given un cas avec bloc cphi, when adapté, then une ligne « portance c–φ (annexe F) » est présente', () => {
    const norm = normalizedOf('fondation-superficielle', {
      ...REAL_TERZAGHI,
      cas: [
        {
          ...REAL_TERZAGHI.cas[0],
          etat: 'ELU_F',
          cphi: { ok: true, taux: 0.72, qRvd: 810.5, Rtot: 40123.4 },
        },
      ],
    });
    const cphiRow = (norm.rows as CalcOutputRow[]).find((r) => /c–φ|annexe F/i.test(r.label));
    expect(cphiRow, 'la portance c–φ doit apparaître quand le bloc cphi est présent').toBeDefined();
  });
});

describe('adaptCalcResult — pieux (fondation profonde)', () => {
  it('given allOk=true, when adapté, then verdict PASS + résistances complètes', () => {
    const norm = normalizedOf('fondation-profonde-pieux', REAL_PIEUX);
    expect(norm.verdict).toBe('PASS');
    const l = labels(norm);
    expect(l).toMatch(/Résistance de pointe R_b;k/);
    expect(l).toMatch(/Tassement estimé/);
    // Complétude (retour STARFIRE) : taux gouvernant + charge de fluage désormais affichés.
    expect(l).toMatch(/Taux de travail gouvernant/);
    expect(l).toMatch(/Charge de fluage/);
  });

  it('fail-closed : ni methode ni sens (paramètres de méthode) dans les libellés front', () => {
    const norm = normalizedOf('fondation-profonde-pieux', REAL_PIEUX);
    expectNoLeak(norm, ['methode', '"pmt"', '"sens"', '"comp"']);
  });

  it('durcissement : nom de vérification NON reconnu → libellé générique indexé, jamais brut', () => {
    const tampered = {
      ...REAL_PIEUX,
      verifications: [
        {
          nom: 'ELU portance — MÉTHODE_INTERNE_kc=1.3',
          Fd: 100,
          Rd: 200,
          taux: 0.5,
          ok: true,
        },
        { nom: 'ELS caractéristique', Fd: 1150, Rd: 1657.26, taux: 0.69, ok: true },
      ],
    };
    const norm = normalizedOf('fondation-profonde-pieux', tampered);
    const s = JSON.stringify(norm);
    expect(s).not.toContain('MÉTHODE_INTERNE');
    expect(s).not.toContain('kc=1.3');
    expect(s).toContain('Vérification 1'); // repli générique pour le nom non reconnu
    expect(s).toContain('ELS caractéristique'); // le nom EC7 reconnu passe intact
  });
});

describe('adaptCalcResult — radier (plaque/sol multicouche)', () => {
  it('given betaGov/nRafts, when adapté, then verdict NA (analyse) + tassements en mm', () => {
    const norm = normalizedOf('radier-plaque', REAL_RADIER);
    expect(norm.verdict).toBe('NA');
    expect(labels(norm)).toMatch(/Tassement maximal/);
    const beta = (norm.rows as CalcOutputRow[]).find((r) =>
      r.label.includes('Distorsion'),
    );
    expect(beta?.unit).toBe('‰');
  });

  it('complétude : affiche TOUS les diagnostics client-safe (intra, inclinaison, pente)', () => {
    const norm = normalizedOf('radier-plaque', REAL_RADIER);
    const l = labels(norm);
    // Diagnostics du RadierOutputSchema auparavant omis — désormais affichés (client-safe).
    expect(l).toMatch(/Distorsion intra-plaque/);
    expect(l).toMatch(/Inclinaison d'ensemble/);
    expect(l).toMatch(/Pente locale/);
    // Conditionnel : radier UNIQUE (nRafts=1) → pas de rang inter-plaques ni entre charges
    // (comme l'outil d'origine GEOPLAQUE_V10).
    expect(l).not.toMatch(/entre plaques/);
    expect(l).not.toMatch(/entre charges/);
  });

  it('multi-plaques : affiche distorsion entre plaques + entre charges voisines', () => {
    const multi = {
      ...REAL_RADIER,
      nRafts: 2,
      betaInter: 0.5,
      interDiff: 1.2,
      worstLoadPair: { beta: 0.8, ds: 2, L: 3, ki: 1, kj: 2, p1: null, p2: null },
    };
    const l = labels(normalizedOf('radier-plaque', multi));
    expect(l).toMatch(/Distorsion entre plaques/);
    expect(l).toMatch(/différentiel inter-plaques/);
    expect(l).toMatch(/entre charges voisines/);
  });
});

describe('adaptCalcResult — labo (classification GTR)', () => {
  it('given une classe, when adapté, then verdict NA + Classe GTR = A2 h (pas AA2)', () => {
    const norm = normalizedOf('labo-classification-gtr', REAL_LABO);
    expect(norm.verdict).toBe('NA');
    const classe = (norm.rows as CalcOutputRow[]).find((r) => r.label === 'Classe GTR');
    // Régression : ne JAMAIS re-dupliquer la lettre de famille (fam+code = 'AA2').
    expect(classe?.value).toBe('A2 h');
  });

  it('complétude : affiche les résultats mécaniques (eau, consistance, Proctor, œdo, cisaillement)', () => {
    const norm = normalizedOf('labo-classification-gtr', REAL_LABO);
    const l = labels(norm);
    expect(l).toMatch(/Teneur en eau naturelle/);
    expect(l).toMatch(/Indice de consistance/);
    expect(l).toMatch(/Teneur en eau optimale/);
    expect(l).toMatch(/Indice de compression Cc/);
    expect(l).toMatch(/Cohésion/);
    expect(l).toMatch(/Angle de frottement/);
  });

  it('chemin de décision : desc + path (allowlistés) affichés ; warn et clés brutes JAMAIS', () => {
    // Décision confidentialité (avis ingenieur-securite) : desc (description normative
    // NF P 11-300) et path (seuils publics + valeurs déjà exposées) sont client-safe.
    const norm = normalizedOf('labo-classification-gtr', REAL_LABO);
    const s = JSON.stringify(norm);
    expect(s).toContain('Sables fins'); // desc affiché
    expect(s).toContain('sol fin → famille A'); // path (gabarit allowlisté)
    expect(s).toContain('préférentiel'); // Ip → sous-classe
    // warn (note de maturité) et clés brutes / état interne : JAMAIS exposés
    expectNoLeak(norm, ['"warn"', '"path"', '"desc"', '"full"', 'cbrType']);
  });

  it('allowlist fail-closed : un libellé de path HORS gabarit (coefficient injecté) est écarté', () => {
    const injected = {
      ...REAL_LABO,
      classe: {
        ...REAL_LABO.classe,
        desc: 'DESC_INJECTE = 7.7', // desc hors ensemble NF P 11-300 → écarté
        warn: ['Distinction C1/C2 : heuristique provisoire.'],
        path: [
          'Passant 80µm = 52.0 % > 35 % → sol fin → famille A.', // légitime → affiché
          'facteur interne = 1.3 → A2.', // injection hors gabarit → écartée
          'Ip = kc=1.3 (préférentiel) → A2.', // coefficient dans un slot → écartée
        ],
      },
    };
    const norm = normalizedOf('labo-classification-gtr', injected);
    const s = JSON.stringify(norm);
    expect(s).toContain('sol fin → famille A'); // le libellé légitime passe
    expect(s.includes('facteur interne')).toBe(false); // injection écartée (fail-closed)
    expect(s.includes('kc=1.3')).toBe(false); // coefficient dans slot écarté
    expect(s.includes('DESC_INJECTE')).toBe(false); // desc hors allowlist écarté
    expect(s.includes('heuristique provisoire')).toBe(false); // warn jamais affiché
  });

  it('complétude : affiche les essais granulats + mécaniques + masses volumiques quand renseignés', () => {
    const LABO_FULL = {
      erreur: null,
      warnings: [],
      Cu: 12.4,
      Cc: 1.2,
      mf: 2.3,
      rhos: 2.65,
      rho_app: 1.9,
      rhod_app: 1.7,
      gonfl: 1.5,
      es: 65,
      la: 25,
      sz: 22,
      mde: 18,
      wa: 1.2,
      so3: 0.3,
      qu: 2.5,
      cu_uu: 45,
      k: 1.2e-7,
      classe: { fam: 'B', code: 'B5', full: 'B5', desc: 'x', path: ['y'], warn: [], etat: null, stApplies: false, rNote: null },
    };
    const norm = normalizedOf('labo-classification-gtr', LABO_FULL);
    const l = labels(norm);
    expect(l).toMatch(/Los Angeles/);
    expect(l).toMatch(/Micro-Deval/);
    expect(l).toMatch(/Fragmentation SZ/);
    expect(l).toMatch(/Équivalent de sable/);
    expect(l).toMatch(/Teneur en sulfates/);
    expect(l).toMatch(/compression simple/);
    expect(l).toMatch(/Cohésion non drainée/);
    expect(l).toMatch(/Perméabilité/);
    expect(l).toMatch(/Masse volumique des grains/);
    expect(l).toMatch(/Gonflement/);
    // clés brutes / warn non exposés (les VALEURS client-safe, elles, le sont).
    expectNoLeak(norm, ['"path"', '"warn"', 'cbrType']);
  });
});

describe('adaptCalcResult — pressiomètre Ménard (dépouillement)', () => {
  it('given categorie+pL, when adapté, then verdict NA + p_L en bar + catégorie textuelle', () => {
    const norm = normalizedOf('pressiometre-menard', REAL_PRESSIOMETRE);
    expect(norm.verdict).toBe('NA');
    const pl = (norm.rows as CalcOutputRow[]).find(
      (r) => r.label === 'Pression limite p_L',
    );
    expect(pl?.unit).toBe('bar');
    expect(labels(norm)).toMatch(/Catégorie de sol/);
    expect(JSON.stringify(norm)).toContain('Sol mou (cat. B)');
  });

  it('affiche α (Ménard) et le module d Young Ey = EM/α (décision titulaire : intermédiaires publics)', () => {
    // Retour STARFIRE + décision titulaire (mémoire roadsen-details-transparents-rescope-s8) :
    // exposer les grandeurs PUBLIQUES du dépouillement — α et Ey figurent dans l'outil
    // d'origine (Profil : colonne α ; renderResults : « Ey = E/α »). Ce sont des RÉSULTATS,
    // pas des intermédiaires de méthode (courbe corrigée / calage / pente restent serveur).
    const norm = normalizedOf('pressiometre-menard', REAL_PRESSIOMETRE);
    const rows = norm.rows as CalcOutputRow[];
    const alpha = rows.find((r) => /coefficient rhéologique α/i.test(r.label));
    expect(alpha?.value).toBe(0.67);
    const ey = rows.find((r) => /module.*young.*E_?y|E_?y.*=.*E_?M/i.test(r.label));
    expect(ey?.value).toBe(5.0842);
    expect(ey?.unit).toBe('MPa');
  });

  it('fail-closed : ni pLDirect, ni code catégorie brut ne fuit (raw keys)', () => {
    // α/Ey sont désormais exposés comme VALEURS de ligne (label+value), jamais comme
    // clés brutes spreadées : le drapeau pLDirect et le CODE catégorie restent masqués.
    const norm = normalizedOf('pressiometre-menard', REAL_PRESSIOMETRE);
    expectNoLeak(norm, ['pLDirect', '"categorie"']);
  });
});

// ── Nouvelles sorties pieux : frottement négatif (#94) + béton (#95) ──────────────

/** Fixture de base pieux complète (tous champs null si non demandés). */
const REAL_PIEUX_BASE = {
  ...REAL_PIEUX,
  Gsn: null,
  Nmax: null,
  pointNeutre: null,
  betonApplicable: null,
  betonOkELU: null,
  betonOkELS: null,
  betonTauxELU: null,
  betonTauxELS: null,
  betonFcd: null,
};

/** Fixture avec frottement négatif calculé. */
const REAL_PIEUX_DOWNDRAG = {
  ...REAL_PIEUX_BASE,
  Gsn: 120.5,
  Nmax: 920.5,
  pointNeutre: 7.3,
};

/** Fixture avec vérification béton applicable et satisfaite à l'ELU, dépassée à l'ELS. */
const REAL_PIEUX_BETON_OK = {
  ...REAL_PIEUX_BASE,
  betonApplicable: true,
  betonOkELU: true,
  betonOkELS: false,
  betonTauxELU: 0.75,
  betonTauxELS: 1.05,
  betonFcd: 16.67,
};

/** Fixture avec vérification béton non applicable (traction ou catégorie exclue). */
const REAL_PIEUX_BETON_NA = {
  ...REAL_PIEUX_BASE,
  betonApplicable: false,
  betonOkELU: null,
  betonOkELS: null,
  betonTauxELU: null,
  betonTauxELS: null,
  betonFcd: null,
};

describe('adaptCalcResult — pieux : frottement négatif (#94)', () => {
  it(
    'given Gsn/Nmax/pointNeutre non-null, ' +
      'when adapté, then lignes downdrag présentes dans les rows',
    () => {
      const norm = normalizedOf('fondation-profonde-pieux', REAL_PIEUX_DOWNDRAG);
      const l = labels(norm);
      expect(l).toMatch(/Charge de frottement négatif G_sn/);
      expect(l).toMatch(/Effort axial maximal N_max/);
      expect(l).toMatch(/Profondeur du point neutre z_N/);
      const gsn = (norm.rows as CalcOutputRow[]).find((r) => r.label.includes('G_sn'));
      expect(gsn?.unit).toBe('kN');
      expect(gsn?.value).toBe(120.5);
      const zN = (norm.rows as CalcOutputRow[]).find((r) =>
        r.label.includes('point neutre'),
      );
      expect(zN?.unit).toBe('m');
    },
  );

  it('given Gsn/Nmax/pointNeutre null, when adapté, then AUCUNE ligne downdrag', () => {
    const norm = normalizedOf('fondation-profonde-pieux', REAL_PIEUX_BASE);
    const l = labels(norm);
    expect(l).not.toMatch(/G_sn/);
    expect(l).not.toMatch(/N_max/);
    expect(l).not.toMatch(/point neutre/);
  });

  it('given champs downdrag absents (undefined), when adapté, then AUCUNE ligne downdrag ni NaN', () => {
    // Cas de régression : fixture REAL_PIEUX sans les nouvelles clés
    const norm = normalizedOf('fondation-profonde-pieux', REAL_PIEUX);
    expect(JSON.stringify(norm)).not.toContain('NaN');
    expect(JSON.stringify(norm)).not.toContain('null');
    const l = labels(norm);
    expect(l).not.toMatch(/G_sn/);
    expect(l).not.toMatch(/N_max/);
    expect(l).not.toMatch(/Béton/);
  });
});

describe('adaptCalcResult — pieux : vérification béton (#95)', () => {
  it(
    'given betonApplicable=true + taux ELU/ELS, ' +
      'when adapté, then lignes béton présentes avec statuts ok/fail',
    () => {
      const norm = normalizedOf('fondation-profonde-pieux', REAL_PIEUX_BETON_OK);
      const l = labels(norm);
      expect(l).toMatch(/Taux béton ELU/);
      expect(l).toMatch(/Taux béton ELS/);
      expect(l).toMatch(/Résistance béton f_cd/);
      const tELU = (norm.rows as CalcOutputRow[]).find((r) =>
        r.label.includes('Taux béton ELU'),
      );
      expect(tELU?.unit).toBe('%');
      expect(tELU?.value).toBeCloseTo(75, 1);
      expect(tELU?.status).toBe('ok');
      const tELS = (norm.rows as CalcOutputRow[]).find((r) =>
        r.label.includes('Taux béton ELS'),
      );
      expect(tELS?.status).toBe('fail');
      const fcd = (norm.rows as CalcOutputRow[]).find(
        (r) => r.label === 'Résistance béton f_cd',
      );
      expect(fcd?.unit).toBe('MPa');
    },
  );

  it(
    'given betonApplicable=false (traction / catégorie exclue), ' +
      'when adapté, then ligne « Non applicable » + aucun taux NaN',
    () => {
      const norm = normalizedOf('fondation-profonde-pieux', REAL_PIEUX_BETON_NA);
      const l = labels(norm);
      expect(l).toMatch(/Vérification béton/);
      const row = (norm.rows as CalcOutputRow[]).find((r) =>
        r.label.includes('Vérification béton'),
      );
      expect(row?.value).toBe('Non applicable');
      expect(JSON.stringify(norm)).not.toContain('NaN');
    },
  );

  it('given betonApplicable=null (béton non demandé), when adapté, then AUCUNE ligne béton', () => {
    const norm = normalizedOf('fondation-profonde-pieux', REAL_PIEUX_BASE);
    const l = labels(norm);
    expect(l).not.toMatch(/Béton|béton/);
    expect(JSON.stringify(norm)).not.toContain('NaN');
  });

  it('fail-closed : ni betonOkELU, ni betonOkELS booléens bruts dans la sortie sérialisée', () => {
    // On vérifie que seul le statut ok/fail passe, jamais le booléen brut avec la clé moteur
    const norm = normalizedOf('fondation-profonde-pieux', REAL_PIEUX_BETON_OK);
    expectNoLeak(norm, [
      '"betonOkELU"',
      '"betonOkELS"',
      '"betonApplicable"',
      '"betonTauxELU"',
      '"betonTauxELS"',
      '"betonFcd"',
    ]);
  });
});

// ── MAJEUR-2 : note de découplage frottement négatif ─────────────────────────

describe('adaptCalcResult — pieux : note de découplage downdrag (MAJEUR-2)', () => {
  it(
    'given Gsn/Nmax non-null (downdrag calculé), ' +
      'when adapté, then une note de découplage est présente dans les rows',
    () => {
      const norm = normalizedOf('fondation-profonde-pieux', REAL_PIEUX_DOWNDRAG);
      const note = (norm.rows as CalcOutputRow[]).find(
        (r) => typeof r.value === 'string' && r.value.includes('non intégré au verdict'),
      );
      expect(
        note,
        'la note de découplage doit être présente quand le downdrag est calculé',
      ).toBeDefined();
    },
  );

  it(
    'given Gsn/Nmax null (pas de downdrag), ' +
      'when adapté, then aucune note de découplage',
    () => {
      const norm = normalizedOf('fondation-profonde-pieux', REAL_PIEUX_BASE);
      const note = (norm.rows as CalcOutputRow[]).find(
        (r) => typeof r.value === 'string' && r.value.includes('non intégré au verdict'),
      );
      expect(note, 'aucune note de découplage quand downdrag absent').toBeUndefined();
    },
  );

  it('fail-closed : la note ne contient aucune valeur numérique issue du moteur (Gsn, Nmax, pointNeutre)', () => {
    const norm = normalizedOf('fondation-profonde-pieux', REAL_PIEUX_DOWNDRAG);
    const note = (norm.rows as CalcOutputRow[]).find(
      (r) => typeof r.value === 'string' && r.value.includes('non intégré au verdict'),
    );
    const v = String(note?.value ?? '');
    // Les valeurs de REAL_PIEUX_DOWNDRAG ne doivent pas apparaître dans le texte
    expect(v).not.toContain('120.5'); // Gsn
    expect(v).not.toContain('920.5'); // Nmax
    expect(v).not.toContain('7.3'); // pointNeutre
    // Pas de fuite des clés confidentielles du moteur dans la sérialisation complète
    expectNoLeak(norm, ['"Gsn"', '"Nmax"', '"pointNeutre"', 'KtanD', 'sigmaV']);
  });
});

// ── MINEUR-2 : libellé Rc;d / Rt;d conditionnel selon sens ───────────────────

describe('adaptCalcResult — pieux : libellé Rc;d vs Rt;d selon sens (MINEUR-2)', () => {
  it(
    'given sens="comp" (compression, défaut), ' +
      'when adapté, then le libellé porte Rc;d',
    () => {
      // REAL_PIEUX a sens: 'comp'
      const norm = normalizedOf('fondation-profonde-pieux', REAL_PIEUX);
      expect(labels(norm)).toMatch(/R_c;d/);
      expect(labels(norm)).not.toMatch(/R_t;d/);
    },
  );

  it(
    'given sens="trac" (traction), ' +
      'when adapté, then le libellé porte Rt;d (pas Rc;d)',
    () => {
      const tracOutput = { ...REAL_PIEUX, sens: 'trac', RcD: 1200 };
      const norm = normalizedOf('fondation-profonde-pieux', tracOutput);
      expect(labels(norm)).toMatch(/R_t;d/);
      expect(labels(norm)).not.toMatch(/R_c;d/);
    },
  );

  it('fail-closed : la valeur "trac" ou "comp" de sens ne traverse jamais le navigateur', () => {
    const tracOutput = { ...REAL_PIEUX, sens: 'trac' };
    const norm = normalizedOf('fondation-profonde-pieux', tracOutput);
    // "trac" est la valeur interne — ne doit pas apparaître dans la sérialisation
    expectNoLeak(norm, ['"trac"', '"sens"', '"comp"']);
  });
});

describe('adaptCalcResult — PressioPro étalonnage (Vs/Pe/a)', () => {
  // Sortie SERVEUR whitelistée (PressioEtalonnageOutputSchema) : Vs/Pe/a/R2/rms.
  const REAL_ETAL = { Vs: 520.4, Pe: 0.83, a: 30.1, R2: 0.9997, rms: 0.42 };

  it('given une sortie {Vs, Pe, a}, when adapté, then verdict NA + rows Vs/Pe/a', () => {
    const norm = normalizedOf('pressio-etalonnage', REAL_ETAL);
    expect(norm.verdict).toBe('NA');
    expect(labels(norm)).toMatch(/Vs/);
    expect(labels(norm)).toMatch(/Pe/);
    expect(labels(norm)).toMatch(/Pente d’air a/);
    // a exposé en cm³/bar ET en cm³/MPa (×10 indicatif)
    const aBar = (norm.rows as CalcOutputRow[]).find((r) => /cm³\/bar/.test(r.unit));
    expect(aBar?.value).toBe(30.1);
    const aMPa = (norm.rows as CalcOutputRow[]).find((r) => /cm³\/MPa/.test(r.unit));
    expect(aMPa?.value).toBeCloseTo(301, 6);
  });

  it('ne fuite aucun intermédiaire de régression même s’il survivait au strip serveur', () => {
    const leaky = { ...REAL_ETAL, pts: [{ p: 0, v: 520 }], residuals: [{ p: 0, res: 0 }], V_pe: 624, Vs_reel: 520 };
    const norm = normalizedOf('pressio-etalonnage', leaky);
    expectNoLeak(norm, ['"pts"', '"residuals"', '"V_pe"', '"Vs_reel"']);
  });
});

describe('adaptCalcResult — PressioPro calibrage (a)', () => {
  // Sortie SERVEUR whitelistée (PressioCalibrageOutputSchema) : a/R2/rms.
  const REAL_CALIB = { a: 0.48, R2: 0.9991, rms: 0.06 };

  it('given une sortie {a, R2, rms} sans Vs, when adapté, then verdict NA + coefficient a', () => {
    const norm = normalizedOf('pressio-calibrage', REAL_CALIB);
    expect(norm.verdict).toBe('NA');
    expect(labels(norm)).toMatch(/Coefficient de calibrage a/);
    const aBar = (norm.rows as CalcOutputRow[]).find((r) => /cm³\/bar/.test(r.unit));
    expect(aBar?.value).toBe(0.48);
    const aMPa = (norm.rows as CalcOutputRow[]).find((r) => /cm³\/MPa/.test(r.unit));
    expect(aMPa?.value).toBeCloseTo(4.8, 6);
  });

  it('ne fuite jamais les coefficients polynomiaux c0/c1/c2 (méthode)', () => {
    const leaky = { ...REAL_CALIB, c0: 0.1, c1: 0.4, c2: -0.002, pts: [{ p: 1, v: 1 }], residuals: [] };
    const norm = normalizedOf('pressio-calibrage', leaky);
    expectNoLeak(norm, ['"c0"', '"c1"', '"c2"', '"pts"', '"residuals"']);
  });
});
