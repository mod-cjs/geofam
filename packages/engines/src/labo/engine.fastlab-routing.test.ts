/**
 * FASTLAB — routage entrées CBR ↔ cisaillement (sentinelles de fidélité).
 *
 * Ces tests NE touchent PAS le moteur (engine.ts, transcription figée) : ils
 * VERROUILLENT le CONTRAT de clés que le front doit émettre après correction du
 * misroute (cf. apps/web fastlab). Ils prouvent, côté science :
 *   (a) une saisie CBR seule (cb_*) NE fabrique AUCUN c′/φ′ — le CBR ne pilote pas
 *       calcCisail (anti-misroute) ;
 *   (b) le cisaillement dédié (ci_*) produit bien c′/φ′ (droite de Mohr) ;
 *   (c) le type IPI est atteignable (cbType='ipi' → cbrType='ipi').
 *
 * Si un jour les ids de mesure attendus par le moteur changeaient, ces sentinelles
 * cassent — elles fixent les clés exactes que le portage front doit alimenter.
 */
import { describe, it, expect } from 'vitest';

import { runLabo } from './index.js';

/** Moules CBR (55/25/10 coups) : masses + poinçonnement à 2,5 (idx 6) et 5 mm (idx 9). */
const CBR_MOULES: Record<string, string> = {
  cb_ydmax: '1.9',
  cb_wopt: '11',
  cb_cible: '95',
  cb_tot0: '4200', cb_moule0: '2100', cb_vol0: '2124', cb_w0: '11', cb_pen_0_6: '5.2', cb_pen_0_9: '7.8',
  cb_tot1: '4180', cb_moule1: '2100', cb_vol1: '2124', cb_w1: '11', cb_pen_1_6: '4.1', cb_pen_1_9: '6.0',
  cb_tot2: '4150', cb_moule2: '2100', cb_vol2: '2124', cb_w2: '11', cb_pen_2_6: '2.8', cb_pen_2_9: '4.0',
};

/** Cisaillement direct boîte : 4 paliers (σ′v croissant → droite de Mohr de pente > 0). */
const CISAIL_BOX: Record<string, string> = {
  ciMethod: 'box', ci_shape: 'sq', ci_dim: '60', ci_rs: '2.65',
  ci_N1: '0.36', ci_P1: '0.197',
  ci_N2: '0.72', ci_P2: '0.365',
  ci_N3: '1.08', ci_P3: '0.533',
  ci_N4: '1.44', ci_P4: '0.700',
};

describe('FASTLAB routage — anti-misroute CBR (a)', () => {
  it('une saisie CBR seule ne produit AUCUN c′/φ′/φ′R de cisaillement', () => {
    const env = runLabo({ cbType: 'cbr', ...CBR_MOULES });
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    const { output } = env;
    expect(output.c_cis).toBeNull();
    expect(output.phi_cis).toBeNull();
    expect(output.phiR_cis).toBeNull();
    // ...mais l'indice CBR, lui, est bien calculé.
    expect(typeof output.cbr).toBe('number');
    expect(output.cbrType).toBe('cbr');
  });
});

describe('FASTLAB routage — cisaillement dédié (b)', () => {
  it('les entrées ci_* produisent c′ et φ′ (enveloppe de Mohr-Coulomb)', () => {
    const env = runLabo(CISAIL_BOX);
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    const { output } = env;
    expect(typeof output.phi_cis).toBe('number');
    expect(output.phi_cis as number).toBeGreaterThan(0);
    expect(typeof output.c_cis).toBe('number');
    expect(output.c_cis as number).toBeGreaterThanOrEqual(0);
  });

  it('une saisie cisaillement seule ne fabrique aucun indice CBR', () => {
    const env = runLabo(CISAIL_BOX);
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.output.cbr).toBeNull();
  });
});

describe('FASTLAB routage — IPI atteignable (c)', () => {
  it("cbType='ipi' est propagé jusqu'au type de résultat (cbrType)", () => {
    const env = runLabo({ cbType: 'ipi', ...CBR_MOULES });
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    const { output } = env;
    expect(output.cbrType).toBe('ipi');
    expect(typeof output.cbr).toBe('number');
    // En IPI le gonflement (mesuré après immersion) n'est pas rapporté.
    expect(output.gonfl).toBeNull();
  });
});
