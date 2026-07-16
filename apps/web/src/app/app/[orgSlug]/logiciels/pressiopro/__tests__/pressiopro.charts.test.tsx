/**
 * Tests — panneau « Dépouillement » + charts PressioPro (« zéro écart » 14/07).
 * DoD §9 : given/when/then. Rendu via renderToStaticMarkup (composants purs, sans
 * hooks) — même pattern que fastlab.test.ts (ExtraView).
 */

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect } from 'vitest';

import {
  buildInverseCurvePoints,
  PressioCourbeCorrigee,
  BaudSpectralChart,
  ProfilDepthChart,
  EtalonnageChart,
  CalibrageChart,
  DepouillementPanel,
  type ProfilRow,
} from '../page';

import type {
  PressioDepouillement,
  PressioCourbePoint,
  PressioEtalonnageResidu,
  PressioCalibrageResidu,
} from '@/lib/api/types';

// ─────────────────────────────────────────────────────────────────────────────
// buildInverseCurvePoints — formule PUBLIQUE 1/(V−Vs)=A+B·p appliquée aux coefficients
// SERVEUR (fidèle à fitRecip.gen + balayage drawResCharts du HTML).
// ─────────────────────────────────────────────────────────────────────────────
describe('buildInverseCurvePoints', () => {
  it('given A/B/Vs/pL, when on balaie, then applique V=Vs+1/(A+B·p) et clampe (inv>0, V0<v<V0+vLim×3,5)', () => {
    const pts = buildInverseCurvePoints(0.01, -0.001, 500, 1, 0, 200, 4);
    // pMax = 1×1,4 = 1,4 MPa, 4 pas -> pMPa = 0 / 0,35 / 0,7 / 1,05 / 1,4 (bar = ×10)
    // i=3 (pBar=10,5) et i=4 (pBar=14) donnent inv<=0 -> exclus.
    expect(pts).toHaveLength(3);
    expect(pts[0].pMPa).toBeCloseTo(0, 6);
    expect(pts[0].vCm3).toBeCloseTo(600, 6); // 500 + 1/0,01
    expect(pts[1].pMPa).toBeCloseTo(0.35, 6);
    expect(pts[1].vCm3).toBeCloseTo(500 + 1 / 0.0065, 6);
    expect(pts[2].pMPa).toBeCloseTo(0.7, 6);
    expect(pts[2].vCm3).toBeCloseTo(500 + 1 / 0.003, 6);
  });

  it('given V0 <= 0 ou pLMPa <= 0, when on balaie, then renvoie [] (fail-safe)', () => {
    expect(buildInverseCurvePoints(0.01, -0.001, 0, 1, 0, 200)).toEqual([]);
    expect(buildInverseCurvePoints(0.01, -0.001, 500, 0, 0, 200)).toEqual([]);
  });

  it('exclut les pas en-deçà de la pression corrigée du premier point mesuré', () => {
    const pts = buildInverseCurvePoints(0.01, -0.001, 500, 1, 5, 200, 4);
    // Avec firstPCorrBar=5, seuls les pas dont pBar>=5 sont conservés (i>=1 : pBar=3,5 exclu aussi).
    expect(pts.every((p) => p.pMPa * 10 >= 5)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PressioCourbeCorrigee — courbe P–V corrigée + extrapolation + annotations.
// ─────────────────────────────────────────────────────────────────────────────
const COURBE: PressioCourbePoint[] = [
  { p: 2, pCorr: 1.8, v60: 24, d6030: 2, phase: 'Recompression' },
  { p: 4, pCorr: 3.8, v60: 89, d6030: 1, phase: 'Pseudo-élast.' },
  { p: 6, pCorr: 5.8, v60: 160, d6030: 4, phase: 'Plastique' },
];

describe('PressioCourbeCorrigee', () => {
  it('given une courbe >= 2 points, when rendu, then trace le SVG avec les annotations p1/pf/pLM', () => {
    const html = renderToStaticMarkup(
      <PressioCourbeCorrigee
        courbe={COURBE}
        V0={535}
        a={0.0147}
        b={-0.003}
        pLMPa={0.6}
        vLim={670}
        p0={0.2}
        pf={0.4}
      />,
    );
    expect(html).toContain('<svg');
    expect(html).toContain('pLM');
    expect(html).toContain('p₁');
    expect(html).toContain('pf');
    expect(html).toContain('Vs+2V(p₀)');
  });

  it('given moins de 2 points, when rendu, then affiche le message de garde (pas de crash)', () => {
    const html = renderToStaticMarkup(
      <PressioCourbeCorrigee
        courbe={[COURBE[0]]}
        V0={535}
        a={0.01}
        b={-0.001}
        pLMPa={0.6}
        vLim={670}
        p0={0.2}
        pf={0.4}
      />,
    );
    expect(html).toContain('Pas assez de mesures corrigées');
    expect(html).not.toContain('<svg');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BaudSpectralChart + ProfilDepthChart — profil multi-profondeurs.
// ─────────────────────────────────────────────────────────────────────────────
function profilRow(over: Partial<ProfilRow> = {}): ProfilRow {
  return {
    label: '3.0 m',
    z: 3,
    EM: 3.4,
    pL_MPa: 0.6,
    pLNette_MPa: 0.58,
    pf_MPa: 0.4,
    ratio: 7.5,
    alpha: 0.67,
    categorie: 'Sol mou (cat. B)',
    ...over,
  };
}

describe('BaudSpectralChart', () => {
  it('given des profondeurs exploitables, when rendu, then place un point par profondeur et les iso-lignes E/P', () => {
    const html = renderToStaticMarkup(
      <BaudSpectralChart
        rows={[
          profilRow(),
          profilRow({ label: '5.0 m', z: 5, pLNette_MPa: 1.2, ratio: 12 }),
        ]}
      />,
    );
    expect(html).toContain('data-testid="baud-pt-0"');
    expect(html).toContain('data-testid="baud-pt-1"');
    expect(html).toContain('E/P=4');
    expect(html).toContain('E/P=22');
  });

  it('given aucune profondeur exploitable, when rendu, then affiche un message (pas de crash)', () => {
    const html = renderToStaticMarkup(<BaudSpectralChart rows={[]} />);
    expect(html).toContain('Aucune profondeur exploitable');
  });
});

describe('ProfilDepthChart', () => {
  it('given des profondeurs, when rendu, then trace le SVG (EM + pL/pf)', () => {
    const html = renderToStaticMarkup(
      <ProfilDepthChart rows={[profilRow(), profilRow({ label: '5.0 m', z: 5 })]} />,
    );
    expect(html).toContain('<svg');
    expect(html).toContain('E_M (MPa)');
  });

  it('given aucune ligne, when rendu, then ne rend rien (pas de crash)', () => {
    expect(renderToStaticMarkup(<ProfilDepthChart rows={[]} />)).toBe('');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Étalonnage / Calibrage — courbes reconstruites à partir des résidus SERVEUR.
// ─────────────────────────────────────────────────────────────────────────────
const ETAL_RESIDUS: PressioEtalonnageResidu[] = [
  { p: 0.2, vMesure: 525, vAjuste: 508.18, residu: 16.82 },
  { p: 0.4, vMesure: 548, vAjuste: 545.1, residu: 2.9 },
  { p: 0.6, vMesure: 574, vAjuste: 582.0, residu: -8.0 },
];
const CALIB_RESIDUS: PressioCalibrageResidu[] = [
  { p: 1, v60Mesure: 10, v60Ajuste: 9.9, residu: 0.1 },
  { p: 2, v60Mesure: 20, v60Ajuste: 19.8, residu: 0.2 },
  { p: 3, v60Mesure: 30, v60Ajuste: 30.1, residu: -0.1 },
];

describe('EtalonnageChart', () => {
  it('given des résidus + Pe/vPe, when rendu, then trace la courbe et annote Pe', () => {
    const html = renderToStaticMarkup(
      <EtalonnageChart residus={ETAL_RESIDUS} Pe={0.83} vPe={630} />,
    );
    expect(html).toContain('<svg');
    expect(html).toContain('>Pe<');
  });

  it('given moins de 2 résidus, when rendu, then affiche le message de garde', () => {
    const html = renderToStaticMarkup(
      <EtalonnageChart residus={[ETAL_RESIDUS[0]]} Pe={null} vPe={null} />,
    );
    expect(html).toContain('Pas assez de résidus');
  });
});

describe('CalibrageChart', () => {
  it('given des résidus de calibrage, when rendu, then trace la courbe ajustée + les points mesurés', () => {
    const html = renderToStaticMarkup(<CalibrageChart residus={CALIB_RESIDUS} />);
    expect(html).toContain('<svg');
    expect(html).toContain('<polyline');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DepouillementPanel — panneau composite (KPI + tables + courbe).
// ─────────────────────────────────────────────────────────────────────────────
const DEP: PressioDepouillement = {
  pf: 0.23,
  pE: 0.03,
  p0: 0.11,
  sigmaH0: 0.019,
  z: 2,
  categorieDescription: 'Argile molle, limon. 0,2 ≤ pL < 0,6 MPa.',
  volumes: { vE: 23.6, v0: 69.2, vf: 128.6, vLim: 673.4 },
  extrapolation: {
    a: 0.014688,
    b: -0.003007,
    plmVLim: 0.43912,
    plmAsymptote: 0.48851,
    errV: 0.1326,
  },
  synthese: { beta: 1.5, mE: 49.5, plageAutoDebutL: 1, plageAutoFinL: 7 },
  courbe: COURBE,
};

describe('DepouillementPanel', () => {
  it('given dep + KPI, when rendu, then affiche les KPI kg4, l’extrapolation, les tables et les mesures corrigées', () => {
    const html = renderToStaticMarkup(
      <DepouillementPanel
        dep={DEP}
        V0={535}
        kpiEM={3.4064}
        kpiPL={0.43911}
        kpiPf={0.23}
        kpiRatio={7.7574}
        kpiPLNette={0.42011}
        kpiPfNette={0.211}
        kpiAlpha={0.67}
        kpiEy={5.0842}
        kpiMethode="Extrapolé (§D.4.3.2)"
      />,
    );
    expect(html).toContain('data-testid="pressio-depouillement"');
    expect(html).toContain('p_L (limite)');
    expect(html).toContain('P_f');
    expect(html).toContain('E/P_LM');
    expect(html).toContain('P*_LM');
    expect(html).toContain('α Ménard');
    expect(html).toContain('Extrapolation p');
    expect(html).toContain('Extrapolé (§D.4.3.2)');
    expect(html).toContain('Tableau des mesures corrigées');
    expect(html).toContain('Plage auto L1→L7');
    // 3 lignes de mesures corrigées (COURBE) avec badge de phase.
    expect(html).toContain('data-testid="mesure-corrigee-0"');
    expect(html).toContain('data-testid="mesure-corrigee-2"');
    expect(html).toContain('Plastique');
  });
});
