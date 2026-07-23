/**
 * CORPS DE PV DÉDIÉS — 5 modes qui tombaient dans le fallback générique
 * (plane-strain / axi-plaque / radier-tri / pressio-etalonnage / pressio-calibrage).
 *
 * Objectif (exigence client « zéro écart ») : le PV reflète la SYNTHÈSE que l'outil
 * client présente pour chaque mode (libellés/unités/ordre des panneaux `#ps-run`,
 * `#ax-run`, `#tri-run`, `renderEtalResult`, `renderCalibResult`), et RIEN d'autre.
 *
 * Deux garanties par corps :
 *  1. FIDÉLITÉ — chaque grandeur affichée par l'outil client est présente, libellée,
 *     avec son unité et sa valeur (given/when/then).
 *  2. COMPLÉTUDE FAIL-CLOSED (doctrine #71 / DoD §8) — on ÉNUMÈRE les champs
 *     whitelistés du contrat (`OutputSchema.shape`) et on assert que CHACUN est SOIT
 *     rendu (RENDERED) SOIT explicitement décidé (EXCLUDED / DISPLAY_ONLY /
 *     HANDLED_APART). Un NOUVEAU champ whitelisté non décidé -> ce test ROUGIT :
 *     le mainteneur tranche AU DEV (mapper ou masquer), jamais de fuite/omission muette.
 *
 * OfficialPv SCELLÉ en mémoire (sceau valide) — aucune base, aucun réseau.
 */
import type { OfficialPv } from '@prisma/client';
import {
  AxiOutputSchema,
  PlaneStrainOutputSchema,
  PressioCalibrageOutputSchema,
  PressioEtalonnageOutputSchema,
  TriRaftOutputSchema,
} from '@roadsen/engines';
import {
  canonicalize,
  sealContentHash,
  sealHmac,
  type SealableValue,
} from '@roadsen/shared';

import { buildPvDocDefinition, collectPvPdfText, renderPvPdf } from './pv-pdf';

const SECRET = 'secret-unitaire-2d-pressio';

function makeSealedPv(
  engineId: string,
  input: SealableValue,
  output: SealableValue,
): OfficialPv {
  const pvNumber = 'PV-RDS-org-a-2026-009100';
  const sealedAtIso = '2026-07-16T10:00:00.000Z';
  const content: SealableValue = {
    pvNumber,
    sealedAt: sealedAtIso,
    engineMeta: {
      engineId,
      engineVersion: '1.0.0',
      engineSourceHash: 'a'.repeat(64),
    },
    identity: { userId: 'u-1', projectId: 'p-1', projectName: 'Ouvrage X' },
    input,
    output,
    scienceStatus: 'unsigned',
  };
  const canonical = canonicalize(content);
  return {
    id: 'pv-body-1',
    orgId: '11111111-1111-1111-1111-111111111111',
    calcResultId: 'c-1',
    projectId: 'p-1',
    pvNumber,
    userId: 'u-1',
    projectName: 'Ouvrage X',
    engineId,
    engineVersion: '1.0.0',
    engineSourceHash: 'a'.repeat(64),
    inputCanonical: canonical,
    output,
    scienceStatus: 'unsigned',
    verdict: 'NON_APPLICABLE',
    contentHash: sealContentHash(canonical),
    hmac: sealHmac(canonical, SECRET),
    sealedAt: new Date(sealedAtIso),
    documentHtml: null,
    documentFormat: null,
    name: null,
  };
}

/** Lit la valeur (cellule d'index 1) de la ligne dont la 1re cellule = `label`. */
function findRowValue(content: unknown, label: string): string | null {
  let found: string | null = null;
  const cellText = (c: unknown): string =>
    c &&
    typeof c === 'object' &&
    typeof (c as { text?: unknown }).text === 'string'
      ? (c as { text: string }).text
      : '';
  const walk = (n: unknown): void => {
    if (found !== null || n == null) return;
    if (Array.isArray(n)) {
      n.forEach(walk);
      return;
    }
    if (typeof n === 'object') {
      const o = n as Record<string, unknown>;
      const table = o.table as { body?: unknown[][] } | undefined;
      if (table?.body) {
        for (const row of table.body) {
          if (
            Array.isArray(row) &&
            row.length >= 2 &&
            cellText(row[0]) === label
          ) {
            found = cellText(row[1]);
            return;
          }
        }
      }
      Object.values(o).forEach(walk);
    }
  };
  walk(content);
  return found;
}

