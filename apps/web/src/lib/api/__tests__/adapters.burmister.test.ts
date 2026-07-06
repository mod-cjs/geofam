/**
 * Tests — adaptCalcResult : normalisation client-safe de la sortie burmister.
 *
 * Régression réelle (prod) : le backend `GET /projects/:id/calc-results` renvoie
 * des lignes SANS `status` et un `output` BRUT moteur (clés `conforme`/`NE`/
 * `fatigue`/`ornierage`…), pas `{verdict, rows}`. L'UI affichait donc « Calcul non
 * encore lancé » sur un calcul TERMINÉ. Ces tests verrouillent la dérivation du
 * statut + la normalisation, et — fail-closed (DoD §8) — l'absence de tout champ
 * confidentiel/non-whitelisté dans les lignes affichées.
 *
 * Given/When/Then (BDD). Zéro faux-vert : assertions signées, test négatif de fuite.
 */

import { describe, it, expect } from 'vitest';

import { adaptCalcResult, type PrismaCalcResult } from '../adapters';
import type { CalcOutputRow, NormalizedCalcOutput } from '../types';

// Sortie RÉELLE observée en prod pour chaussee-burmister (cas démo, non conforme).
const LIVE_BURMISTER_OUTPUT = {
  NE: 1467314.82,
  erreur: null,
  famille: 'bitumineuse épaisse (§4.2)',
  fatigue: { ok: false, requis: true, rigide: false, valeur: 119.12, admissible: 96.4 },
  conforme: false,
  warnings: ['Coefficient de calage kc=1.3 appliqué (§ confidentiel)'],
  ornierage: { ok: true, valeur: 412.5, admissible: 600 },
  epaisseurLiee: 0.34,
  epaisseurTotale: 0.46,
};

function makeRaw(overrides: Partial<PrismaCalcResult> = {}): PrismaCalcResult {
  // Forme RÉELLE backend : pas de status/label/domain/updatedAt.
  return {
    id: 'calc_live',
    projectId: 'proj_01',
    orgId: 'org_01',
    engineId: 'chaussee-burmister',
    input: { layers: [{ h: 0.34 }] },
    output: LIVE_BURMISTER_OUTPUT,
    createdAt: '2026-06-27T10:00:00.000Z',
    ...overrides,
  };
}

function asNormalized(output: unknown): NormalizedCalcOutput {
  return output as NormalizedCalcOutput;
}

describe('adaptCalcResult — statut dérivé de la sortie', () => {
  it('given output présent sans erreur, when adapté, then status = DONE', () => {
    const r = adaptCalcResult(makeRaw());
    expect(r.status).toBe('DONE');
  });

  it('given output.erreur non null, when adapté, then status = ERROR', () => {
    const r = adaptCalcResult(
      makeRaw({ output: { ...LIVE_BURMISTER_OUTPUT, erreur: 'profil invalide' } }),
    );
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
    const r = adaptCalcResult(makeRaw());
    expect(r.label).toBe('chaussee-burmister');
    expect(r.domain).toBe('CH');
  });
});

describe('adaptCalcResult — verdict dérivé de conforme', () => {
  it('given conforme=false, when adapté, then verdict = FAIL', () => {
    const out = asNormalized(adaptCalcResult(makeRaw()).output);
    expect(out.verdict).toBe('FAIL');
  });

  it('given conforme=true, when adapté, then verdict = PASS', () => {
    const out = asNormalized(
      adaptCalcResult(makeRaw({ output: { ...LIVE_BURMISTER_OUTPUT, conforme: true } }))
        .output,
    );
    expect(out.verdict).toBe('PASS');
  });
});

