/**
 * CRITÈRES SECONDAIRES de la méthode AGEROUTE — EXPOSITION en sortie projetée
 * (lacune de complétude d'affichage, pattern « affichage complétude »).
 *
 * Le moteur CALCULE déjà (et l'équivalence-portage prouve) des critères
 * SECONDAIRES que la projection écartait : phase 2 des structures MIXTES (et2,
 * §4.4.1), structures INVERSES (st2, §4.5), σ_t PAR COUCHE traitée (rigL, Tab. 68)
 * et le détail ε_z par couche granulaire (ezL). L'ingénieur voyait le bon verdict
 * global mais pas ces valeurs sollicitantes que son outil d'origine affiche.
 *
 * CE TEST MORD : il passe par `runBurmister` (validation + recalcul + PROJECTION
 * whitelist stricte). Si un champ secondaire n'est PAS whitelisté par
 * `BurmisterOutputSchema`, `projectEngineOutput` le STRIPPE -> `undefined` ->
 * assertion ROUGE. Retirer `fatiguePhase2` / `fatigueInverse` / `couchesTraitees`
 * du schéma (ou casser l'unité / le n° de couche) vire ce test au ROUGE.
 *
 * Les valeurs pinnées sont issues du moteur (que l'équivalence-portage cale sur le
 * HTML d'origine) : elles verrouillent l'unité (σ_t en MPa, ε_t/ε_z en µdef) et le
 * n° de couche (1-based). Elles ne re-prouvent PAS la science (rôle de
 * engine.equivalence.test) — elles prouvent la FIDÉLITÉ de la projection.
 */
import { describe, expect, it } from 'vitest';

import { BURMISTER_FIXTURES } from './test-fixtures.js';
import { runBurmister } from './index.js';

function outputOf(fixtureId: string) {
  const f = BURMISTER_FIXTURES.find((x) => x.id === fixtureId);
  if (!f) throw new Error(`fixture inconnue: ${fixtureId}`);
  const env = runBurmister(f.input);
  if (!env.ok) throw new Error(`calcul en echec pour ${fixtureId}: ${env.error.code}`);
  return env.output;
}