/** Assert fail-closed : chaque clé whitelistée du contrat est décidée. */
function assertComplete(
  outputSchema: { shape: Record<string, unknown> },
  decided: Set<string>,
): void {
  const orphans = Object.keys(outputSchema.shape).filter(
    (k) => !decided.has(k),
  );
  // Si ROUGE : un champ whitelisté n'est NI rendu NI explicitement masqué/à-part.
  expect(orphans).toEqual([]);
}

const prevSecret = process.env.PV_SIGNING_SECRET;
beforeAll(() => {
  process.env.PV_SIGNING_SECRET = SECRET;
});
afterAll(() => {
  if (prevSecret === undefined) delete process.env.PV_SIGNING_SECRET;
  else process.env.PV_SIGNING_SECRET = prevSecret;
});

// ---------------------------------------------------------------------------
// plane-strain (déformations planes)
// ---------------------------------------------------------------------------
describe('PV plane-strain — corps « coupe en déformations planes »', () => {
  const OUT: SealableValue = {
    erreur: null,
    warnings: ['Contrôler la portance ELU séparément'],
    wMax: 12.34,
    wMin: 1.23,
    diff: 11.11,
    mMax: 45.67,
    mMin: -3.21,
    pMax: 78.9,
    totalLoad: 1000,
    sumReact: 999.5,
    z0: 1.5,
    decolN: 3,
    EI: 54321.6,
    profils: { deflexion: { x: [0, 1], v: [0, 1], unit: 'mm', label: 'w' } },
  };
  const IN: SealableValue = { opts: { foundD: 1.5, decol: true } };

  it('given un calcul plane-strain scellé, then le PV rend les stats du panneau #ps-run (libellés/unités/ordre)', () => {
    const def = buildPvDocDefinition(makeSealedPv('plane-strain', IN, OUT));
    // Tassements sur-rapportés ×1000 comme `(R.wMax*1000).toFixed(1)+' mm'` du panneau
    // client (wMax 12,34 -> 12 340 mm). Défaut d'affichage COPIÉ (décision 15/07/17-07).
    expect(findRowValue(def.content, 'Tassement maximal w_max')).toBe(
      '12 340 mm',
    );
    expect(findRowValue(def.content, 'Tassement minimal w_min')).toBe(
      '1 230 mm',
    );
    expect(findRowValue(def.content, 'Tassement différentiel')).toBe(
      '11 110 mm',
    );
    expect(findRowValue(def.content, 'Moment fléchissant maximal')).toBe(
      '45,7 kN·m/m',
    );
    expect(findRowValue(def.content, 'Moment fléchissant minimal')).toBe(
      '-3,2 kN·m/m',
    );
    expect(findRowValue(def.content, 'Réaction de sol maximale')).toBe(
      '78,9 kPa',
    );
    // Ligne combinée du client : « total / réaction unité (équilibre …) ».
    expect(findRowValue(def.content, 'Charge / réaction Σ')).toContain('kN/m');
    expect(findRowValue(def.content, 'Charge / réaction Σ')).toMatch(/%\)$/);
    // Cote d'assise & décollement : rendus car foundD>0 et décollement actif (entrée).
    // (fdnNum supprime les zéros de fin : 1,5 — convention PV du dépôt.)
    expect(findRowValue(def.content, "Cote d'assise D")).toBe('1,5 m');
    expect(
      findRowValue(def.content, 'Nœuds décollés (contact unilatéral)'),
    ).toBe('3');
    // Rigidité D en notation scientifique.
    expect(findRowValue(def.content, 'Rigidité de flexion D')).toMatch(
      /^\d,\d+e[+-]\d+ kN·m$/,
    );
  });

  it('cote d’assise & décollement OMIS si l’option est inactive (foundD=0, decol absent) — pas de ligne « 0 » parasite', () => {
    const def = buildPvDocDefinition(
      makeSealedPv('plane-strain', { opts: { foundD: 0 } }, OUT),
    );
    expect(findRowValue(def.content, "Cote d'assise D")).toBeNull();
    expect(
      findRowValue(def.content, 'Nœuds décollés (contact unilatéral)'),
    ).toBeNull();
  });

  it('erreur de calcul -> encadré d’alerte ; warnings rendus ; champs d’affichage jamais listés', () => {
    const text = collectPvPdfText(makeSealedPv('plane-strain', IN, OUT));
    expect(text).toContain('Contrôler la portance ELU séparément');
    expect(text).not.toContain('profils');
    expect(text).not.toContain('deflexion');
  });

  it('COMPLÉTUDE fail-closed : chaque champ du PlaneStrainOutputSchema est décidé', () => {
    const RENDERED = new Set([
      'wMax',
      'wMin',
      'diff',
      'mMax',
      'mMin',
      'pMax',
      'totalLoad',
      'sumReact',
      'z0',
      'decolN',
      'EI',
    ]);
    const HANDLED_APART = new Set(['erreur', 'warnings']);
    const DISPLAY_ONLY = new Set(['profils']);
    assertComplete(
      PlaneStrainOutputSchema,
      new Set([...RENDERED, ...HANDLED_APART, ...DISPLAY_ONLY]),
    );
  });
});

