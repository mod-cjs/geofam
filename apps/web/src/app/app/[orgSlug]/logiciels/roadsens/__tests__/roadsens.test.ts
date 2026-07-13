/**
 * Tests — page ROADSENS (logiciel dimensionnement chaussées)
 *
 * DoD §9 : given/when/then, chemins nominaux + bords.
 * DoD §8 : aucun import @roadsen/engines — fonctions purement display/payload.
 *
 * Portée :
 * - computeNE : formule NE publique AGEROUTE 2015 (display uniquement)
 * - neClass : classification NE
 * - buildBurmisterPayload : structure du payload API (clés, types)
 * - extractBurmisterKpis : extraction KPIs depuis sortie normalisée (étape 2)
 * - buildBurmisterDiagnostics : messages diagnostics allowlist fail-closed (étape 2)
 */

import { describe, it, expect } from 'vitest';

import {
  computeNE,
  computeCcum,
  neClass,
  presetTrafficClass,
  formatNeExponent,
  buildBurmisterPayload,
  buildPresetConditions,
  extractBurmisterKpis,
  buildBurmisterDiagnostics,
  resolveRisk,
  effectiveNE,
  uRisk,
  ROADSENS_PRESETS,
  buildLayersFromPreset,
  catalogueMaterialAt,
  CAT,
  reportRowValue,
  tabDetailsMode,
} from '../page';

import { adaptCalcResult } from '@/lib/api/adapters';
import type { NormalizedCalcOutput } from '@/lib/api/types';

// ---------------------------------------------------------------------------
// computeNE — NE cumulé (formule AGEROUTE 2015 §3.2, affichage)
// ---------------------------------------------------------------------------