describe('adaptCalcResult — rows client-safe non vides', () => {
  it('given une sortie burmister réelle, when adapté, then rows contient les grandeurs attendues', () => {
    const out = asNormalized(adaptCalcResult(makeRaw()).output);
    const labels = out.rows.map((r) => r.label);

    expect(out.rows.length).toBeGreaterThanOrEqual(5);
    expect(labels).toContain('Trafic cumulé (NE)');
    expect(labels).toContain('Épaisseur totale');
    expect(labels).toContain('Épaisseur de couches liées');

    const ne = out.rows.find((r) => r.label === 'Trafic cumulé (NE)')!;
    expect(ne.value).toBe(1467314.82);

    const ep = out.rows.find((r) => r.label === 'Épaisseur totale')!;
    expect(ep.value).toBe(0.46);
    expect(ep.unit).toBe('m');
  });

  it('given fatigue bitumineuse (rigide=false), then ligne ε_t sollicitante en μdef avec status=fail', () => {
    const out = asNormalized(adaptCalcResult(makeRaw()).output);
    const soll = out.rows.find((r) => r.label === 'Déformation sollicitante ε_t');
    expect(soll).toBeDefined();
    expect(soll!.value).toBe(119.12);
    expect(soll!.unit).toBe('μdef');
    expect(soll!.status).toBe('fail');
  });

  it('given orniérage ok=true, then ligne ε_z sollicitante avec status=ok', () => {
    const out = asNormalized(adaptCalcResult(makeRaw()).output);
    const orn = out.rows.find((r) => r.label === 'Déformation ε_z sollicitante (PSC)');
    expect(orn).toBeDefined();
    expect(orn!.value).toBe(412.5);
    expect(orn!.status).toBe('ok');
  });

  it('given une valeur admissible null, then la ligne est OMISE (jamais de NaN affiché)', () => {
    const out = asNormalized(
      adaptCalcResult(
        makeRaw({
          output: {
            ...LIVE_BURMISTER_OUTPUT,
            fatigue: {
              ok: false,
              requis: true,
              rigide: false,
              valeur: 119.12,
              admissible: null,
            },
          },
        }),
      ).output,
    );
    expect(
      out.rows.find((r) => r.label === 'Déformation admissible ε_t,adm'),
    ).toBeUndefined();
    // aucune valeur numérique NaN affichée (les lignes textuelles — famille — sont
    // des chaînes non vides ; les lignes numériques sont finies).
    expect(
      out.rows.every((r) =>
        typeof r.value === 'string' ? r.value.length > 0 : Number.isFinite(r.value),
      ),
    ).toBe(true);
  });

  it('given fatigue rigide=true, then unité MPa et libellé contrainte (pas déformation)', () => {
    const out = asNormalized(
      adaptCalcResult(
        makeRaw({
          output: {
            ...LIVE_BURMISTER_OUTPUT,
            fatigue: {
              ok: true,
              requis: true,
              rigide: true,
              valeur: 1.8,
              admissible: 2.1,
            },
          },
        }),
      ).output,
    );
    const soll = out.rows.find((r) => r.label === 'Contrainte sollicitante σ_t');
    expect(soll).toBeDefined();
    expect(soll!.unit).toBe('MPa');
  });
});

describe('adaptCalcResult — critères SECONDAIRES exposés (complétude d’affichage)', () => {
  it('given structure mixte/semi-rigide (fatiguePhase2 + couchesTraitees), then lignes εt phase 2 (rows) et σt par couche (details)', () => {
    const out = asNormalized(
      adaptCalcResult(
        makeRaw({
          output: {
            ...LIVE_BURMISTER_OUTPUT,
            famille: 'semi-rigide',
            fatiguePhase2: { valeur: 509.37, admissible: 201.54, ok: false, couche: 1 },
            fatigueInverse: null,
            couchesTraitees: [
              { couche: 2, mode: 'semi-collée', valeur: 0.2697, admissible: 0.4225, ok: true },
              { couche: 3, mode: 'semi-collée', valeur: 0.3345, admissible: 0.384, ok: true },
            ],
            couchesGranulaires: [],
          },
        }),
      ).output,
    );
    // phase 2 -> ligne de résultat (rows), µdef, verdict fail, n° de couche baké.
    const p2 = out.rows.find((r) => r.label === 'Fatigue phase 2 — base bitumineuse ε_t (couche 1)');
    expect(p2).toBeDefined();
    expect(p2!.value).toBe(509.37);
    expect(p2!.unit).toBe('μdef');
    expect(p2!.status).toBe('fail');
    // σt par couche traitée -> détails, MPa, mode d'interface dans le libellé.
    const ct = (out.details ?? []).find(
      (r) => r.label === 'σ_t couche traitée 2 (interface semi-collée)',
    );
    expect(ct).toBeDefined();
    expect(ct!.value).toBe(0.2697);
    expect(ct!.unit).toBe('MPa');
    expect(ct!.status).toBe('ok');
  });

  it('given structure inverse (fatigueInverse σt MPa), then ligne « Structure inverse » ; phase 2 absente', () => {
    const out = asNormalized(
      adaptCalcResult(
        makeRaw({
          output: {
            ...LIVE_BURMISTER_OUTPUT,
            famille: 'inverse',
            fatiguePhase2: null,
            fatigueInverse: { valeur: 0.4692, admissible: 0.384, ok: false, couche: 4 },
            couchesTraitees: [],
          },
        }),
      ).output,
    );
    const inv = out.rows.find(
      (r) => r.label === 'Structure inverse — base MTLH profond σ_t (couche 4)',
    );
    expect(inv).toBeDefined();
    expect(inv!.value).toBe(0.4692);
    expect(inv!.unit).toBe('MPa');
    expect(inv!.status).toBe('fail');
    // phase 2 null -> pas de ligne.
    expect(
      out.rows.some((r) => r.label.startsWith('Fatigue phase 2')),
    ).toBe(false);
  });

  it('given structure souple (pas de critère secondaire), then AUCUNE ligne phase 2/inverse/couche traitée', () => {
    const out = asNormalized(
      adaptCalcResult(
        makeRaw({
          output: {
            ...LIVE_BURMISTER_OUTPUT,
            fatiguePhase2: null,
            fatigueInverse: null,
            couchesTraitees: [],
          },
        }),
      ).output,
    );
    expect(out.rows.some((r) => r.label.startsWith('Fatigue phase 2'))).toBe(false);
    expect(out.rows.some((r) => r.label.startsWith('Structure inverse'))).toBe(false);
    expect((out.details ?? []).some((r) => r.label.startsWith('σ_t couche traitée'))).toBe(false);
  });
});