// ---------------------------------------------------------------------------
// axi-plaque (axisymétrique)
// ---------------------------------------------------------------------------
describe('PV axi-plaque — corps « plaque axisymétrique »', () => {
  const OUT: SableValue = {
    wc: 5.5,
    wEdge: 2.2,
    wMax: 6.0,
    wMin: 1.0,
    diff: 5.0,
    mrMax: 30.1,
    mtMax: 22.4,
    pMax: 60.3,
    totalLoad: 800,
    sumReact: 800,
    z0: 2.0,
    profils: { deflexion: { x: [0, 1], v: [0, 1], unit: 'mm', label: 'w' } },
  };
  const IN: SealableValue = { o: { foundD: 2.0 } };

  it('given un calcul axi scellé, then le PV rend centre/bord + différentiel + moments radial/tangentiel (panneau #ax-run)', () => {
    const def = buildPvDocDefinition(makeSealedPv('axi-plaque', IN, OUT));
    // Tassements ×1000 (panneau #ax-run : `(R.wc*1000).toFixed(1)`) : wc 5,5 -> 5 500 mm.
    expect(findRowValue(def.content, 'Tassement au centre w_c')).toBe(
      '5 500 mm',
    );
    expect(findRowValue(def.content, 'Tassement au bord w_bord')).toBe(
      '2 200 mm',
    );
    expect(findRowValue(def.content, 'Tassement différentiel')).toBe(
      '5 000 mm',
    );
    expect(findRowValue(def.content, 'Moment radial M_r max')).toBe(
      '30,1 kN·m/m',
    );
    expect(findRowValue(def.content, 'Moment tangentiel M_t max')).toBe(
      '22,4 kN·m/m',
    );
    expect(findRowValue(def.content, 'Réaction de sol maximale')).toBe(
      '60,3 kPa',
    );
    // Équilibre parfait (800/800) -> « équilibre ✓ ».
    expect(findRowValue(def.content, 'Charge / réaction Σ')).toContain(
      'équilibre ✓',
    );
    expect(findRowValue(def.content, "Cote d'assise D")).toBe('2 m');
  });

  it('COMPLÉTUDE fail-closed : chaque champ de l’AxiOutputSchema est décidé (wMax/wMin agrégés au différentiel comme le client)', () => {
    const RENDERED = new Set([
      'wc',
      'wEdge',
      'diff',
      'mrMax',
      'mtMax',
      'pMax',
      'totalLoad',
      'sumReact',
      'z0',
    ]);
    // Le panneau #ax-run affiche centre/bord + « Tassement différentiel » ; wMax/wMin
    // ne sont PAS affichés isolément par l'outil client (agrégés dans le différentiel).
    const EXCLUDED = new Set(['wMax', 'wMin']);
    const DISPLAY_ONLY = new Set(['profils']);
    assertComplete(
      AxiOutputSchema,
      new Set([...RENDERED, ...EXCLUDED, ...DISPLAY_ONLY]),
    );
  });
});
type SableValue = Record<string, SealableValue>;