describe('computeNE', () => {
  it('given τ=0 returns NE = 365 × T × N × C × dir × tv', () => {
    // GIVEN : trafic sans croissance
    const traffic = { T: 150, C: 0.9, N: 20, tau: 0, dir: 1.0, tv: 1.0 };
    // WHEN
    const ne = computeNE(traffic);
    // THEN : cumul géométrique = N quand τ≈0
    expect(ne).toBeCloseTo(365 * 150 * 20 * 0.9 * 1.0 * 1.0, -2);
  });

  it('given τ=4%/an et N=20ans retourne un NE supérieur au cas sans croissance', () => {
    const trafficFlat = { T: 150, C: 0.9, N: 20, tau: 0, dir: 1.0, tv: 1.0 };
    const trafficGrow = { T: 150, C: 0.9, N: 20, tau: 4.0, dir: 1.0, tv: 1.0 };
    // WHEN
    const neFlat = computeNE(trafficFlat);
    const neGrow = computeNE(trafficGrow);
    // THEN : la croissance augmente le NE
    expect(neGrow).toBeGreaterThan(neFlat);
  });

  it('given dir=0.5 retourne la moitié du NE unidirectionnel', () => {
    const base = { T: 150, C: 1.0, N: 20, tau: 0, dir: 1.0, tv: 1.0 };
    const half = { T: 150, C: 1.0, N: 20, tau: 0, dir: 0.5, tv: 1.0 };
    // WHEN / THEN
    expect(computeNE(half)).toBeCloseTo(computeNE(base) / 2, 0);
  });

  it('retourne 0 si T=0', () => {
    const traffic = { T: 0, C: 0.9, N: 20, tau: 4, dir: 1, tv: 1 };
    expect(computeNE(traffic)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// neClass — classification du trafic
// ---------------------------------------------------------------------------

describe('neClass', () => {
  const cases: Array<[number, string]> = [
    [0.05e6, 'C1'],
    [0.1e6, 'C2'], // valeur limite : ≥ 0,1 → C2
    [0.3e6, 'C3'],
    [1e6, 'C4'],
    [3e6, 'C5'],
    [10e6, 'C6'],
    [30e6, 'C7'],
    [50e6, 'C8'],
    [100e6, '>C8'],
    [200e6, '>C8'],
  ];

  cases.forEach(([ne, expected]) => {
    it(`NE=${ne / 1e6}×10⁶ → classe ${expected}`, () => {
      expect(neClass(ne)).toBe(expected);
    });
  });
});

// ---------------------------------------------------------------------------
// buildBurmisterPayload — structure du payload API
// ---------------------------------------------------------------------------

describe('buildBurmisterPayload', () => {
  const layers = [
    { id: 1, mat: 'BBSG1', h: 0.06, E: 1512, nu: 0.45, iface: 'auto' as const },
    { id: 2, mat: 'GB3', h: 0.1, E: 2588, nu: 0.45, iface: 'auto' as const },
    { id: 3, mat: 'GL1', h: 0.25, E: 200, nu: 0.35, iface: 'auto' as const },
  ];
  const pf = { cls: 'PF2', E: 50, nu: 0.35 };
  const traffic = { T: 150, C: 0.9, N: 20, tau: 4.0, dir: 1.0, tv: 1.0 };
  const load = {
    p: 0.662,
    a: 0.125,
    d: 0.375,
    r: 'auto',
    rCustom: '',
    sh: 'auto',
    ks: 'auto',
    gntAuto: true,
    ifaceAuto: true,
    neDirect: false,
    neDirectValue: 0,
    fatigueOverrides: {},
  };

  it('contains layers array of correct length', () => {
    const payload = buildBurmisterPayload(layers, pf, traffic, load) as Record<
      string,
      unknown
    >;
    expect(Array.isArray(payload.layers)).toBe(true);
    expect((payload.layers as unknown[]).length).toBe(3);
  });

  it('each layer has mat, E, nu, h fields', () => {
    const payload = buildBurmisterPayload(layers, pf, traffic, load) as Record<
      string,
      unknown
    >;
    const l0 = (payload.layers as Array<Record<string, unknown>>)[0];
    expect(l0).toHaveProperty('mat', 'BBSG1');
    expect(l0).toHaveProperty('E', 1512);
    expect(l0).toHaveProperty('nu', 0.45);
    expect(l0).toHaveProperty('h', 0.06);
  });

  it('subgrade contains E and nu', () => {
    const payload = buildBurmisterPayload(layers, pf, traffic, load) as Record<
      string,
      unknown
    >;
    const sg = payload.subgrade as Record<string, unknown>;
    expect(sg.E).toBe(50);
    expect(sg.nu).toBe(0.35);
    expect(sg.cls).toBe('PF2');
  });

  it('traffic fields are all present', () => {
    const payload = buildBurmisterPayload(layers, pf, traffic, load) as Record<
      string,
      unknown
    >;
    const tr = payload.traffic as Record<string, unknown>;
    expect(tr).toMatchObject({ T: 150, C: 0.9, N: 20, tau: 4.0, dir: 1.0, tv: 1.0 });
  });

  it('load.r is string "auto" when auto is selected', () => {
    const payload = buildBurmisterPayload(layers, pf, traffic, load) as Record<
      string,
      unknown
    >;
    const ld = payload.load as Record<string, unknown>;
    expect(ld.r).toBe('auto');
  });

  it('load.r is a number when a numeric choice is selected', () => {
    const loadNumeric = { ...load, r: '10' };
    const payload = buildBurmisterPayload(layers, pf, traffic, loadNumeric) as Record<
      string,
      unknown
    >;
    const ld = payload.load as Record<string, unknown>;
    expect(typeof ld.r).toBe('number');
    expect(ld.r).toBe(10);
  });

  it('does not contain any engine coefficient (e6, b, kc)', () => {
    // Garde DoD §8 : le payload ne doit pas transporter de coefficients de fatigue
    const payload = JSON.stringify(buildBurmisterPayload(layers, pf, traffic, load));
    expect(payload).not.toContain('"e6"');
    expect(payload).not.toContain('"kc"');
    expect(payload).not.toContain('"s6"');
  });

  // -------------------------------------------------------------------------
  // GNT auto + interface (#87 étapes 1/2 et 2/2) — activation de la définitive
  // -------------------------------------------------------------------------

  it('given gntAuto/ifaceAuto=true (défaut), le payload load les transporte', () => {
    const payload = buildBurmisterPayload(layers, pf, traffic, load) as Record<
      string,
      unknown
    >;
    const ld = payload.load as Record<string, unknown>;
    expect(ld.gntAuto).toBe(true);
    expect(ld.ifaceAuto).toBe(true);
  });

  it('given gntAuto/ifaceAuto=false, le payload les transporte tels quels (pas de valeur imposée)', () => {
    const loadOff = { ...load, gntAuto: false, ifaceAuto: false };
    const payload = buildBurmisterPayload(layers, pf, traffic, loadOff) as Record<
      string,
      unknown
    >;
    const ld = payload.load as Record<string, unknown>;
    expect(ld.gntAuto).toBe(false);
    expect(ld.ifaceAuto).toBe(false);
  });

  it('chaque couche porte un champ iface (défaut "auto")', () => {
    const payload = buildBurmisterPayload(layers, pf, traffic, load) as Record<
      string,
      unknown
    >;
    const ls = payload.layers as Array<Record<string, unknown>>;
    ls.forEach((l) => expect(l.iface).toBe('auto'));
  });

  it('une interface imposée (ex. "glissante") traverse jusqu’au payload', () => {
    const layersImposed = [
      { ...layers[0], iface: 'glissante' as const },
      layers[1],
      layers[2],
    ];
    const payload = buildBurmisterPayload(layersImposed, pf, traffic, load) as Record<
      string,
      unknown
    >;
    const ls = payload.layers as Array<Record<string, unknown>>;
    expect(ls[0].iface).toBe('glissante');
    expect(ls[1].iface).toBe('auto');
  });

  // -------------------------------------------------------------------------
  // materialsRev — rebase définitive (#93 sous-port 3c) : envoyé par défaut
  // -------------------------------------------------------------------------

  it('given le rebase définitive, load.materialsRev = "definitive" par défaut', () => {
    const payload = buildBurmisterPayload(layers, pf, traffic, load) as Record<
      string,
      unknown
    >;
    const ld = payload.load as Record<string, unknown>;
    expect(ld.materialsRev).toBe('definitive');
  });

  // -------------------------------------------------------------------------
  // NE direct (#93 sous-port 3b) — neForce absent par défaut, présent si activé
  // -------------------------------------------------------------------------

  it('given neDirect=false (défaut), le payload ne porte pas neForce', () => {
    const payload = buildBurmisterPayload(layers, pf, traffic, load) as Record<
      string,
      unknown
    >;
    const ld = payload.load as Record<string, unknown>;
    expect(ld).not.toHaveProperty('neForce');
  });

  it('given neDirect=true avec une valeur positive, le payload porte neForce', () => {
    const loadNeDirect = { ...load, neDirect: true, neDirectValue: 3e7 };
    const payload = buildBurmisterPayload(layers, pf, traffic, loadNeDirect) as Record<
      string,
      unknown
    >;
    const ld = payload.load as Record<string, unknown>;
    expect(ld.neForce).toBe(3e7);
  });

  it('given neDirect=true mais valeur invalide (0/NaN), neForce absent (fail-closed)', () => {
    const loadInvalid = { ...load, neDirect: true, neDirectValue: 0 };
    const payload = buildBurmisterPayload(layers, pf, traffic, loadInvalid) as Record<
      string,
      unknown
    >;
    const ld = payload.load as Record<string, unknown>;
    expect(ld).not.toHaveProperty('neForce');
  });

  // -------------------------------------------------------------------------
  // Risque personnalisé — r='custom' + rCustom (saisie libre)
  // -------------------------------------------------------------------------

  it('given r="custom" avec rCustom="18", le payload porte le nombre 18', () => {
    const loadCustom = { ...load, r: 'custom', rCustom: '18' };
    const payload = buildBurmisterPayload(layers, pf, traffic, loadCustom) as Record<
      string,
      unknown
    >;
    const ld = payload.load as Record<string, unknown>;
    expect(ld.r).toBe(18);
  });

  it('given r="custom" avec rCustom vide/invalide, retombe sur "auto" (fail-closed)', () => {
    const loadCustom = { ...load, r: 'custom', rCustom: '' };
    const payload = buildBurmisterPayload(layers, pf, traffic, loadCustom) as Record<
      string,
      unknown
    >;
    const ld = payload.load as Record<string, unknown>;
    expect(ld.r).toBe('auto');
  });

  // -------------------------------------------------------------------------
  // fatigueOverrides — surcharge ε₆/σ₆ par matériau (#93 sous-port 3d)
  // -------------------------------------------------------------------------

  it('given fatigueOverrides vide (défaut), le payload ne porte pas fatigueOverrides', () => {
    const payload = buildBurmisterPayload(layers, pf, traffic, load) as Record<
      string,
      unknown
    >;
    const ld = payload.load as Record<string, unknown>;
    expect(ld).not.toHaveProperty('fatigueOverrides');
  });

  it('given un e6 édité pour un matériau, le payload porte fatigueOverrides=[{mat,e6}]', () => {
    const loadOverride = { ...load, fatigueOverrides: { BBSG1: { e6: 110 } } };
    const payload = buildBurmisterPayload(layers, pf, traffic, loadOverride) as Record<
      string,
      unknown
    >;
    const ld = payload.load as Record<string, unknown>;
    expect(ld.fatigueOverrides).toEqual([{ mat: 'BBSG1', e6: 110 }]);
  });

  it('given un s6 édité pour un matériau MTLH, le payload porte fatigueOverrides=[{mat,s6}]', () => {
    const loadOverride = { ...load, fatigueOverrides: { GLc2: { s6: 0.4 } } };
    const payload = buildBurmisterPayload(layers, pf, traffic, loadOverride) as Record<
      string,
      unknown
    >;
    const ld = payload.load as Record<string, unknown>;
    expect(ld.fatigueOverrides).toEqual([{ mat: 'GLc2', s6: 0.4 }]);
  });

  it('given plusieurs matériaux édités, le payload porte toutes les entrées', () => {
    const loadOverride = {
      ...load,
      fatigueOverrides: { BBSG1: { e6: 110 }, GLc2: { s6: 0.4 } },
    };
    const payload = buildBurmisterPayload(layers, pf, traffic, loadOverride) as Record<
      string,
      unknown
    >;
    const ld = payload.load as Record<string, unknown>;
    expect(ld.fatigueOverrides).toEqual([
      { mat: 'BBSG1', e6: 110 },
      { mat: 'GLc2', s6: 0.4 },
    ]);
  });

  it('given une entrée fatigueOverrides sans e6 ni s6 défini, elle est omise (fail-closed)', () => {
    const loadOverride = { ...load, fatigueOverrides: { BBSG1: {} } };
    const payload = buildBurmisterPayload(layers, pf, traffic, loadOverride) as Record<
      string,
      unknown
    >;
    const ld = payload.load as Record<string, unknown>;
    expect(ld).not.toHaveProperty('fatigueOverrides');
  });
});

// ---------------------------------------------------------------------------
// resolveRisk — résolution du risque effectif depuis la saisie Load
// ---------------------------------------------------------------------------

describe('resolveRisk', () => {
  const base = {
    p: 0.662,
    a: 0.125,
    d: 0.375,
    r: 'auto',
    rCustom: '',
    sh: 'auto',
    ks: 'auto',
    gntAuto: true,
    ifaceAuto: true,
    neDirect: false,
    neDirectValue: 3e7,
    fatigueOverrides: {},
  };

  it('given r="auto", retourne "auto"', () => {
    expect(resolveRisk(base)).toBe('auto');
  });

  it('given r="10" (choix prédéfini), retourne le nombre 10', () => {
    expect(resolveRisk({ ...base, r: '10' })).toBe(10);
  });

  it('given r="50" (nouveau choix prédéfini), retourne le nombre 50', () => {
    expect(resolveRisk({ ...base, r: '50' })).toBe(50);
  });

  it('given r="custom" avec rCustom="7.5", retourne le nombre 7.5', () => {
    expect(resolveRisk({ ...base, r: 'custom', rCustom: '7.5' })).toBe(7.5);
  });

  it('given r="custom" avec rCustom non numérique, retombe sur "auto"', () => {
    expect(resolveRisk({ ...base, r: 'custom', rCustom: 'abc' })).toBe('auto');
  });

  it('given r="custom" avec rCustom négatif ou nul, retombe sur "auto" (fail-closed)', () => {
    expect(resolveRisk({ ...base, r: 'custom', rCustom: '0' })).toBe('auto');
    expect(resolveRisk({ ...base, r: 'custom', rCustom: '-5' })).toBe('auto');
  });
});

// ---------------------------------------------------------------------------
// effectiveNE — NE affiché (estimation), tient compte du NE direct (#93 3b)
// ---------------------------------------------------------------------------

describe('effectiveNE', () => {
  const traffic = { T: 150, C: 0.9, N: 20, tau: 4.0, dir: 1.0, tv: 1.0 };
  const loadBase = {
    p: 0.662,
    a: 0.125,
    d: 0.375,
    r: 'auto',
    rCustom: '',
    sh: 'auto',
    ks: 'auto',
    gntAuto: true,
    ifaceAuto: true,
    neDirect: false,
    neDirectValue: 3e7,
    fatigueOverrides: {},
  };

  it('given neDirect=false, retourne computeNE(traffic)', () => {
    expect(effectiveNE(traffic, loadBase)).toBeCloseTo(computeNE(traffic), 0);
  });

  it('given neDirect=true, retourne neDirectValue au lieu de computeNE(traffic)', () => {
    const load = { ...loadBase, neDirect: true, neDirectValue: 3e7 };
    expect(effectiveNE(traffic, load)).toBe(3e7);
  });

  it('given neDirect=true mais neDirectValue invalide, retombe sur computeNE(traffic)', () => {
    const load = { ...loadBase, neDirect: true, neDirectValue: 0 };
    expect(effectiveNE(traffic, load)).toBeCloseTo(computeNE(traffic), 0);
  });
});

// ---------------------------------------------------------------------------
// uRisk — quantile u_r associé au risque r (%) — affichage informatif seul
// (algorithme d'Acklam, formule statistique publique — pas un coefficient de
// calage AGEROUTE confidentiel)
// ---------------------------------------------------------------------------

describe('uRisk', () => {
  it('retourne les valeurs catalogue exactes pour 5/10/15/25/50 %', () => {
    expect(uRisk(5)).toBeCloseTo(1.645, 3);
    expect(uRisk(10)).toBeCloseTo(1.282, 3);
    expect(uRisk(15)).toBeCloseTo(1.036, 3);
    expect(uRisk(25)).toBeCloseTo(0.674, 3);
    expect(uRisk(50)).toBeCloseTo(0.0, 3);
  });

  it('pour un risque hors table (ex. 18 %), calcule via la loi normale inverse', () => {
    const u = uRisk(18);
    // u_18% doit être strictement entre u_25%=0.674 et u_15%=1.036 (monotone décroissant)
    expect(u).toBeGreaterThan(0.674);
    expect(u).toBeLessThan(1.036);
  });

  it('est décroissant : un risque plus élevé donne un quantile plus faible', () => {
    expect(uRisk(5)).toBeGreaterThan(uRisk(10));
    expect(uRisk(10)).toBeGreaterThan(uRisk(25));
    expect(uRisk(25)).toBeGreaterThan(uRisk(50));
  });
});

// ---------------------------------------------------------------------------
// ROADSENS_PRESETS / buildLayersFromPreset — cas de validation du catalogue
// ---------------------------------------------------------------------------

describe('ROADSENS_PRESETS', () => {
  it('contient au moins 15 cas de validation (catalogue + annexes)', () => {
    expect(ROADSENS_PRESETS.length).toBeGreaterThanOrEqual(15);
  });

  it('chaque preset a un id unique', () => {
    const ids = ROADSENS_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('chaque preset porte au moins une couche', () => {
    ROADSENS_PRESETS.forEach((p) => expect(p.layers.length).toBeGreaterThan(0));
  });
});

describe('buildLayersFromPreset', () => {
  it('construit des couches avec h en mètres depuis des cm', () => {
    const preset = ROADSENS_PRESETS.find((p) => p.id === 's2')!;
    const layers = buildLayersFromPreset(preset);
    expect(layers[0].mat).toBe('BBSG1');
    expect(layers[0].h).toBeCloseTo(0.08, 3); // 8 cm -> 0.08 m
    expect(layers[1].mat).toBe('GB3');
    expect(layers[1].h).toBeCloseTo(0.32, 3); // 32 cm
  });

  it('applique la surcharge de module E quand fournie (3e élément du tuple)', () => {
    const preset = ROADSENS_PRESETS.find((p) => p.id === 's3')!;
    const layers = buildLayersFromPreset(preset);
    const gntLayer = layers.find((l) => l.mat === 'GNT1')!;
    expect(gntLayer.E).toBe(400); // surcharge explicite du preset, pas le défaut catalogue
  });

  it('les identifiants de couche sont uniques et croissants', () => {
    const preset = ROADSENS_PRESETS.find((p) => p.id === 's6')!;
    const layers = buildLayersFromPreset(preset);
    const ids = layers.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ---------------------------------------------------------------------------
// catalogueMaterialAt / CAT — 14 familles (S1-S11, S13-S15), placement matériau
// ---------------------------------------------------------------------------

describe('catalogueMaterialAt', () => {
  it('la première couche est toujours le matériau de surface (top)', () => {
    expect(catalogueMaterialAt({ top: 'BBSG1', body: 'GB2' }, 0, 3)).toBe('BBSG1');
  });

  it('la dernière couche est le matériau "tail" quand défini', () => {
    expect(catalogueMaterialAt({ top: 'BBSG1', body: 'GB2', tail: 'GNT1' }, 3, 4)).toBe(
      'GNT1',
    );
  });

  it('la 2e couche est le matériau "mid" quand défini', () => {
    expect(catalogueMaterialAt({ top: 'BBSG1', mid: 'GLc2', body: 'GL2' }, 1, 3)).toBe(
      'GLc2',
    );
  });

  it('sans mid/tail, les couches intermédiaires retombent sur "body"', () => {
    expect(catalogueMaterialAt({ top: 'BBSG1', body: 'GB3' }, 2, 4)).toBe('GB3');
  });
});

describe('CAT — catalogue AGEROUTE 2015 (14 familles)', () => {
  it('contient exactement les familles S1-S11, S13, S14, S15', () => {
    const expected = [
      'S1',
      'S2',
      'S3',
      'S4',
      'S5',
      'S6',
      'S7',
      'S8',
      'S9',
      'S10',
      'S11',
      'S13',
      'S14',
      'S15',
    ];
    expect(Object.keys(CAT).sort()).toEqual(expected.sort());
  });

  it('chaque famille porte un label et un mapping matériau top/body', () => {
    Object.values(CAT).forEach((f) => {
      expect(typeof f.label).toBe('string');
      expect(f.m.top).toBeTruthy();
      expect(f.m.body).toBeTruthy();
    });
  });
});

// ---------------------------------------------------------------------------
// extractBurmisterKpis — extraction KPIs depuis la sortie normalisée
// ---------------------------------------------------------------------------

/** Fixture de sortie normalisée burmister — cas conforme via adaptCalcResult. */
const FIXTURE_BURMISTER_RAW_PASS = {
  conforme: true,
  NE: 1467314.82,
  famille: 'souple',
  epaisseurLiee: 0.34,
  epaisseurTotale: 0.46,
  fatigue: { ok: true, rigide: false, valeur: 96.4, admissible: 119.12 },
  ornierage: { ok: true, valeur: 412.5, admissible: 600 },
};

/** Fixture de sortie normalisee burmister — cas non conforme. */
const FIXTURE_BURMISTER_RAW_FAIL = {
  conforme: false,
  NE: 3200000,
  famille: 'bitumineuse epaisse',
  epaisseurLiee: 0.16,
  epaisseurTotale: 0.28,
  fatigue: { ok: false, rigide: false, valeur: 119.12, admissible: 96.4 },
  ornierage: { ok: true, valeur: 412.5, admissible: 600 },
};

function adaptRaw(output: unknown): NormalizedCalcOutput | null {
  const r = adaptCalcResult({
    id: 'test',
    projectId: 'p1',
    orgId: 'o1',
    engineId: 'chaussee-burmister',
    input: {},
    output,
    createdAt: new Date().toISOString(),
  });
  return r.output as NormalizedCalcOutput | null;
}

describe('extractBurmisterKpis', () => {
  it('given null output, returns null', () => {
    expect(extractBurmisterKpis(null)).toBeNull();
  });

  it('given output sans rows, returns null', () => {
    expect(extractBurmisterKpis({ verdict: 'PASS' })).toBeNull();
  });

  it('given sortie PASS reelle (via adaptCalcResult), extrait hLie_cm et hTotal_cm', () => {
    // GIVEN : sortie brute burmister passee par adaptCalcResult (normalisation reelle)
    const normalized = adaptRaw(FIXTURE_BURMISTER_RAW_PASS);
    expect(normalized).not.toBeNull();

    // WHEN
    const kpis = extractBurmisterKpis(normalized);

    // THEN : epaisseurs en cm
    expect(kpis).not.toBeNull();
    expect(kpis!.hLie_cm).toBeCloseTo(34, 0);
    expect(kpis!.hTotal_cm).toBeCloseTo(46, 0);
  });

  it('given sortie PASS, extrait NE', () => {
    const normalized = adaptRaw(FIXTURE_BURMISTER_RAW_PASS);
    const kpis = extractBurmisterKpis(normalized);
    expect(kpis!.ne).toBeCloseTo(1467314.82, 0);
  });

  it('given fatigue ok=true, fatigueOk = "ok"', () => {
    const normalized = adaptRaw(FIXTURE_BURMISTER_RAW_PASS);
    const kpis = extractBurmisterKpis(normalized);
    expect(kpis!.fatigueOk).toBe('ok');
    expect(kpis!.fatigueValeur).toBeCloseTo(96.4, 1);
    expect(kpis!.fatigueAdmissible).toBeCloseTo(119.12, 1);
  });

  it('given fatigue ok=false, fatigueOk = "fail"', () => {
    const normalized = adaptRaw(FIXTURE_BURMISTER_RAW_FAIL);
    const kpis = extractBurmisterKpis(normalized);
    expect(kpis!.fatigueOk).toBe('fail');
    expect(kpis!.fatigueValeur).toBeCloseTo(119.12, 1);
    expect(kpis!.fatigueAdmissible).toBeCloseTo(96.4, 1);
  });

  it('given ornierage ok=true, ornieOk = "ok"', () => {
    const normalized = adaptRaw(FIXTURE_BURMISTER_RAW_PASS);
    const kpis = extractBurmisterKpis(normalized);
    expect(kpis!.ornieOk).toBe('ok');
    expect(kpis!.ornieValeur).toBeCloseTo(412.5, 0);
    expect(kpis!.ornieAdmissible).toBeCloseTo(600, 0);
  });

  it('given structure rigide (fatigue.rigide=true), fatigueRigide=true', () => {
    const rawRigide = {
      ...FIXTURE_BURMISTER_RAW_PASS,
      fatigue: { ok: true, rigide: true, valeur: 1.8, admissible: 2.1 },
    };
    const normalized = adaptRaw(rawRigide);
    const kpis = extractBurmisterKpis(normalized);
    expect(kpis!.fatigueRigide).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildBurmisterDiagnostics — messages diagnostics fail-closed
// ---------------------------------------------------------------------------

describe('buildBurmisterDiagnostics', () => {
  it('given null output, returns empty array', () => {
    expect(buildBurmisterDiagnostics(null)).toEqual([]);
  });

  it('given PASS, returns message de conformite', () => {
    const normalized = adaptRaw(FIXTURE_BURMISTER_RAW_PASS);
    const msgs = buildBurmisterDiagnostics(normalized);
    expect(msgs.length).toBeGreaterThanOrEqual(1);
    // Le message de conformite contient "satisfaisante" ou "AGEROUTE"
    const joined = msgs.join(' ');
    expect(joined.toLowerCase()).toMatch(/satisfaisante|ageroute|emet/);
  });

  it('given fatigue FAIL, returns message fatigue avec ratio', () => {
    const normalized = adaptRaw(FIXTURE_BURMISTER_RAW_FAIL);
    const msgs = buildBurmisterDiagnostics(normalized);
    // Au moins un message mentionne la fatigue
    const fatigueMsgs = msgs.filter((m) => m.toLowerCase().includes('fatigue'));
    expect(fatigueMsgs.length).toBeGreaterThanOrEqual(1);
    // Le ratio est calcule correctement : 119.12 / 96.4 ~ 1.24
    const joined = fatigueMsgs.join(' ');
    expect(joined).toContain('1.24');
  });

  it('given ornierage FAIL, returns message ornieerage avec ratio', () => {
    const rawOrnieFail = {
      ...FIXTURE_BURMISTER_RAW_PASS,
      conforme: false,
      ornierage: { ok: false, valeur: 720, admissible: 600 },
    };
    const normalized = adaptRaw(rawOrnieFail);
    const msgs = buildBurmisterDiagnostics(normalized);
    const ornieMsgs = msgs.filter((m) => m.toLowerCase().includes('orni'));
    expect(ornieMsgs.length).toBeGreaterThanOrEqual(1);
    // Ratio : 720 / 600 = 1.20
    expect(ornieMsgs.join(' ')).toContain('1.20');
  });

  it('given diagnostics, messages ne contiennent AUCUN terme confidentiel', () => {
    // Garde DoD §8 : les messages sont construits depuis des flags whitelistés,
    // jamais depuis le texte moteur libre.
    const rawWithConfidential = {
      ...FIXTURE_BURMISTER_RAW_FAIL,
      _D: { kc: 1.3, kr: 0.82, ks: 0.95, e6: 100, b: 5 },
      propagateur: { A: 1, B: 2 },
      warnings: ['kc=1.3 confidentiel'],
      E_pondere: 1234,
      nu_pondere: 0.42,
    };
    const normalized = adaptRaw(rawWithConfidential);
    const msgs = buildBurmisterDiagnostics(normalized);
    const joined = msgs.join(' ');

    // Termes confidentiels absolument interdits dans les diagnostics
    for (const forbidden of [
      'kc',
      'kr',
      'ks',
      'e6',
      'propagateur',
      'E_pondere',
      'nu_pondere',
      'confidentiel',
    ]) {
      expect(joined, `terme confidentiel detecte : ${forbidden}`).not.toContain(
        forbidden,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Test negatif DoD §8 — aucun intermédiaire confidentiel dans la sortie normalisée
// ---------------------------------------------------------------------------

describe('DoD §8 — fail-closed : aucune fuite via extractBurmisterKpis', () => {
  it('given output brut avec champs confidentiels injectes, les KPIs ne contiennent aucun de ces champs', () => {
    // GIVEN : sortie brute avec champs confidentiels additionnels
    const rawWithLeaks = {
      ...FIXTURE_BURMISTER_RAW_PASS,
      E_pondere: 99999, // module pondere confidentiel
      nu_pondere: 0.42, // Poisson pondere confidentiel
      kc: 1.3, // coefficient de calage
      kr: 0.82,
      ks: 0.95,
      sigma_z_brut: 999.99, // contrainte axiale brute
    };

    // WHEN : normalisation via adaptCalcResult (whitelist serveur simulée)
    const normalized = adaptRaw(rawWithLeaks);

    // THEN : les KPIs extraits ne contiennent aucun des champs confidentiels
    const kpis = extractBurmisterKpis(normalized);
    const kpiJson = JSON.stringify(kpis ?? {});

    expect(kpiJson).not.toContain('E_pondere');
    expect(kpiJson).not.toContain('99999');
    expect(kpiJson).not.toContain('nu_pondere');
    expect(kpiJson).not.toContain('0.42');
    expect(kpiJson).not.toContain('"kc"');
    expect(kpiJson).not.toContain('"kr"');
    expect(kpiJson).not.toContain('"ks"');
    expect(kpiJson).not.toContain('999.99');
    expect(kpiJson).not.toContain('sigma_z_brut');
  });
});

// ---------------------------------------------------------------------------
// computeCcum — coefficient cumulatif C = [(1+τ)^n − 1]/τ (AGEROUTE §3.2)
// Équivalence portage : fidèle à `calcNE()` de la définitive (roadsens_burmister_
// definitive.html:547) — `const t=tr.tau/100, C=Math.abs(t)<1e-4?tr.N:(Math.pow(
// 1+t,tr.N)-1)/t`. Valeurs attendues DÉRIVÉES de cette formule publique, pas du TS.
// ---------------------------------------------------------------------------

describe('computeCcum (équivalence _calcNE définitive)', () => {
  it('given τ≈0 (cas limite |t|<1e-4) then C = N (durée) — pas de division par ~0', () => {
    // GIVEN : croissance nulle → branche N de la définitive (ligne 547)
    // WHEN / THEN : C = N = 20 exactement
    expect(computeCcum({ T: 150, C: 0.9, N: 20, tau: 0, dir: 1, tv: 1 })).toBe(20);
  });

  it('given τ=0,005 %/an (t=5e-5 < 1e-4) then reste sur la branche N (=durée)', () => {
    // GIVEN : sous le seuil 1e-4 → branche N (pas la formule géométrique)
    expect(computeCcum({ T: 150, C: 0.9, N: 20, tau: 0.005, dir: 1, tv: 1 })).toBe(20);
  });

  it('given τ=0,01 %/an (t=1e-4, PAS < 1e-4) then bascule sur la formule géométrique', () => {
    // GIVEN : au seuil exact, |t|<1e-4 est FAUX → formule (1+t)^n géométrique
    const c = computeCcum({ T: 150, C: 0.9, N: 20, tau: 0.01, dir: 1, tv: 1 });
    // THEN : strictement > N (preuve que la branche formule est prise, pas N)…
    expect(c).toBeGreaterThan(20);
    // …et = (1,0001^20 − 1)/1e-4 = 20,019011… (valeur dérivée de la formule publique)
    expect(c).toBeCloseTo(20.019011, 5);
  });

  it('given τ=4 %/an et N=20 then C = (1,04^20 − 1)/0,04 = 29,778078…', () => {
    // Valeur attendue calculée depuis la formule publique AGEROUTE (pas depuis le TS)
    const c = computeCcum({ T: 150, C: 0.9, N: 20, tau: 4, dir: 1, tv: 1 });
    expect(c).toBeCloseTo(29.77807857583552, 8);
  });

  it('cohérence : computeNE = 365 × T × Ccum × CAM × f_dir × f_tv', () => {
    // GIVEN : mêmes paramètres que la fiche définitive
    const traffic = { T: 150, C: 0.9, N: 20, tau: 4, dir: 1, tv: 1 };
    const ccum = computeCcum(traffic);
    // WHEN : recomposition indépendante depuis Ccum
    const recomposed = 365 * traffic.T * ccum * traffic.C * traffic.dir * traffic.tv;
    // THEN : computeNE reste synchronisé avec computeCcum (mutation de l'un → ROUGE)
    expect(computeNE(traffic)).toBeCloseTo(recomposed, 6);
    // …et vaut la valeur dérivée 1 467 314,82 (365·150·29,778…·0,9)
    expect(computeNE(traffic)).toBeCloseTo(1467314.8218242952, 4);
  });
});

// ---------------------------------------------------------------------------
// formatNeExponent — notation « m,d×10ᵉ » (fidèle à `_neFmt()` définitive:604)
// `var e=Math.floor(Math.log10(ne)+1e-9); m=ne/10^e; …m.toFixed(1).replace('.',',')`
// Valeurs attendues dérivées de _neFmt (répliqué sur les mêmes entrées).
// ---------------------------------------------------------------------------

describe('formatNeExponent (équivalence _neFmt définitive)', () => {
  const cases: Array<[number, string]> = [
    [3e7, '3,0×10⁷'],
    [1e7, '1,0×10⁷'],
    [1e5, '1,0×10⁵'],
    [1e6, '1,0×10⁶'], // frontière de puissance : le +1e-9 évite floor(5,999…)=5
    [3.5e7, '3,5×10⁷'],
  ];
  cases.forEach(([ne, expected]) => {
    it(`given NE=${ne} then « ${expected} » (virgule décimale + exposant Unicode)`, () => {
      expect(formatNeExponent(ne)).toBe(expected);
    });
  });

  it('given 9,99×10⁶ (frontière de mantisse) then arrondit à « 10,0×10⁶ »', () => {
    // 9,99e6/1e6 = 9,99 → toFixed(1) = 10,0 (report d'arrondi, exposant inchangé)
    expect(formatNeExponent(9.99e6)).toBe('10,0×10⁶');
  });

  it("given 9,99×10⁷ then « 10,0×10⁷ » (même report d'arrondi une décade plus haut)", () => {
    expect(formatNeExponent(9.99e7)).toBe('10,0×10⁷');
  });

  it('given un exposant NÉGATIF (5×10⁻³) then signe moins Unicode « ⁻ »', () => {
    // Chemin durci du TS (le _matLbl/_neFmt d\'origine casse sur le « - », cf. rapport) :
    // jamais atteint en pratique (NE ≥ 1) mais spécifié → « 5,0×10⁻³ »
    expect(formatNeExponent(5e-3)).toBe('5,0×10⁻³');
  });

  it("given NE = 0 then « — » (garde ajoutée au portage, _neFmt d'origine ne la fait pas)", () => {
    expect(formatNeExponent(0)).toBe('—');
  });

  it('given NE négatif then « — » (fail-closed)', () => {
    expect(formatNeExponent(-3e7)).toBe('—');
  });

  it('given NaN then « — »', () => {
    expect(formatNeExponent(Number.NaN)).toBe('—');
  });

  it('given Infinity then « — » (non fini)', () => {
    expect(formatNeExponent(Number.POSITIVE_INFINITY)).toBe('—');
  });
});

// ---------------------------------------------------------------------------
// presetTrafficClass — classe de trafic AVEC marge ×1,7 (fidèle à `_trClass()`
// définitive:603) : seuils t[i]*1,7, borne « ne <= t*1,7 » INCLUSIVE.
// Attendus dérivés de _trClass (répliqué), DISTINCTS de neClass (sans marge).
// ---------------------------------------------------------------------------

describe('presetTrafficClass (équivalence _trClass définitive, marge ×1,7)', () => {
  const cases: Array<[number, string]> = [
    [1e5, 'C1'],
    [1.7e5, 'C1'], // frontière exacte 1e5×1,7 : INCLUSE (ne <= t*1,7)
    [170000.01, 'C2'], // juste au-dessus → classe suivante
    [3e5, 'C2'],
    [5.1e5, 'C2'], // 3e5×1,7 inclus
    [510000.01, 'C3'],
    [3e7, 'C6'],
    [1e7, 'C5'],
    [1.7e8, 'C7'], // 1e8×1,7 : dernier seuil inclus
    [170000001, 'C8'], // au-delà de 1,7e8 → fourre-tout C8
  ];
  cases.forEach(([ne, expected]) => {
    it(`given NE=${ne} then ${expected} (borne ×1,7 incluse)`, () => {
      expect(presetTrafficClass(ne)).toBe(expected);
    });
  });

  // La DIFFÉRENCE assumée avec neClass (sans marge) — les deux coexistent dans la
  // définitive pour des usages distincts (saisie TMJA vs note de cas de validation).
  it('given les NE des presets (3e7, 1e7, 1e5), presetTrafficClass ≠ neClass (marge ×1,7)', () => {
    // 3e7 : neClass = C7 (30e6 < 50e6) ; presetTrafficClass = C6 (3e7 <= 3e7×1,7)
    expect(neClass(3e7)).toBe('C7');
    expect(presetTrafficClass(3e7)).toBe('C6');
    // 1e7 : neClass = C6 (10e6 < 30e6) ; presetTrafficClass = C5
    expect(neClass(1e7)).toBe('C6');
    expect(presetTrafficClass(1e7)).toBe('C5');
    // 1e5 : neClass = C2 (0,1e6 non < 0,1e6) ; presetTrafficClass = C1
    expect(neClass(1e5)).toBe('C2');
    expect(presetTrafficClass(1e5)).toBe('C1');
    // Systématique : la marge ×1,7 rétrograde d'une classe pile sur ces valeurs
    for (const ne of [3e7, 1e7, 1e5]) {
      expect(presetTrafficClass(ne)).not.toBe(neClass(ne));
    }
  });
});

// ---------------------------------------------------------------------------
// matShortLabel (non exporté) — testé via buildPresetConditions.layerLines, qui
// formate `${matShortLabel(mat)} — ${h_cm} cm · E = ${E} MPa`. Équivalence à
// `_matLbl()` définitive:605 : `({BBSG1:'BBSG',BBSG2:'BBSG 2/3',GNT1:'GNT',
// GNT2:'GNT',BC5g:'BC5 (goujonnée)'})[k] || k` (fallback IDENTITÉ).
// ---------------------------------------------------------------------------

/** Layer minimal (id non lu par buildPresetConditions) — iface littérale 'auto'. */
const mkLayer = (mat: string, h: number, E: number, nu = 0.35) => ({
  id: 1,
  mat,
  h,
  E,
  nu,
  iface: 'auto' as const,
});
const PF3 = { cls: 'PF3', E: 120, nu: 0.35 };
/** Preset générique (ne/pfCls sans effet sur layerLines) pour probing de libellé. */
const ANY_PRESET = ROADSENS_PRESETS.find((p) => p.id === 's1')!;

/** Extrait le libellé court affiché pour une couche donnée (avant le « — »). */
function shortLabelOf(mat: string, hM: number, E: number): string {
  const cond = buildPresetConditions(ANY_PRESET, [mkLayer(mat, hM, E)], PF3, null);
  return cond.layerLines[0];
}

describe('matShortLabel (équivalence _matLbl définitive, via layerLines)', () => {
  it('given BBSG1 then « BBSG » (mapping T.54)', () => {
    expect(shortLabelOf('BBSG1', 0.08, 1512)).toBe('BBSG — 8 cm · E = 1512 MPa');
  });

  it('given BBSG2 then « BBSG 2/3 »', () => {
    expect(shortLabelOf('BBSG2', 0.06, 1896)).toBe('BBSG 2/3 — 6 cm · E = 1896 MPa');
  });

  it('given GNT1 then « GNT »', () => {
    expect(shortLabelOf('GNT1', 0.15, 400)).toBe('GNT — 15 cm · E = 400 MPa');
  });

  it('given GNT2 then « GNT » (même libellé court que GNT1)', () => {
    expect(shortLabelOf('GNT2', 0.15, 150)).toBe('GNT — 15 cm · E = 150 MPa');
  });

  it('given BC5g then « BC5 (goujonnée) »', () => {
    expect(shortLabelOf('BC5g', 0.22, 35000)).toBe(
      'BC5 (goujonnée) — 22 cm · E = 35000 MPa',
    );
  });

  it('given une clé HORS catalogue (inconnue) then fallback IDENTITÉ (comme _matLbl)', () => {
    // _matLbl('ZZZ') === 'ZZZ' ; matShortLabel idem (MATERIALS['ZZZ'] absent → mat)
    expect(shortLabelOf('ZZZ', 0.1, 300)).toBe('ZZZ — 10 cm · E = 300 MPa');
  });

  // Divergence M2 corrigée (revue fidélité) : pour une clé PRÉSENTE dans MATERIALS
  // mais ABSENTE du mapping court, le fallback est l'IDENTITÉ comme `_matLbl` —
  // jamais le libellé catalogue long (qui dupliquait E dans la note de preset).
  it('given GB2 (dans MATERIALS, hors mapping court) then fallback IDENTITÉ « GB2 » (comme _matLbl)', () => {
    expect(shortLabelOf('GB2', 0.35, 2588)).toBe('GB2 — 35 cm · E = 2588 MPa');
  });

  it('given EME2 (matériau d’assise hors mapping court) then fallback IDENTITÉ « EME2 »', () => {
    expect(shortLabelOf('EME2', 0.12, 14000)).toBe('EME2 — 12 cm · E = 14000 MPa');
  });
});

// ---------------------------------------------------------------------------
// buildPresetConditions — note de cas de validation (équivalent `buildPresetNote()`
// / `#presetNote` définitive:607). Structure PresetConditions ; famille & risque
// viennent du RÉSULTAT serveur (null tant qu'absent → « en attente »).
// ---------------------------------------------------------------------------

describe('buildPresetConditions', () => {
  const preset = ROADSENS_PRESETS.find((p) => p.id === 's1')!; // ne=3e7, pfCls=PF3
  const layers = buildLayersFromPreset(preset); // [BBSG1 8cm/1512, GB2 35cm/2588]

  it('given output null (calcul non lancé) then famille & risque « en attente » sans crash', () => {
    // GIVEN : aucun résultat serveur
    const cond = buildPresetConditions(preset, layers, PF3, null);
    // THEN : famille null, risqueLine '—' (pas d'exception)
    expect(cond.famille).toBeNull();
    expect(cond.risqueLine).toBe('—');
  });

  it('given output null then pfLine/trafficLine/detail restent connus (saisie + catalogue public)', () => {
    const cond = buildPresetConditions(preset, layers, PF3, null);
    // pfLine depuis pfNext (E=120, ν=0,35) et preset.pfCls
    expect(cond.pfLine).toBe('PF3 — E = 120 MPa, ν = 0,35');
    // trafficLine : presetTrafficClass(3e7)=C6 + formatNeExponent(3e7)=3,0×10⁷
    expect(cond.trafficLine).toBe('C6 — NE = 3,0×10⁷ essieux équivalents');
    // detail = preset.desc (texte de référence catalogue)
    expect(cond.detail).toBe(preset.desc);
  });

  it('given output null then layerLines reflète chaque couche (surface → support)', () => {
    const cond = buildPresetConditions(preset, layers, PF3, null);
    expect(cond.layerLines).toHaveLength(2);
    expect(cond.layerLines[0]).toBe('BBSG — 8 cm · E = 1512 MPa');
  });

  it('given output absent (undefined) then aucun crash, comme null', () => {
    const cond = buildPresetConditions(preset, layers, PF3, undefined);
    expect(cond.famille).toBeNull();
    expect(cond.risqueLine).toBe('—');
  });

  it('given output non-objet (ex. chaîne) then traité comme absent (fail-closed)', () => {
    const cond = buildPresetConditions(preset, layers, PF3, 'PASS');
    expect(cond.famille).toBeNull();
    expect(cond.risqueLine).toBe('—');
  });

  it('given output objet SANS rows then famille null (rows non-tableau ignorées)', () => {
    const cond = buildPresetConditions(preset, layers, PF3, { verdict: 'PASS' });
    expect(cond.famille).toBeNull();
  });

  it('given output nominal (rows Famille + details Risque) then famille & risque renseignés', () => {
    // GIVEN : sortie NORMALISÉE serveur (rows/details whitelistés, DoD §8)
    const output = {
      verdict: 'PASS',
      rows: [
        { label: 'Famille de structure', value: 'bitumineuse épaisse', unit: '' },
        { label: 'Trafic cumulé (NE)', value: 3e7, unit: '' },
      ],
      details: [{ label: 'Risque effectif', value: 3.09, unit: '%' }],
    };
    // WHEN
    const cond = buildPresetConditions(preset, layers, PF3, output);
    // THEN : famille prise sur la row exacte, risque formaté FR 2 décimales
    expect(cond.famille).toBe('bitumineuse épaisse');
    expect(cond.risqueLine).toBe('3,09 % (auto, Tableau 70)');
  });

  it('given une row Famille vide (chaîne "") then famille reste null (fail-closed)', () => {
    const output = {
      rows: [{ label: 'Famille de structure', value: '', unit: '' }],
      details: [],
    };
    expect(buildPresetConditions(preset, layers, PF3, output).famille).toBeNull();
  });

  it('given un Risque effectif NON numérique then risqueLine « — » (rowNumber fail-closed)', () => {
    const output = {
      rows: [],
      details: [{ label: 'Risque effectif', value: 'auto', unit: '' }],
    };
    expect(buildPresetConditions(preset, layers, PF3, output).risqueLine).toBe('—');
  });

  it('interfaces AUTO — bitumineux/bitumineux → « collée »', () => {
    // s1 : BBSG1 / GB2 (deux bitumineux) → collée ; dernière couche → null
    const cond = buildPresetConditions(preset, layers, PF3, null);
    expect(cond.interfaceLines).toEqual(['collée', null]);
  });

  it('interfaces AUTO — deux MTLH traitées (non-béton) → « semi-collée »', () => {
    // s6 : BBSG1 / GC3 / GC3 → [collée (bit/mtlh), semi-collée (mtlh/mtlh), null]
    const s6 = ROADSENS_PRESETS.find((p) => p.id === 's6')!;
    const cond = buildPresetConditions(s6, buildLayersFromPreset(s6), PF3, null);
    expect(cond.interfaceLines).toEqual(['collée', 'semi-collée', null]);
  });

  it('interfaces AUTO — deux dalles béton « BC » → « glissante »', () => {
    // s16 : BC5 / BC2 (deux béton) → glissante ; dernière → null
    const s16 = ROADSENS_PRESETS.find((p) => p.id === 's16')!;
    const cond = buildPresetConditions(s16, buildLayersFromPreset(s16), PF3, null);
    expect(cond.interfaceLines).toEqual(['glissante', null]);
  });

  it("la note ignore une interface IMPOSÉE et affiche toujours l'AUTO (fidèle à buildPresetNote → ifaceAuto)", () => {
    // GIVEN : couches BBSG1/GB2 avec une interface imposée 'glissante'…
    const imposed = [
      { ...mkLayer('BBSG1', 0.08, 1512, 0.45), iface: 'glissante' as const },
      mkLayer('GB2', 0.35, 2588, 0.45),
    ];
    // WHEN
    const cond = buildPresetConditions(preset, imposed, PF3, null);
    // THEN : la note reste sur l'AUTO (collée), pas 'glissante' imposée
    expect(cond.interfaceLines).toEqual(['collée', null]);
  });
});

// ---------------------------------------------------------------------------
// reportRowValue — formatage d'une ligne de rapport (onglet Détails), avec
// facteur d'échelle d'affichage. Corrige M1 (revue fidélité) : l'adaptateur émet
// les épaisseurs en MÈTRES (`Épaisseur totale`, unit 'm') ; les lignes « h … »
// du rapport les affichent en CM (définitive : `f(d.H_tot*100,2)`) → scale=100.
// ---------------------------------------------------------------------------

describe("reportRowValue — échelle d'affichage m→cm (M1)", () => {
  const rowM = { label: 'Épaisseur totale', value: 0.68, unit: 'm' };

  it('given une épaisseur adaptateur en mètres, when scale=100, then affiche la valeur cm de la définitive (« 68,00 »)', () => {
    expect(reportRowValue(rowM, 2, 100)).toBe('68,00');
  });

  it('given h paquet lié 0,43 m, when scale=100, then « 43,00 » (référence : f(d.H_bit*100,2))', () => {
    expect(
      reportRowValue(
        { label: 'Épaisseur de couches liées', value: 0.43, unit: 'm' },
        2,
        100,
      ),
    ).toBe('43,00');
  });

  it('given scale omis, then défaut 1 (aucune conversion implicite)', () => {
    expect(reportRowValue(rowM, 2)).toBe('0,68');
  });

  it('given une valeur TEXTE, then le facteur est ignoré (texte rendu tel quel)', () => {
    expect(
      reportRowValue(
        { label: 'Famille de structure', value: 'bitumineuse épaisse', unit: '' },
        2,
        100,
      ),
    ).toBe('bitumineuse épaisse');
  });

  it('given une ligne absente, then « — » (fail-closed, jamais NaN)', () => {
    expect(reportRowValue(undefined, 2, 100)).toBe('—');
  });
});

// ---------------------------------------------------------------------------
// tabDetailsMode — garde de l'onglet Détails (M3, revue fidélité) : un calcul en
// ERREUR n'affiche JAMAIS le rapport 9 sections (la définitive n'édite pas de
// rapport en erreur) ; il affiche le message d'échec, comme l'onglet Résultats.
// ---------------------------------------------------------------------------

describe("tabDetailsMode — garde erreur de l'onglet Détails (M3)", () => {
  it('given result null, then mode « placeholder » (pas encore de calcul)', () => {
    expect(tabDetailsMode(null)).toBe('placeholder');
  });

  it('given status ERROR, then mode « error » — jamais de rapport « NON CONFORME » factice', () => {
    expect(tabDetailsMode({ status: 'ERROR' })).toBe('error');
  });

  it('given status DONE, then mode « report »', () => {
    expect(tabDetailsMode({ status: 'DONE' })).toBe('report');
  });

  it("given status PENDING (calcul non abouti, sans sortie), then mode « error » plutôt qu'un rapport vide", () => {
    expect(tabDetailsMode({ status: 'PENDING' })).toBe('error');
  });
});