describe('adaptCalcResult — fail-closed : aucune fuite de champ non whitelisté', () => {
  it('given une sortie avec champs confidentiels, then rows ne contient QUE des champs whitelistés', () => {
    const out = asNormalized(
      adaptCalcResult(
        makeRaw({
          output: {
            ...LIVE_BURMISTER_OUTPUT,
            // intermédiaires confidentiels qui ne DOIVENT jamais ressortir
            _D: {
              sz: 0.42,
              sr: -0.13,
              kr: 1.3,
              ks: 0.9,
              kc: 1.3,
              Sh: 0.25,
              b: 5,
              e6: 100,
            },
            propagateur: { A: 1, B: 2, C: 3, Dm: 4 },
          },
        }),
      ).output,
    );

    const serialized = JSON.stringify(out);
    // Les libellés/valeurs confidentiels n'apparaissent NULLE PART dans la sortie normalisée.
    for (const leak of [
      '_D',
      'propagateur',
      'sz',
      'kr',
      'Sh',
      'famille',
      'warnings',
      'confidentiel',
    ]) {
      expect(serialized, `fuite détectée : ${leak}`).not.toContain(leak);
    }
    // La valeur d'un intermédiaire (kr=1.3 → -0.13 …) n'est pas non plus présente.
    expect(serialized).not.toContain('-0.13');
  });

  it('given un output moteur INCONNU (sans conforme), then la sortie normalisée ne contient AUCUN champ brut', () => {
    // Tout moteur ≠ burmister (terzaghi/casagrande/geoplaque/pressiometre/fastlab)
    // est sélectionnable (STARFIRE les a validés) → sa sortie BRUTE ne doit JAMAIS
    // atteindre le navigateur tant qu'un builder whitelisté dédié n'existe pas.
    const out = adaptCalcResult(
      makeRaw({
        engineId: 'fondation-terzaghi',
        output: {
          qadm: 250,
          methode: 'Terzaghi §5.3',
          _kc: 1.3,
          warnings: ['…confidentiel…'],
        },
      }),
    ).output;
    const serialized = JSON.stringify(out ?? {});
    expect(serialized).not.toContain('methode');
    expect(serialized).not.toContain('_kc');
    expect(serialized).not.toContain('confidentiel');
    expect(serialized).not.toContain('qadm');
    // Fail-closed : aucune donnée brute → output null (rien d'affichable Phase 1).
    expect(out).toBeNull();
  });

  it('given une sortie déjà {verdict, rows} avec un champ brut parasite, then la ligne est re-whitelistée', () => {
    const out = asNormalized(
      adaptCalcResult(
        makeRaw({
          output: {
            verdict: 'PASS',
            rows: [{ label: 'X', value: 1, unit: 'm', _secret: 'kc=1.3' }],
          },
        }),
      ).output,
    );
    expect(JSON.stringify(out)).not.toContain('_secret');
    expect(JSON.stringify(out)).not.toContain('kc=1.3');
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]).toEqual({ label: 'X', value: 1, unit: 'm' });
  });

  it('given famille citant une §méthode, then elle n est PAS exposée dans rows (fail-closed)', () => {
    const out = asNormalized(adaptCalcResult(makeRaw()).output);
    expect(out.rows.some((r) => r.label.includes('§'))).toBe(false);
    expect(JSON.stringify(out)).not.toContain('§4.2');
  });

  it('chaque row respecte le contrat {label:string, value:(number fini|string), unit:string}', () => {
    const out = asNormalized(adaptCalcResult(makeRaw()).output);
    for (const r of out.rows as CalcOutputRow[]) {
      expect(typeof r.label).toBe('string');
      // value = grandeur numérique FINIE (jamais NaN) ou résultat TEXTUEL (famille).
      if (typeof r.value === 'string') {
        expect(r.value.length).toBeGreaterThan(0);
      } else {
        expect(Number.isFinite(r.value)).toBe(true);
      }
      expect(typeof r.unit).toBe('string');
    }
  });
});