// ---------------------------------------------------------------------------
// radier-tri (maillage triangulaire DKT)
// ---------------------------------------------------------------------------
describe('PV radier-tri — corps « radier maillé (triangulaire) »', () => {
  const OUT: SableValue = {
    erreur: null,
    warnings: [],
    wMax: 8.8,
    wMin: 2.1,
    diff: 6.7,
    reactionMax: 95.2,
    totalLoad: 1500,
    sumReact: 1499.9,
    nRaft: 2,
    z0: 1.0,
    champDeflexion: {
      x0: 0,
      y0: 0,
      x1: 1,
      y1: 1,
      cols: 2,
      rows: 2,
      vals: [1, 2, 3, 4],
      vMin: 1,
      vMax: 4,
    },
  };
  const IN: SealableValue = { opts: { foundD: 1.0 } };

  it('given un calcul tri-raft scellé, then le PV rend nb de plaques + stats (panneau #tri-run) SANS N nœuds / nt triangles (§8)', () => {
    const pv = makeSealedPv('radier-tri', IN, OUT);
    const def = buildPvDocDefinition(pv);
    expect(findRowValue(def.content, 'Nombre de plaques modélisées')).toBe('2');
    // Tassements ×1000 (panneau #tri-run : `(R.wMax*1000).toFixed(1)`).
    expect(findRowValue(def.content, 'Tassement maximal w_max')).toBe(
      '8 800 mm',
    );
    expect(findRowValue(def.content, 'Tassement minimal w_min')).toBe(
      '2 100 mm',
    );
    expect(findRowValue(def.content, 'Tassement différentiel')).toBe(
      '6 700 mm',
    );
    expect(findRowValue(def.content, 'Réaction de sol maximale')).toBe(
      '95,2 kPa',
    );
    expect(findRowValue(def.content, 'Charge / réaction Σ')).toContain('kN');
    expect(findRowValue(def.content, "Cote d'assise D")).toBe('1 m');
    // La densité de maillage (méthode EF) n'apparaît JAMAIS : ni « nœuds » ni
    // « triangles », ni le champ de déflexion.
    const text = collectPvPdfText(pv);
    expect(text).not.toMatch(/triangle/i);
    expect(text).not.toContain('champDeflexion');
    expect(text).not.toContain('vals');
  });

  it('COMPLÉTUDE fail-closed : chaque champ du TriRaftOutputSchema est décidé', () => {
    const RENDERED = new Set([
      'wMax',
      'wMin',
      'diff',
      'reactionMax',
      'totalLoad',
      'sumReact',
      'nRaft',
      'z0',
    ]);
    const HANDLED_APART = new Set(['erreur', 'warnings']);
    const DISPLAY_ONLY = new Set(['champDeflexion']);
    assertComplete(
      TriRaftOutputSchema,
      new Set([...RENDERED, ...HANDLED_APART, ...DISPLAY_ONLY]),
    );
  });
});

// ---------------------------------------------------------------------------
// pressio-etalonnage (sonde dans l'air)
// ---------------------------------------------------------------------------
describe('PV pressio-etalonnage — corps « étalonnage de la sonde »', () => {
  const OUT: SableValue = {
    Vs: 535.2,
    Pe: 1.234,
    a: 0.05,
    R2: 0.99995,
    rms: 0.321,
    vsReel: 540,
    vPe: 648,
    residus: [
      { p: 1, vMesure: 10, vAjuste: 9.8, residu: 0.2 },
      { p: 2, vMesure: 20.5, vAjuste: 20.6, residu: -0.1 },
    ],
  };

  it('given un étalonnage scellé, then le PV rend Vs/Pe/pente d’air/V_pe/R²+qualité/RMS (panneau renderEtalResult)', () => {
    const pv = makeSealedPv('pressio-etalonnage', {}, OUT);
    const def = buildPvDocDefinition(pv);
    // pente d'air affichée ×10 en cm³/MPa (a=0,05 cm³/bar -> 0,5 cm³/MPa), ≠ coeff a.
    expect(findRowValue(def.content, 'Pente d’air (≠ coefficient a)')).toBe(
      '0,5 cm³/MPa',
    );
    expect(findRowValue(def.content, 'Vs (droite ajustée)')).toBe('535,2 cm³');
    expect(findRowValue(def.content, 'Vs réel (1er palier mesuré)')).toBe(
      '540 cm³',
    );
    expect(findRowValue(def.content, 'Pe (à V = 1,2 × Vs)')).toBe('1,234 bar');
    expect(findRowValue(def.content, 'Volume cible V_pe = 1,2 × Vs')).toBe(
      '648 cm³',
    );
    // R² = 0,99995 -> label « Excellent » (seuil > 0,9999 de renderEtalResult).
    expect(findRowValue(def.content, 'Coefficient de détermination R²')).toBe(
      '0,99995 (Excellent)',
    );
    expect(findRowValue(def.content, 'Erreur quadratique moyenne (RMS)')).toBe(
      '0,321 cm³',
    );
    // Table des résidus (colonnes du client).
    const text = collectPvPdfText(pv);
    expect(text).toContain('Tableau des résidus');
    expect(text).toContain('V mesuré (cm³)');
    expect(text).toContain('V ajusté (cm³)');
  });

  it('COMPLÉTUDE fail-closed : chaque champ du PressioEtalonnageOutputSchema est rendu', () => {
    const RENDERED = new Set([
      'a',
      'Vs',
      'vsReel',
      'Pe',
      'vPe',
      'R2',
      'rms',
      'residus',
    ]);
    assertComplete(PressioEtalonnageOutputSchema, RENDERED);
  });
});

