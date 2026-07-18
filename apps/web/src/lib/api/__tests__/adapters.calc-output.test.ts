/**
 * Tests — adaptCalcResult / normalizeOutput : MÉTADONNÉE DE CONFORMITÉ SEULE.
 *
 * Nouveau paradigme (ADR 0015 — clone d'UI client) : le résultat détaillé d'un
 * calcul ne se reconstruit plus en React (ancien tableau Grandeur/Valeur/Unité/
 * Statut, cf. `buildBurmisterRows` & consorts, RETIRÉS). Il se consulte dans le
 * clone d'UI du logiciel (`CalcResult.rawOutput`) ou dans le PV scellé.
 * `normalizeOutput` ne dérive donc plus qu'un verdict de conformité ({verdict}),
 * strictement fail-closed (DoD §8) : jamais l'objet brut, jamais un champ nommé
 * du moteur.
 *
 * Ce fichier remplace `adapters.burmister.test.ts` + `adapters.engines.test.ts`
 * (qui testaient les builders de lignes retirés). Given/When/Then (BDD).
 */

import { describe, it, expect } from 'vitest';

import { adaptCalcResult, type PrismaCalcResult } from '../adapters';
import type { NormalizedCalcOutput } from '../types';

function makeRaw(overrides: Partial<PrismaCalcResult> = {}): PrismaCalcResult {
  return {
    id: 'calc_x',
    projectId: 'proj_01',
    orgId: 'org_01',
    engineId: 'chaussee-burmister',
    input: {},
    output: null,
    createdAt: '2026-07-17T10:00:00.000Z',
    ...overrides,
  };
}

function outputOf(overrides: Partial<PrismaCalcResult> = {}): NormalizedCalcOutput | null {
  return adaptCalcResult(makeRaw(overrides)).output as NormalizedCalcOutput | null;
}

describe('adaptCalcResult — statut dérivé de la sortie (régression réelle prod)', () => {
  it('given output présent sans erreur, when adapté, then status = DONE', () => {
    const r = adaptCalcResult(makeRaw({ output: { conforme: true } }));
    expect(r.status).toBe('DONE');
  });

  it('given output.erreur non null, when adapté, then status = ERROR', () => {
    const r = adaptCalcResult(makeRaw({ output: { erreur: 'profil invalide' } }));
    expect(r.status).toBe('ERROR');
  });

  it('given pas de sortie et statut backend valide, when adapté, then on garde ce statut', () => {
    const r = adaptCalcResult(makeRaw({ output: null, status: 'PENDING' }));
    expect(r.status).toBe('PENDING');
  });

  it('given pas de sortie ni statut backend, when adapté, then statut neutre (PENDING)', () => {
    const r = adaptCalcResult(makeRaw({ output: null }));
    expect(r.status).toBe('PENDING');
  });

  it('given engineId canonique sans label/domain, when adapté, then label=engineId et domain=CH', () => {
    const r = adaptCalcResult(makeRaw({ output: { conforme: true } }));
    expect(r.label).toBe('chaussee-burmister');
    expect(r.domain).toBe('CH');
  });
});