describe('critères secondaires AGEROUTE — exposés en sortie projetée', () => {
  it('MIXTE/SEMI-RIGIDE (§4.4.1) : et2 exposé en fatiguePhase2 (ε_t µdef + admissible + verdict + n° de couche)', () => {
    const o = outputOf('semi-rigide-glc') as Record<string, unknown>;
    const p2 = o.fatiguePhase2 as Record<string, unknown> | null;
    expect(p2).not.toBeNull();
    expect(p2).toBeTypeOf('object');
    // ε_t sollicitant à la base bitumineuse (MTLH fissuré E/5 + interface glissante), µdef.
    expect(p2!.valeur as number).toBeCloseTo(509.37, 1);
    expect(p2!.admissible as number).toBeCloseTo(201.54, 1);
    // 509 > 202 -> critère NON vérifié.
    expect(p2!.ok).toBe(false);
    // couche 1-based : dernière bitumineuse = BBSG1 (index 0) -> couche 1.
    expect(p2!.couche).toBe(1);
  });

  it('SEMI-RIGIDE (Tab. 68) : σ_t PAR COUCHE traitée exposé en couchesTraitees (MPa + mode + verdict + n° de couche)', () => {
    const o = outputOf('semi-rigide-glc') as Record<string, unknown>;
    const ct = o.couchesTraitees as Array<Record<string, unknown>>;
    expect(Array.isArray(ct)).toBe(true);
    expect(ct).toHaveLength(2);
    // Couches GLc2 (index 1 et 2) -> n° 2 et 3, mode « semi-collée » (Tab. 68).
    expect(ct.map((c) => c.couche)).toEqual([2, 3]);
    for (const c of ct) expect(c.mode).toBe('semi-collée');
    // σ_t sollicitant en MPa (même unité que le critère rigide principal).
    expect(ct[0]!.valeur as number).toBeCloseTo(0.2697, 3);
    expect(ct[0]!.admissible as number).toBeCloseTo(0.4225, 3);
    expect(ct[0]!.ok).toBe(true);
    expect(ct[1]!.valeur as number).toBeCloseTo(0.3345, 3);
    expect(ct[1]!.ok).toBe(true);
  });

  it('BC5 multi-couches (Tab. 68) : mode « glissante » exposé, σ_t en MPa par couche', () => {
    const o = outputOf('beton-multi-bc5') as Record<string, unknown>;
    const ct = o.couchesTraitees as Array<Record<string, unknown>>;
    expect(ct).toHaveLength(2);
    expect(ct.map((c) => c.couche)).toEqual([1, 2]);
    for (const c of ct) expect(c.mode).toBe('glissante');
    expect(ct[0]!.valeur as number).toBeCloseTo(1.3001, 3);
    // pas de phase 2 ni d'inverse ici (BC5 pur, pas de couche bitumineuse au-dessus).
    expect(o.fatiguePhase2).toBeNull();
    expect(o.fatigueInverse).toBeNull();
  });

  it('INVERSE (§4.5) : st2 exposé en fatigueInverse (σ_t MPa base MTLH profond + admissible + verdict + n° de couche)', () => {
    const o = outputOf('inverse-mtlh-profond') as Record<string, unknown>;
    const inv = o.fatigueInverse as Record<string, unknown> | null;
    expect(inv).not.toBeNull();
    expect(inv!.valeur as number).toBeCloseTo(0.4692, 3);
    expect(inv!.admissible as number).toBeCloseTo(0.384, 3);
    // 0,469 > 0,384 -> NON vérifié.
    expect(inv!.ok).toBe(false);
    // MTLH profond = GLc2 (index 3) -> couche 4.
    expect(inv!.couche).toBe(4);
    // pas de phase 2 (structure non mixte).
    expect(o.fatiguePhase2).toBeNull();
  });

  it('ε_z PAR COUCHE granulaire exposé en couchesGranulaires (µdef + n° de couche)', () => {
    const o = outputOf('souple-faible-trafic') as Record<string, unknown>;
    const cg = o.couchesGranulaires as Array<Record<string, unknown>>;
    expect(Array.isArray(cg)).toBe(true);
    expect(cg.map((c) => c.couche)).toEqual([2, 3]); // GNT1 (idx1), GNT2 (idx2)
    expect(cg[0]!.valeur as number).toBeCloseTo(2107.23, 0);
    expect(cg[0]!.valeur as number).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------
  // FLAG requis/exempté (MAJEUR-1) — un critère NON plié dans `conforme` DOIT être
  // marqué requis=false, pour que l'affichage le rende INFORMATIF (jamais un ✗ sous
  // un bandeau CONFORME). Le flag est un booléen de VERDICT public (§8), lu depuis
  // D.etReq (fatigue/phase 2), D.gq (ε_z granulaire), toujours plié pour l'inverse.
  // ---------------------------------------------------------------------------
  it('MAJEUR-1 semi-rigide (Kmix<0,5) : structure CONFORME, mais phase 2 dépassée = NON requise (requis=false)', () => {
    const o = outputOf('semi-rigide-glc') as Record<string, unknown>;
    // La structure est globalement conforme (le critère σ_t rigide principal passe).
    expect(o.conforme).toBe(true);
    // Le critère PRINCIPAL rigide (σ_t par couche) EST requis (okMain toujours plié
    // pour une famille rigide, même quand etReq=false).
    const fat = o.fatigue as Record<string, unknown>;
    expect(fat.requis).toBe(true);
    // La PHASE 2 mixte (§4.4.1) est dépassée (253 %) MAIS non pliée dans le verdict
    // (etReq=false pour semi-rigide) -> requis=false : l'affichage doit l'informatif.
    const p2 = o.fatiguePhase2 as Record<string, unknown>;
    expect(p2.ok).toBe(false);
    expect(p2.requis).toBe(false);
    // Les couches traitées (critère principal rigide) restent requises.
    for (const c of o.couchesTraitees as Array<Record<string, unknown>>) {
      expect(c.requis).toBe(true);
    }
  });

  it('MAJEUR-1 souple à faible trafic : ε_z granulaire EXEMPTÉ (§4.1.2) -> couchesGranulaires.requis=false', () => {
    const o = outputOf('souple-faible-trafic') as Record<string, unknown>;
    expect(o.conforme).toBe(true);
    // ε_t bitumineux informatif pour cette famille (etReq=false, non rigide).
    expect((o.fatigue as Record<string, unknown>).requis).toBe(false);
    // Détail ε_z par couche granulaire : exempté (gntReq=false) -> requis=false,
    // même la couche qui dépasse (2107 µdef) ne doit PAS contredire le verdict.
    const cg = o.couchesGranulaires as Array<Record<string, unknown>>;
    expect(cg.length).toBeGreaterThan(0);
    for (const c of cg) expect(c.requis).toBe(false);
    // au moins une couche dépasse son admissible tout en étant exemptée.
    expect(cg.some((c) => c.ok === false)).toBe(true);
  });

  it('MAJEUR-1 inverse : σ_t inverse TOUJOURS requis ; ε_z granulaire requis (autres cas §4.1.2)', () => {
    const o = outputOf('inverse-mtlh-profond') as Record<string, unknown>;
    const inv = o.fatigueInverse as Record<string, unknown>;
    expect(inv.requis).toBe(true);
    // structure inverse = « autres cas » du §4.1.2 -> ε_z granulaire est vérifié.
    for (const c of o.couchesGranulaires as Array<Record<string, unknown>>) {
      expect(c.requis).toBe(true);
    }
  });

  it('MAJEUR-1 béton rigide (BC5) : critère σ_t principal REQUIS même quand etReq=false', () => {
    const o = outputOf('beton-multi-bc5') as Record<string, unknown>;
    // Non conforme, mais le critère principal rigide EST requis (folded via okMain) :
    // il ne doit surtout PAS être marqué informatif (c'est le motif de non-conformité).
    expect((o.fatigue as Record<string, unknown>).requis).toBe(true);
    for (const c of o.couchesTraitees as Array<Record<string, unknown>>) {
      expect(c.requis).toBe(true);
    }
  });

  it('STRUCTURE SOUPLE/BITUMINEUSE : aucun critère secondaire (null propre, pas de 0 trompeur)', () => {
    const o = outputOf('souple-faible-trafic') as Record<string, unknown>;
    // pas de phase 2, pas d'inverse, pas de couche traitée.
    expect(o.fatiguePhase2).toBeNull();
    expect(o.fatigueInverse).toBeNull();
    expect(o.couchesTraitees).toEqual([]);

    const b = outputOf('bitumineuse-epaisse-defaut') as Record<string, unknown>;
    expect(b.fatiguePhase2).toBeNull();
    expect(b.fatigueInverse).toBeNull();
    expect(b.couchesTraitees).toEqual([]);
  });
});
