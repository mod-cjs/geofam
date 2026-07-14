/**
 * Tests — GEOPLAQUE, ouverture du formulaire aux options Sol (décision titulaire du
 * 14/07 : « tout ouvrir »). Le contrat back accepte déjà (packages/engines/src/radier/
 * contract.ts OptsSchema, lecture seule) : Winkler (kWink/winkDecol/pLimWink), champ
 * libre (ffG0/ffGx/ffGy), pendage (dipX/dipY), excavation (sigV0/kRec/foundD) et
 * `lineSprings` (top-level, comme pointSprings).
 *
 * DoD §9 : given/when/then, bornes, non-régression (payload minimal identique à avant
 * quand aucune option n'est activée — aucune valeur par défaut parasite envoyée).
 */

import { describe, it, expect } from 'vitest';

import { buildGeoplaquePayload, type GeoplaqueForm } from '../page';

function form(over: Partial<GeoplaqueForm> = {}): GeoplaqueForm {
  return {
    projet: 'Radier R1',
    pts: [
      { x: '0', y: '0' },
      { x: '6', y: '0' },
      { x: '6', y: '6' },
      { x: '0', y: '6' },
    ],
    E: '30000',
    nu: '0.2',
    e: '0.4',
    layers: [{ zBase: '10', E: '8', nu: '0.33' }],
    mesh: '0.5',
    decol: false,
    qLim: '',
    pointLoads: [],
    lineLoads: [],
    areaLoads: [{ x1: '0', y1: '0', x2: '6', y2: '6', q: '50', on: 'raft' }],
    pointSprings: [],
    ...over,
  };
}

describe('buildGeoplaquePayload — non-régression : aucune option Sol activée', () => {
  it('given un formulaire par défaut (nouvelles options absentes/à zéro), then le payload est identique à avant (pas de clé parasite)', () => {
    const p = buildGeoplaquePayload(form());
    expect(p.opts).toEqual({ mesh: 0.5, decol: false });
    expect(Object.prototype.hasOwnProperty.call(p, 'lineSprings')).toBe(false);
  });

  it('given des champs Sol renseignés mais à leur valeur neutre (0 / défaut), then aucune clé parasite dans opts', () => {
    const p = buildGeoplaquePayload(
      form({
        dipX: '0',
        dipY: '0',
        foundD: '0',
        excGamma: '18',
        kRec: '1',
        ffG0: '0',
        ffGx: '0',
        ffGy: '0',
        kWink: '0',
        winkDecol: false,
        pLimWink: '0',
        lineSprings: [],
      }),
    );
    expect(p.opts).toEqual({ mesh: 0.5, decol: false });
    expect(Object.prototype.hasOwnProperty.call(p, 'lineSprings')).toBe(false);
  });
});

describe('buildGeoplaquePayload — pendage (dipX/dipY), OptsSchema min -10 / max 10', () => {
  it('given dipX/dipY non nuls, then transportés dans opts (nombres)', () => {
    const p = buildGeoplaquePayload(form({ dipX: '0.05', dipY: '-0.02' }));
    expect(p.opts).toMatchObject({ dipX: 0.05, dipY: -0.02 });
  });

  it('given des valeurs aux bornes du contrat (±10), then transportées telles quelles', () => {
    const p = buildGeoplaquePayload(form({ dipX: '10', dipY: '-10' }));
    expect(p.opts).toMatchObject({ dipX: 10, dipY: -10 });
  });

  it('given seulement dipX renseigné, then dipY absent (pas envoyé à 0 par défaut)', () => {
    const p = buildGeoplaquePayload(form({ dipX: '0.1' }));
    const opts = p.opts as Record<string, unknown>;
    expect(opts.dipX).toBe(0.1);
    expect(Object.prototype.hasOwnProperty.call(opts, 'dipY')).toBe(false);
  });
});

describe('buildGeoplaquePayload — fondation en profondeur / fond de fouille (foundD, sigV0 dérivé, kRec)', () => {
  it('given foundD > 0 et γ renseigné, then foundD ET sigV0 = foundD×γ transportés', () => {
    const p = buildGeoplaquePayload(form({ foundD: '2', excGamma: '18' }));
    expect(p.opts).toMatchObject({ foundD: 2, sigV0: 36 });
  });

  it('given foundD > 0 sans γ, then foundD seul (pas de sigV0 sans base de calcul)', () => {
    const p = buildGeoplaquePayload(form({ foundD: '2', excGamma: '' }));
    const opts = p.opts as Record<string, unknown>;
    expect(opts.foundD).toBe(2);
    expect(Object.prototype.hasOwnProperty.call(opts, 'sigV0')).toBe(false);
  });

  it('given kRec > 1 (recompression active), then kRec transporté', () => {
    const p = buildGeoplaquePayload(form({ foundD: '2', excGamma: '18', kRec: '2.5' }));
    expect(p.opts).toMatchObject({ foundD: 2, sigV0: 36, kRec: 2.5 });
  });

  it('given kRec = 1 (défaut, pas de recompression), then kRec absent', () => {
    const p = buildGeoplaquePayload(form({ foundD: '2', excGamma: '18', kRec: '1' }));
    const opts = p.opts as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(opts, 'kRec')).toBe(false);
  });

  it('given foundD = 0 (fondation en surface), then ni foundD ni sigV0 envoyés même si γ/kRec renseignés', () => {
    const p = buildGeoplaquePayload(form({ foundD: '0', excGamma: '20', kRec: '3' }));
    const opts = p.opts as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(opts, 'foundD')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(opts, 'sigV0')).toBe(false);
    // kRec seul, sans assise, reste transporté si >1 (le moteur ne l'active que si sigV0>0 aussi).
    expect(opts.kRec).toBe(3);
  });
});

