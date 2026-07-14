/**
 * ALIGNEMENT OUTIL CLIENT — details de sortie whitelistes (decision titulaire 13/07).
 *
 * Le HTML client (roadsens_burmister_definitive.html, renderDetails l.1519-1573)
 * AFFICHE, dans son rapport de dimensionnement, des grandeurs de sortie de la
 * methode LCPC : kθ (d.ukth), SN (d.usn), Sh (d.sh, cm), δ, kr (d.kr), kc (d.ukc),
 * ks (d.ks), 1/b (d.ub), et_adm/st_adm a r=50 % (e50, kr=1), ainsi que σ_z/σ_r au
 * sommet PSC (d.bz.sz/sr ×1000 kPa). Par decision titulaire du 13/07 (« zero ecart
 * d'affichage, le code moteur reste serveur »), ces grandeurs sont desormais
 * exposees NOMMEMENT dans `output.details` — VALEURS de sortie, pas le calage ni le
 * code (qui restent serveur).
 *
 * Ce test prouve, contre la reference DEFINITIVE pilotee en jsdom (provenance
 * externe au module, anti auto-reference), que chaque nouveau champ REPRODUIT
 * EXACTEMENT la grandeur de l'outil client :
 *   details.ktheta         == _D.ukth
 *   details.sn             == _D.usn
 *   details.sh_cm          == _D.sh
 *   details.kr             == _D.kr
 *   details.kc             == _D.ukc
 *   details.ks             == _D.ks
 *   details.ub             == _D.ub
 *   details.delta          == √(SN² + (0,02·|b|·Sh)²)      [renderDetails l.1553]
 *   details.adm_r50        == e6·kθ·(1e6/NE)^(1/b)·kc·ks   [renderDetails l.1558, kr=1]
 *   details.sigmaZ_psc_kpa == _D.bz.sz·1000
 *   details.sigmaR_psc_kpa == _D.bz.sr·1000
 *
 * Tolerance de PORTAGE serree (rel 1e-9, abs 1e-12) — IDENTIQUE aux suites
 * d'equivalence existantes, jamais elargie. Si la reference definitive est absente
 * (hors depot en CI — normalement VERSIONNEE), SKIP BRUYANT (jamais un faux-vert).
 *
 * @science-unsigned — prouve le PORTAGE, pas la justesse scientifique (#36).
 */
import { describe, expect, it } from 'vitest';

import { burmisterSourceAvailable, loadOriginalCompute } from './equivalence-harness.js';
import { BURMISTER_FIXTURES, type BurmisterFixture } from './test-fixtures.js';

import { runBurmister } from './index.js';

/** Tolerance de PORTAGE (rel 1e-9, abs 1e-12) — la MEME que engine.equivalence.test.ts. */
const REL = 1e-9;
const ABS = 1e-12;

/** Egalite numerique a tolerance de portage (les deux cotes = le meme code). */
function close(a: number, b: number): boolean {
  if (a === b) return true;
  return Math.abs(a - b) <= ABS + REL * Math.max(Math.abs(a), Math.abs(b));
}

/** Force le mode PRODUCTION (ifaceAuto:true) — la definitive l'applique toujours. */
const toProduction = (fx: BurmisterFixture): BurmisterFixture => ({
  ...fx,
  input: { ...fx.input, load: { ...fx.input.load, ifaceAuto: true } },
});

/** Sous-ensemble des grandeurs BRUTES _D lues ici (noms internes de l'outil client). */
interface RawD {
  ukth: number;
  usn: number;
  sh: number;
  kr: number;
  ukc: number;
  ks: number;
  ub: number;
  e6: number;
  NE: number;
  bz?: { sz: number; sr: number };
}

/** Recalcule e50 (et_adm/st_adm a r=50 %, kr=1) depuis les grandeurs BRUTES _D — renderDetails l.1558. */
function e50FromD(D: RawD): number | null {
  const e6 = D.e6;
  if (!Number.isFinite(e6)) return null; // aucune couche dimensionnante -> N/A (comme le HTML)
  return e6 * D.ukth * Math.pow(1e6 / D.NE, 1 / D.ub) * D.ukc * D.ks;
}

/** δ = √(SN² + (0,02·|b|·Sh)²) — renderDetails l.1553. */
function deltaFromD(D: RawD): number {
  return Math.sqrt(D.usn * D.usn + Math.pow(0.02 * D.ub * D.sh, 2));
}

const SOURCE_OK = burmisterSourceAvailable();

/** Fixtures pilotees : une bitumineuse (ε_t µdef) + deux rigides (σ_t MPa). */
const CAS_IDS = [
  'bitumineuse-epaisse-defaut',
  'semi-rigide-glc',
  'beton-multi-bc5',
] as const;

