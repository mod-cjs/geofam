/**
 * §8 (correction MAJEUR-1, revue adverse du 14/07) — les PROFILS RADIAUX ne doivent pas
 * reveler la discretisation annulaire (donc `ne`) par balayage du raffinement.
 *
 * Meme demarche que plane-strain (cf. son en-tete detaille). Les `profils` (97 points fixes,
 * interpolation lineaire) sont DECOUPLES du maillage par construction ; `ne` etant une ENTREE
 * UTILISATEUR (o.ne, borne moteur [6,300]), on prouve par CONVERGENCE SOUS RAFFINEMENT
 * (ne=240 vs 120 vs 60) qu'aucune signature `ne`-periodique ne survit dans les profils
 * exposes. METRIQUE : ecart relatif max point-a-point normalise par l'etendue du profil fin ;
 * un profil couple au maillage ne convergerait pas.
 *
 * >>> FINDING REMONTE (titulaire + expert, ne PAS calibrer autour) <<<
 * La REACTION de sol NE CONVERGE PAS au BORD EXTERIEUR (r=R). deflexion/momentR/momentT
 * convergent proprement. La reaction au dernier point (r=R) CROIT ~√ne sans limite
 * (605->857->1213->1716 pour ne=30/60/120/240) — SINGULARITE EF DE BORD, inherente a la
 * methode (present cote HTML d'origine -> science/client), PAS un defaut de portage. Le bord
 * INTERIEUR (r=0) reste stable (~105). Consequence §8 : `profils.reaction` expose une valeur
 * de bord exterieur qui echelonne avec `ne` -> canal d'inference du maillage si `ne` balaye.
 * DECISION requise (titulaire+expert) : masquer l'extremite r=R de la reaction, la borner, ou
 * l'accepter. Le test ci-dessous CARACTERISE l'artefact (sentinelle) au lieu de le cacher.
 */
import { describe, expect, it } from 'vitest';

import { AXI_FIXTURES } from './test-fixtures.js';

import { runAxi } from './index.js';

interface Prof {
  x: number[];
  v: number[];
  unit: string;
  label: string;
}

const fx = (id: string) => {
  const f = AXI_FIXTURES.find((x) => x.id === id);
  if (!f) throw new Error(`fixture "${id}" introuvable`);
  return f;
};

function profils(ne: number): Record<string, Prof> {
  const base = fx('q-reparti-2couches').input;
  const env = runAxi({ ...base, o: { ...base.o, ne } });
  expect(env.ok, `calcul ok ne=${ne}`).toBe(true);
  if (!env.ok) throw new Error('calcul echoue');
  const p = (env.output as unknown as { profils?: Record<string, Prof> }).profils;
  expect(p, `profils presents ne=${ne}`).toBeTruthy();
  return p as Record<string, Prof>;
}

function devWindow(fine: Prof, coarse: Prof, lo = 0, hi = 1): number {
  const span = Math.max(...fine.v.map((x) => Math.abs(x)), 1e-12);
  let maxRel = 0;
  const n = fine.v.length;
  for (let i = Math.floor(n * lo); i < Math.ceil(n * hi); i++) {
    maxRel = Math.max(maxRel, Math.abs(fine.v[i]! - coarse.v[i]!) / span);
  }
  return maxRel;
}

describe('axi profils — presence & abscisses (rappel, ne fin)', () => {
  it('given ne=240, when runAxi, then 4 profils 97 points, rayons croissants', () => {
    const p = profils(240);
    for (const k of ['deflexion', 'momentR', 'momentT', 'reaction']) {
      const prof = p[k];
      expect(prof, `profil ${k}`).toBeTruthy();
      if (!prof) continue;
      expect(prof.x.length).toBe(97);
      expect(prof.v.length).toBe(97);
      for (let i = 1; i < prof.x.length; i++)
        expect(prof.x[i]!).toBeGreaterThan(prof.x[i - 1]!);
    }
  });
});

describe('axi profils — CONVERGENCE sous raffinement (MAJEUR-1 14/07)', () => {
  const fine = profils(240);
  const mid = profils(120);
  const coarse = profils(60);

  it('deflexion converge (plein profil) : ecart DECROIT et reste petit', () => {
    const dMid = devWindow(fine.deflexion!, mid.deflexion!);
    const dCoarse = devWindow(fine.deflexion!, coarse.deflexion!);
    expect(dMid, `deflexion converge (mid<coarse)`).toBeLessThan(dCoarse);
    expect(dCoarse, `deflexion sous plafond`).toBeLessThan(0.02);
  });

  it('momentR converge (plein profil) : ecart DECROIT et reste petit', () => {
    const dMid = devWindow(fine.momentR!, mid.momentR!);
    const dCoarse = devWindow(fine.momentR!, coarse.momentR!);
    expect(dMid, `momentR converge (mid<coarse)`).toBeLessThan(dCoarse);
    expect(dCoarse, `momentR sous plafond`).toBeLessThan(0.05);
  });

  it('momentT converge (plein profil) : ecart DECROIT et reste petit', () => {
    const dMid = devWindow(fine.momentT!, mid.momentT!);
    const dCoarse = devWindow(fine.momentT!, coarse.momentT!);
    expect(dMid, `momentT converge (mid<coarse)`).toBeLessThan(dCoarse);
    expect(dCoarse, `momentT sous plafond`).toBeLessThan(0.05);
  });

  it('reaction converge a l INTERIEUR (10%-90%) : ecart DECROIT et devient minuscule', () => {
    const dMid = devWindow(fine.reaction!, mid.reaction!, 0.1, 0.9);
    const dCoarse = devWindow(fine.reaction!, coarse.reaction!, 0.1, 0.9);
    expect(dMid, `reaction interieure converge (mid<coarse)`).toBeLessThan(dCoarse);
    expect(dCoarse, `reaction interieure sous plafond`).toBeLessThan(0.02);
  });
});

describe('axi reaction — FINDING: singularite de bord r=R NON convergente (remonte 14/07)', () => {
  // SENTINELLE DE CARACTERISATION (pas de calibration) : la reaction au bord EXTERIEUR (r=R)
  // croit avec `ne` (∝√ne) sans converger ; le bord interieur (r=0) reste stable. Canal
  // d'inference du maillage via profils.reaction[r=R]. Present cote HTML (science/client).
  it('reaction au bord exterieur (r=R) CROIT avec ne ; bord interieur (r=0) STABLE', () => {
    const r60 = profils(60).reaction!;
    const r120 = profils(120).reaction!;
    const r240 = profils(240).reaction!;
    // Bord exterieur (dernier point, r=R) : croissance monotone stricte = singularite.
    expect(r120.v[96]!, `reaction r=R ne120>ne60`).toBeGreaterThan(r60.v[96]!);
    expect(r240.v[96]!, `reaction r=R ne240>ne120`).toBeGreaterThan(r120.v[96]!);
    expect(r240.v[96]! / r120.v[96]!, `bord r=R croit nettement (>1,2)`).toBeGreaterThan(
      1.2,
    );
    // Bord interieur (r=0) : QUASI stable (l'artefact est localise au bord exterieur).
    const c0 = Math.abs(r240.v[0]! - r60.v[0]!) / Math.max(Math.abs(r240.v[0]!), 1e-9);
    expect(c0, `reaction r=0 stable sous raffinement`).toBeLessThan(0.05);
  });
});