describe('buildGeoplaquePayload — mouvement du sol en champ libre (ffG0/ffGx/ffGy, mm / mm/m)', () => {
  it('given les 3 champs renseignés, then transportés (nombres, mm et mm/m)', () => {
    const p = buildGeoplaquePayload(form({ ffG0: '10', ffGx: '2', ffGy: '-1.5' }));
    expect(p.opts).toMatchObject({ ffG0: 10, ffGx: 2, ffGy: -1.5 });
  });

  it('given un tassement imposé négatif (soulèvement), then transporté tel quel', () => {
    const p = buildGeoplaquePayload(form({ ffG0: '-5' }));
    expect(p.opts).toMatchObject({ ffG0: -5 });
  });

  it('given un seul champ non nul, then les 2 autres absents', () => {
    const p = buildGeoplaquePayload(form({ ffGx: '3' }));
    const opts = p.opts as Record<string, unknown>;
    expect(opts.ffGx).toBe(3);
    expect(Object.prototype.hasOwnProperty.call(opts, 'ffG0')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(opts, 'ffGy')).toBe(false);
  });
});

describe('buildGeoplaquePayload — appuis répartis Winkler (kWink/winkDecol/pLimWink)', () => {
  it('given kWink > 0, then transporté (kN/m³)', () => {
    const p = buildGeoplaquePayload(form({ kWink: '5000' }));
    expect(p.opts).toMatchObject({ kWink: 5000 });
  });

  it('given kWink > 0 et compression seule cochée, then winkDecol=true transporté', () => {
    const p = buildGeoplaquePayload(form({ kWink: '5000', winkDecol: true }));
    expect(p.opts).toMatchObject({ kWink: 5000, winkDecol: true });
  });

  it('given kWink = 0, then winkDecol/pLimWink jamais envoyés même si renseignés (Winkler désactivé)', () => {
    const p = buildGeoplaquePayload(
      form({ kWink: '0', winkDecol: true, pLimWink: '200' }),
    );
    const opts = p.opts as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(opts, 'kWink')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(opts, 'winkDecol')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(opts, 'pLimWink')).toBe(false);
  });

  it('given kWink > 0 avec plastification pLimWink > 0, then transportée', () => {
    const p = buildGeoplaquePayload(form({ kWink: '5000', pLimWink: '150' }));
    expect(p.opts).toMatchObject({ kWink: 5000, pLimWink: 150 });
  });

  it('given kWink > 0 sans winkDecol coché, then winkDecol absent (pas envoyé à false par défaut)', () => {
    const p = buildGeoplaquePayload(form({ kWink: '5000' }));
    const opts = p.opts as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(opts, 'winkDecol')).toBe(false);
  });
});

describe('buildGeoplaquePayload — lineSprings (ressorts linéiques, top-level comme pointSprings)', () => {
  it('given au moins un ressort linéique, then transporté en nombres', () => {
    const p = buildGeoplaquePayload(
      form({
        lineSprings: [{ x1: '0', y1: '0', x2: '6', y2: '0', k: '2000' }],
      }),
    );
    expect(p.lineSprings).toEqual([{ x1: 0, y1: 0, x2: 6, y2: 0, k: 2000 }]);
  });

  it('given plusieurs ressorts linéiques, then tous transportés dans l’ordre', () => {
    const p = buildGeoplaquePayload(
      form({
        lineSprings: [
          { x1: '0', y1: '0', x2: '6', y2: '0', k: '2000' },
          { x1: '0', y1: '6', x2: '6', y2: '6', k: '1500' },
        ],
      }),
    );
    expect(p.lineSprings).toEqual([
      { x1: 0, y1: 0, x2: 6, y2: 0, k: 2000 },
      { x1: 0, y1: 6, x2: 6, y2: 6, k: 1500 },
    ]);
  });

  it('given un tableau vide (ou absent), then la clé lineSprings est absente du payload (pas de tableau parasite)', () => {
    expect(
      Object.prototype.hasOwnProperty.call(
        buildGeoplaquePayload(form({ lineSprings: [] })),
        'lineSprings',
      ),
    ).toBe(false);
    expect(
      Object.prototype.hasOwnProperty.call(buildGeoplaquePayload(form()), 'lineSprings'),
    ).toBe(false);
  });
});

describe('buildGeoplaquePayload — DoD §8 : les nouvelles options restent un payload PUR (bornées, aucun résultat)', () => {
  it('given toutes les options Sol activées, then aucune grandeur de résultat ni champ nodal', () => {
    const p = buildGeoplaquePayload(
      form({
        dipX: '0.05',
        dipY: '-0.02',
        foundD: '2',
        excGamma: '18',
        kRec: '2',
        ffG0: '10',
        ffGx: '2',
        ffGy: '-1.5',
        kWink: '5000',
        winkDecol: true,
        pLimWink: '150',
        lineSprings: [{ x1: '0', y1: '0', x2: '6', y2: '0', k: '2000' }],
      }),
    );
    for (const forbidden of [
      'wMax',
      'betaGov',
      'w',
      'nodeX',
      'nodeY',
      'champDeflexion',
      'vals',
      'ki',
      'kj',
      'slope',
    ]) {
      expect(Object.prototype.hasOwnProperty.call(p, forbidden)).toBe(false);
    }
  });
});