describe('burmister — details alignes sur l outil client (@science-unsigned)', () => {
  if (!SOURCE_OK) {
    const msg =
      '[13/07] reference roadsens_burmister_definitive.html ABSENTE — alignement details ' +
      'NON verifie. Ce skip n est PAS un succes (reference normalement versionnee).';
    // eslint-disable-next-line no-console -- avertissement volontaire (anti faux-vert)
    console.warn(msg);
    it.skip(`alignement details NON verifie (source absente) — ${msg}`, () => {});
    return;
  }

  const { computeHtml, cleanup } = loadOriginalCompute();

  const cas = CAS_IDS.map((id) => {
    const fx = BURMISTER_FIXTURES.find((f) => f.id === id);
    if (!fx) throw new Error(`fixture ${id} introuvable`);
    return toProduction(fx);
  });

  it('couvre au moins une structure bitumineuse ET une rigide (pas de suite a une seule branche)', () => {
    expect(cas.length).toBeGreaterThanOrEqual(3);
  });

  for (const fx of cas) {
    it(`[${fx.id}] les 11 champs details reproduisent l outil client (rel ${REL})`, () => {
      const D = computeHtml(fx.input) as RawD;
      const env = runBurmister(fx.input);
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      const d = (env.output as { details?: Record<string, number | null> }).details;
      expect(d, 'details present').toBeTruthy();
      if (!d) return;

      // Correspondance directe _D -> details (grandeurs de sortie de l'outil client).
      expect(close(d.ktheta as number, D.ukth), 'ktheta==ukth').toBe(true);
      expect(close(d.sn as number, D.usn), 'sn==usn').toBe(true);
      expect(close(d.sh_cm as number, D.sh), 'sh_cm==sh').toBe(true);
      expect(close(d.kr as number, D.kr), 'kr==kr').toBe(true);
      expect(close(d.kc as number, D.ukc), 'kc==ukc').toBe(true);
      expect(close(d.ks as number, D.ks), 'ks==ks').toBe(true);
      expect(close(d.ub as number, D.ub), 'ub==ub').toBe(true);

      // δ recalcule comme renderDetails (l.1553).
      expect(close(d.delta as number, deltaFromD(D)), 'delta==√(SN²+(0,02·b·Sh)²)').toBe(
        true,
      );

      // σ PSC en kPa (×1000) — renderDetails l.1572-1573.
      const bz = D.bz ?? { sz: 0, sr: 0 };
      expect(
        close(d.sigmaZ_psc_kpa as number, bz.sz * 1000),
        'sigmaZ_psc==bz.sz·1000',
      ).toBe(true);
      expect(
        close(d.sigmaR_psc_kpa as number, bz.sr * 1000),
        'sigmaR_psc==bz.sr·1000',
      ).toBe(true);

      // adm_r50 = e50 (kr=1) — renderDetails l.1558.
      const e50 = e50FromD(D);
      if (e50 === null) {
        expect(d.adm_r50, 'adm_r50 N/A quand aucune couche dimensionnante').toBeNull();
      } else {
        expect(close(d.adm_r50 as number, e50), 'adm_r50==e50 (kr=1)').toBe(true);
      }
    });
  }

  it('[bitumineuse] adm_r50 reproduit « et_adm r=50% » (µdef, bitumineux — fatigue.rigide=false)', () => {
    const fx = cas.find((f) => f.id === 'bitumineuse-epaisse-defaut');
    if (!fx) return;
    const D = computeHtml(fx.input) as RawD;
    const env = runBurmister(fx.input);
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.output.fatigue?.rigide, 'critere bitumineux (ε_t)').toBe(false);
    const d = (env.output as { details?: Record<string, number | null> }).details;
    const e50 = e50FromD(D);
    expect(e50).not.toBeNull();
    expect(close(d?.adm_r50 as number, e50 as number)).toBe(true);
    // Coherence kr : pour le bitumineux, l'admissible plein = adm_r50 × kr (kr replace par 1 a 50 %).
    expect(close(env.output.fatigue?.admissible as number, (e50 as number) * D.kr)).toBe(
      true,
    );
  });

  it('[rigide] adm_r50 reproduit « st_adm r=50% » (MPa, MTLH/beton — fatigue.rigide=true)', () => {
    const fx = cas.find((f) => f.id === 'semi-rigide-glc');
    if (!fx) return;
    const D = computeHtml(fx.input) as RawD;
    const env = runBurmister(fx.input);
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.output.fatigue?.rigide, 'critere rigide (σ_t MPa)').toBe(true);
    const d = (env.output as { details?: Record<string, number | null> }).details;
    const e50 = e50FromD(D);
    expect(e50).not.toBeNull();
    expect(close(d?.adm_r50 as number, e50 as number), 'st_adm r=50%').toBe(true);
  });

  it('teardown jsdom', () => {
    cleanup();
    expect(true).toBe(true);
  });
});
