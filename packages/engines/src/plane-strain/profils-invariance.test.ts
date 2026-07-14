/**
 * §8 (correction MAJEUR-1, revue adverse du 14/07) — les PROFILS 2D ne doivent pas
 * reveler le pas de maillage `dx` (donc `ne`) par balayage du raffinement.
 *
 * Les `profils` (97 points, interpolation lineaire sur les nœuds) sont DECOUPLES de `dx`
 * par construction (97 points fixes). Mais `ne` est une ENTREE UTILISATEUR (opts.ne, borne
 * moteur [6,400]) : un utilisateur peut BALAYER `ne` et observer si un profil expose porte
 * une signature du maillage. Ce fichier le teste par CONVERGENCE SOUS RAFFINEMENT (metrique
 * choisie et documentee — cf. plus bas) : un artefact periodique verrouille sur `ne`
 * empecherait la convergence vers une limite mesh-independante.
 *
 * METRIQUE (simple, honnete) : ecart relatif max point-a-point entre profil FIN (ne=240) et
 * profils plus grossiers (ne=120, ne=60), normalise par l'etendue |v| du profil fin. Un
 * profil DECOUPLE du maillage converge : l'ecart DECROIT (≈ /2 par doublement de ne). J'ai
 * PREFERE la convergence a une autocorrelation des differences secondes (fragile, sensible au
 * bruit d'interpolation) : une signature `ne`-periodique survivante casserait la convergence.
 *
 * >>> FINDING REMONTE (titulaire + expert, ne PAS calibrer autour) <<<
 * La REACTION de sol NE CONVERGE PAS au BORD de la coupe. deflexion et moment convergent
 * proprement (interieur ET bord). Mais la reaction presente une SINGULARITE EF DE BORD :
 * la valeur au premier/dernier point CROIT ~√ne sans limite (192->271->383->542 pour
 * ne=30/60/120/240), tandis que l'INTERIEUR (10%-90%) converge parfaitement. C'est un
 * artefact inherent a la methode EF (present cote HTML d'origine aussi -> science/client),
 * PAS un defaut de portage. Consequence §8 : `profils.reaction` expose une valeur de BORD
 * qui echelonne avec `ne` -> canal d'inference du maillage si `ne` est balaye. DECISION
 * requise (titulaire + expert) : masquer les extremites de la reaction, la borner, ou
 * l'accepter. Le test ci-dessous CARACTERISE cet artefact (sentinelle) au lieu de le cacher.
 */
import { describe, expect, it } from 'vitest';

import { PLANE_STRAIN_FIXTURES } from './test-fixtures.js';

import { runPlaneStrain } from './index.js';

interface Prof {
  x: number[];
  v: number[];
  unit: string;
  label: string;
}

const fx = (id: string) => {
  const f = PLANE_STRAIN_FIXTURES.find((x) => x.id === id);
  if (!f) throw new Error(`fixture "${id}" introuvable`);
  return f;
};

function profils(ne: number): Record<string, Prof> {
  const base = fx('bande-repartie').input;
  const env = runPlaneStrain({ ...base, opts: { ...base.opts, ne } });
  expect(env.ok, `calcul ok ne=${ne}`).toBe(true);
  if (!env.ok) throw new Error('calcul echoue');
  const p = (env.output as unknown as { profils?: Record<string, Prof> }).profils;
  expect(p, `profils presents ne=${ne}`).toBeTruthy();
  return p as Record<string, Prof>;
}

/** Ecart relatif max sur une FENETRE [lo,hi] (fraction des 97 points), normalise par |v| du fin. */
function devWindow(fine: Prof, coarse: Prof, lo = 0, hi = 1): number {
  const span = Math.max(...fine.v.map((x) => Math.abs(x)), 1e-12);
  let maxRel = 0;
  const n = fine.v.length;
  for (let i = Math.floor(n * lo); i < Math.ceil(n * hi); i++) {
    maxRel = Math.max(maxRel, Math.abs(fine.v[i]! - coarse.v[i]!) / span);
  }
  return maxRel;
}

describe('plane-strain profils — presence & abscisses (rappel, ne fin)', () => {
  it('given ne=240, when runPlaneStrain, then 3 profils 97 points, abscisses croissantes', () => {
    const p = profils(240);
    for (const k of ['deflexion', 'moment', 'reaction']) {
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

describe('plane-strain profils — CONVERGENCE sous raffinement (MAJEUR-1 14/07)', () => {
  const fine = profils(240);
  const mid = profils(120);
  const coarse = profils(60);

  it('deflexion converge (plein profil) : ecart DECROIT et reste petit', () => {
    const dMid = devWindow(fine.deflexion!, mid.deflexion!);
    const dCoarse = devWindow(fine.deflexion!, coarse.deflexion!);
    expect(dMid, `deflexion converge (mid<coarse)`).toBeLessThan(dCoarse);
    expect(dCoarse, `deflexion sous plafond`).toBeLessThan(0.01);
  });

  it('moment converge (plein profil) : ecart DECROIT et reste petit', () => {
    const dMid = devWindow(fine.moment!, mid.moment!);
    const dCoarse = devWindow(fine.moment!, coarse.moment!);
    expect(dMid, `moment converge (mid<coarse)`).toBeLessThan(dCoarse);
    expect(dCoarse, `moment sous plafond`).toBeLessThan(0.03);
  });

  it('reaction converge a l INTERIEUR (10%-90%) : ecart DECROIT et devient minuscule', () => {
    // L'interieur de la reaction est mesh-independant ; seul le BORD singularise (finding
    // ci-dessous). On teste donc la convergence sur la fenetre interieure.
    const dMid = devWindow(fine.reaction!, mid.reaction!, 0.1, 0.9);
    const dCoarse = devWindow(fine.reaction!, coarse.reaction!, 0.1, 0.9);
    expect(dMid, `reaction interieure converge (mid<coarse)`).toBeLessThan(dCoarse);
    expect(dCoarse, `reaction interieure sous plafond`).toBeLessThan(0.02);
  });
});

describe('plane-strain reaction — FINDING: singularite de bord NON convergente (remonte 14/07)', () => {
  // SENTINELLE DE CARACTERISATION (pas de calibration) : documente que la reaction au BORD
  // croit avec `ne` (∝√ne) sans converger — canal d'inference du maillage via profils.reaction.
  // Present cote HTML d'origine (science/client). Decision §8 attendue (titulaire+expert).
  it('la reaction au premier point CROIT STRICTEMENT avec ne (singularite EF de bord)', () => {
    const r30 = profils(30).reaction!.v[0]!;
    const r60 = profils(60).reaction!.v[0]!;
    const r120 = profils(120).reaction!.v[0]!;
    const r240 = profils(240).reaction!.v[0]!;
    // Croissance monotone stricte = signature de la singularite de bord (NON convergent).
    expect(r60, `reaction bord ne60>ne30`).toBeGreaterThan(r30);
    expect(r120, `reaction bord ne120>ne60`).toBeGreaterThan(r60);
    expect(r240, `reaction bord ne240>ne120`).toBeGreaterThan(r120);
    // La croissance est substantielle (>20% par doublement) : ce n'est PAS du bruit flottant,
    // c'est un vrai artefact -> FINDING a remonter, pas a masquer par une tolerance lache.
    expect(r240 / r120, `bord croit nettement (facteur > 1,2)`).toBeGreaterThan(1.2);
  });
});