describe('buildBurmisterRows — famille : libellé NU nettoyé (FUITE #1 / issue #81)', () => {
  it('given une famille propre, then la ligne « Famille de structure » affiche le libellé NU', () => {
    const out = asNormalized(adaptCalcResult(makeRaw()).output);
    const fam = out.rows.find((r) => r.label === 'Famille de structure');
    expect(fam).toBeDefined();
    // La fixture porte « bitumineuse épaisse (§4.2) » : le § est retiré à l affichage.
    expect(fam!.value).toBe('bitumineuse épaisse');
    expect(String(fam!.value)).not.toContain('§');
  });

  it('SENTINELLE : une famille CORROMPUE (§/K=/kc/décimale) retombe sur le générique, aucune fuite', () => {
    // Chaîne adversaire portant un intermédiaire confidentiel (K/kc + section privée).
    const out = asNormalized(
      adaptCalcResult(
        makeRaw({
          output: {
            ...LIVE_BURMISTER_OUTPUT,
            famille: 'bitumineuse (§ confidentiel kc=1.3)',
          },
        }),
      ).output,
    );
    const fam = out.rows.find((r) => r.label === 'Famille de structure');
    expect(fam).toBeDefined();
    expect(fam!.value).toBe('structure non catégorisée');
    // La sérialisation complète des rows ne contient NI §, NI kc, NI K=, NI 1.3.
    const serialized = JSON.stringify(out);
    for (const leak of ['§', 'kc', 'K=', '1.3', 'confidentiel']) {
      expect(serialized, `fuite famille : ${leak}`).not.toContain(leak);
    }
  });

  it('SENTINELLE : un discriminant Kmix « mixte (§4.4, K=0.62) » → « mixte » NU', () => {
    const out = asNormalized(
      adaptCalcResult(
        makeRaw({
          output: { ...LIVE_BURMISTER_OUTPUT, famille: 'mixte (§4.4, K=0.62)' },
        }),
      ).output,
    );
    const fam = out.rows.find((r) => r.label === 'Famille de structure');
    expect(fam!.value).toBe('mixte');
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain('K=');
    expect(serialized).not.toContain('0.62');
    expect(serialized).not.toContain('§4.4');
  });
});

describe('adaptCalcResult — passthrough des sorties déjà normalisées / autres', () => {
  it('given output déjà {verdict, rows} (sans conforme), then conservé tel quel', () => {
    const r = adaptCalcResult(
      makeRaw({
        output: { verdict: 'PASS', rows: [{ label: 'X', value: 1, unit: 'm' }] },
      }),
    );
    expect((r.output as NormalizedCalcOutput).verdict).toBe('PASS');
    expect((r.output as NormalizedCalcOutput).rows).toHaveLength(1);
  });

  it('given output null, then output reste null et ne crash pas', () => {
    const r = adaptCalcResult(makeRaw({ output: null }));
    expect(r.output).toBeNull();
  });
});
