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
  neClass,
  buildBurmisterPayload,
  extractBurmisterKpis,
  buildBurmisterDiagnostics,
  resolveRisk,
  effectiveNE,
  uRisk,
  ROADSENS_PRESETS,
  buildLayersFromPreset,
  catalogueMaterialAt,
  CAT,
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
    expect(
      catalogueMaterialAt({ top: 'BBSG1', mid: 'GLc2', body: 'GL2' }, 1, 3),
    ).toBe('GLc2');
  });

  it('sans mid/tail, les couches intermédiaires retombent sur "body"', () => {
    expect(catalogueMaterialAt({ top: 'BBSG1', body: 'GB3' }, 2, 4)).toBe('GB3');
  });
});

describe('CAT — catalogue AGEROUTE 2015 (14 familles)', () => {
  it('contient exactement les familles S1-S11, S13, S14, S15', () => {
    const expected = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10', 'S11', 'S13', 'S14', 'S15'];
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