// ---------------------------------------------------------------------------
// pressio-calibrage (tube indéformable)
// ---------------------------------------------------------------------------
describe('PV pressio-calibrage — corps « calibrage de volume »', () => {
  const OUT: SableValue = {
    a: 0.048,
    R2: 0.9995,
    rms: 0.0123,
    c0: 5.1,
    c1: 0.002,
    c2: 0.000012,
    residus: [{ p: 1, v60Mesure: 12, v60Ajuste: 11.9, residu: 0.1 }],
  };

  it('given un calibrage scellé, then le PV rend a + c₀/c₁/c₂ + équation + R²+qualité/RMS (panneau renderCalibResult)', () => {
    const pv = makeSealedPv('pressio-calibrage', {}, OUT);
    const def = buildPvDocDefinition(pv);
    // a = pente dV/dP affichée ×10 en cm³/MPa (0,048 -> 0,48 ; fdnNum trim les zéros).
    expect(findRowValue(def.content, 'Coefficient a (pente dV/dP)')).toBe(
      '0,48 cm³/MPa',
    );
    expect(findRowValue(def.content, 'c₀ (constante)')).toMatch(/e[+-]\d+$/);
    expect(findRowValue(def.content, 'c₁ (coefficient de V)')).toMatch(
      /e[+-]\d+$/,
    );
    expect(findRowValue(def.content, 'c₂ (coefficient de V²)')).toMatch(
      /e[+-]\d+$/,
    );
    // R² = 0,9995 -> « Excellent » (seuil > 0,999 de renderCalibResult).
    expect(findRowValue(def.content, 'Coefficient de détermination R²')).toBe(
      '0,9995 (Excellent)',
    );
    expect(findRowValue(def.content, 'Erreur quadratique moyenne (RMS)')).toBe(
      '0,0123 bar',
    );
    // Équation de la courbe (miroir du client).
    const text = collectPvPdfText(pv);
    expect(text).toMatch(/Pc = .+ × V \+ .+ × V²/);
    expect(text).toContain('V60 mesuré (cm³)');
  });

  it('COMPLÉTUDE fail-closed : chaque champ du PressioCalibrageOutputSchema est rendu', () => {
    const RENDERED = new Set(['a', 'c0', 'c1', 'c2', 'R2', 'rms', 'residus']);
    assertComplete(PressioCalibrageOutputSchema, RENDERED);
  });
});

// ---------------------------------------------------------------------------
// Rendus PDF réels (volume borné, sceau valide) — les 5 corps
// ---------------------------------------------------------------------------
describe('PV 5 corps dédiés — rendu PDF réel borné', () => {
  it.each([
    [
      'plane-strain',
      { opts: { foundD: 1.5, decol: true } },
      {
        erreur: null,
        warnings: [],
        wMax: 12.3,
        wMin: 1.2,
        diff: 11.1,
        mMax: 45,
        mMin: -3,
        pMax: 78,
        totalLoad: 1000,
        sumReact: 999,
        z0: 1.5,
        decolN: 0,
        EI: 54321,
      },
    ],
    [
      'axi-plaque',
      { o: { foundD: 0 } },
      {
        wc: 5.5,
        wEdge: 2.2,
        wMax: 6,
        wMin: 1,
        diff: 5,
        mrMax: 30,
        mtMax: 22,
        pMax: 60,
        totalLoad: 800,
        sumReact: 800,
        z0: 0,
      },
    ],
    [
      'radier-tri',
      { opts: { foundD: 0 } },
      {
        erreur: null,
        warnings: [],
        wMax: 8.8,
        wMin: 2.1,
        diff: 6.7,
        reactionMax: 95,
        totalLoad: 1500,
        sumReact: 1499,
        nRaft: 2,
        z0: 0,
      },
    ],
    [
      'pressio-etalonnage',
      {},
      {
        Vs: 535,
        Pe: 1.2,
        a: 0.05,
        R2: 0.9999,
        rms: 0.3,
        vsReel: 540,
        vPe: 648,
        residus: [{ p: 1, vMesure: 10, vAjuste: 9.8, residu: 0.2 }],
      },
    ],
    [
      'pressio-calibrage',
      {},
      {
        a: 0.048,
        R2: 0.9995,
        rms: 0.01,
        c0: 5.1,
        c1: 0.002,
        c2: 0.000012,
        residus: [{ p: 1, v60Mesure: 12, v60Ajuste: 11.9, residu: 0.1 }],
      },
    ],
  ])(
    '%s : PDF réel produit (sceau valide, non vide)',
    async (id, input, out) => {
      const buf = await renderPvPdf(makeSealedPv(id, input, out));
      expect(buf.slice(0, 5).toString()).toBe('%PDF-');
      expect(buf.length).toBeGreaterThan(0);
    },
  );
});