describe('normalizeOutput — dispatch verdict par moteur (aucune ligne construite)', () => {
  it('given burmister conforme=true, when adapté, then verdict PASS et RIEN d’autre', () => {
    const out = outputOf({ output: { conforme: true, NE: 1243500 } });
    expect(out).toEqual({ verdict: 'PASS' });
  });

  it('given burmister conforme=false, when adapté, then verdict FAIL', () => {
    const out = outputOf({ output: { conforme: false } });
    expect(out).toEqual({ verdict: 'FAIL' });
  });

  it('given une sortie déjà {verdict, rows}, when adapté, then SEUL le verdict est conservé (rows jetées)', () => {
    const out = outputOf({
      output: { verdict: 'PASS', rows: [{ label: 'X', value: 1, unit: 'm', _secret: 'kc=1.3' }] },
    });
    expect(out).toEqual({ verdict: 'PASS' });
  });

  it('given terzaghi (cas[] tous portants), when adapté, then verdict PASS', () => {
    const out = outputOf({
      engineId: 'fondation-superficielle',
      output: { cas: [{ invalide: false, portanceOk: true }] },
    });
    expect(out).toEqual({ verdict: 'PASS' });
  });

  it('given terzaghi (aucun cas valide), when adapté, then verdict FAIL', () => {
    const out = outputOf({
      engineId: 'fondation-superficielle',
      output: { cas: [{ invalide: true }] },
    });
    expect(out).toEqual({ verdict: 'FAIL' });
  });

  // MAJEUR-1 (non-régression) : l'excentrement DOIT peser dans le verdict terzaghi.
  // AVANT correctif : un cas portanceOk+glissementOk mais excOk=false affichait PASS
  // (faux PASS scellable dans un PV). terzaghiVerdict conservé tel quel (ADR 0015).
  it('MAJEUR-1 : given portanceOk+glissementOk mais excOk=false, when adapté, then verdict FAIL', () => {
    const out = outputOf({
      engineId: 'fondation-superficielle',
      output: {
        cas: [
          { invalide: false, portanceOk: true, glissementOk: true, excOk: false },
        ],
      },
    });
    expect(out).toEqual({ verdict: 'FAIL' });
  });

  it('given pieux allOk=true, when adapté, then verdict PASS', () => {
    const out = outputOf({ engineId: 'fondation-profonde-pieux', output: { allOk: true } });
    expect(out).toEqual({ verdict: 'PASS' });
  });

  it('given pieux allOk=false, when adapté, then verdict FAIL', () => {
    const out = outputOf({ engineId: 'fondation-profonde-pieux', output: { allOk: false } });
    expect(out).toEqual({ verdict: 'FAIL' });
  });

  it.each([
    ['radier-plaque', { betaGov: 0.5, nRafts: 1 }],
    ['labo-classification-gtr', { classe: { code: 'A2' } }],
    ['pressiometre-menard', { categorie: 'B', pL: 4.39 }],
    ['pressio-etalonnage', { Vs: 520, Pe: 0.8 }],
    ['pressio-calibrage', { a: 0.5, R2: 0.99, rms: 0.06 }],
    ['axi-plaque', { wc: 6, wEdge: 2 }],
    ['plane-strain', { decolN: 0, mMax: 100 }],
    ['radier-tri', { reactionMax: 80, nRaft: 1 }],
  ])(
    'given un moteur d’ANALYSE %s (pas de verdict de conformité), when adapté, then verdict NA',
    (engineId, output) => {
      const out = outputOf({ engineId, output });
      expect(out).toEqual({ verdict: 'NA' });
    },
  );

  it('given un output moteur INCONNU, when adapté, then output=null (fail-closed, aucune donnée brute)', () => {
    const out = outputOf({
      engineId: 'fondation-terzaghi-v0',
      output: { qadm: 250, methode: 'Terzaghi §5.3', _kc: 1.3, warnings: ['confidentiel'] },
    });
    expect(out).toBeNull();
  });

  it('given output null, then output reste null et ne crash pas', () => {
    const out = outputOf({ output: null });
    expect(out).toBeNull();
  });
});

describe('normalizeOutput — fail-closed : aucun champ/valeur du moteur ne traverse (DoD §8)', () => {
  it('given une sortie burmister avec intermédiaires confidentiels, then la sortie normalisée est EXACTEMENT {verdict}', () => {
    const out = outputOf({
      output: {
        conforme: false,
        _D: { sz: 0.42, kr: 1.3, ks: 0.9, kc: 1.3, Sh: 0.25 },
        propagateur: { A: 1, B: 2, C: 3, Dm: 4 },
        famille: 'bitumineuse épaisse (§4.2)',
        warnings: ['Coefficient de calage kc=1.3 appliqué (confidentiel)'],
      },
    });
    expect(out).toEqual({ verdict: 'FAIL' });
    expect(Object.keys(out as object)).toEqual(['verdict']);
  });

  it('given une sortie terzaghi avec warnings/régime/capaciteReference, then la sortie normalisée est EXACTEMENT {verdict}', () => {
    const out = outputOf({
      engineId: 'fondation-superficielle',
      output: {
        warnings: ['Sondage très court : tassement indicatif.'],
        regime: 'superficielle',
        capaciteReference: { A: 60, R0: 5400 },
        cas: [{ invalide: false, portanceOk: true }],
      },
    });
    expect(out).toEqual({ verdict: 'PASS' });
  });
});
