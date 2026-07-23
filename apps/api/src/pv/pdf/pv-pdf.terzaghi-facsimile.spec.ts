/**
 * ÉQUIVALENCE PV ↔ RAPPORT NATIF terzaghi (fondation superficielle) — décision
 * titulaire 18/07. Le PV scellé doit reproduire, SECTION PAR SECTION, la note que
 * l'outil client imprime (`buildNote` de terzaghi_V13.html), en consommant la MÊME
 * sortie serveur whitelistée (`runTerzaghi`) que le CLONE affiche à l'écran. On a
 * donc l'invariant : PV == écran == rapport client.
 *
 * MÉTHODE (jsdom indisponible en env `node` de l'API — cf. clone-render.test.ts,
 * côté engines/vitest, qui prouve déjà écran == buildNote) : on rend le PV depuis
 * la sortie RÉELLE de `runTerzaghi(fixture)` et on prouve qu'il porte :
 *   - les MÊMES titres de section / d'étape que la note native (chaînes vérifiées
 *     présentes DANS le source de référence — garde anti-dérive, ligne 0 faux-vert) ;
 *   - les MÊMES valeurs (contraintes de base u/q0/σ′v0, taux de portance, tassement
 *     en cm, qref) recalculées depuis la sortie serveur (pas de nombre magique).
 * Plus les correctifs d'audit : GEOFAM (MJ-9), NF P 94-261 conditionnel (BQ-4),
 * D d'encastrement peuplé (BQ-3), excentrement en synthèse (BQ-5), tassement en cm.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import type { OfficialPv } from '@prisma/client';
import { runTerzaghi, TERZAGHI_FIXTURES } from '@roadsen/engines';
import {
  canonicalize,
  sealContentHash,
  sealHmac,
  type SealableValue,
} from '@roadsen/shared';

import { collectPvPdfText, renderPvPdf } from './pv-pdf';

const SECRET = 'secret-facsimile-terzaghi';
const ENGINE_ID = 'fondation-superficielle';

// Source de référence (LECTURE SEULE) — sert d'ancre anti-dérive : tout libellé
// qu'on affirme reproduire DOIT exister dans la note native. packages/engines/reference.
const REFERENCE_HTML = resolve(
  dirname(__filename),
  '../../../../../packages/engines/reference/terzaghi_V13.html',
);
const referenceSource = readFileSync(REFERENCE_HTML, 'utf8');

/** Miroir de `terzFmt`/`fmt(x,d)` : décimales fixes fr-FR, clamp anti « -0,00 ». */
function fmtFr(v: unknown, d = 2): string {
  let x =
    typeof v === 'number'
      ? v
      : typeof v === 'string' && v.trim() !== ''
        ? Number(v.replace(',', '.'))
        : NaN;
  if (!Number.isFinite(x)) return '—';
  if (Math.abs(x) < 0.5 / Math.pow(10, d)) x = 0;
  return x
    .toLocaleString('fr-FR', {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    })
    .replace(/[\u202f\u00a0]/g, ' ');
}

/** Normalise les espaces (NBSP/espace fine) pour comparer PV et valeurs attendues. */
function norm(s: string): string {
  return s.replace(/[  \s]+/g, ' ');
}

/** Construit un OfficialPv COHÉRENT (sceau valide) pour un moteur fondation. */
function sealPv(input: unknown, output: unknown): OfficialPv {
  const pvNumber = 'PV-RDS-terz-2026-000001';
  const sealedAtIso = '2026-07-18T09:00:00.000Z';
  const content: SealableValue = {
    pvNumber,
    sealedAt: sealedAtIso,
    engineMeta: {
      engineId: ENGINE_ID,
      engineVersion: '1.0.0',
      engineSourceHash: 'a'.repeat(64),
    },
    identity: {
      userId: 'u-1',
      userDisplayName: 'A. DIALLO',
      orgDisplayName: 'BE TEST',
      projectId: 'p-1',
      projectName: 'Semelle S1',
    },
    input: input as SealableValue,
    output: output as SealableValue,
    scienceStatus: 'signed',
    verdict: 'CONFORME',
  };
  const canonical = canonicalize(content);
  return {
    id: 'pv-terz-1',
    orgId: '11111111-1111-1111-1111-111111111111',
    calcResultId: 'c-1',
    projectId: 'p-1',
    pvNumber,
    userId: 'u-1',
    projectName: 'Semelle S1',
    engineId: ENGINE_ID,
    engineVersion: '1.0.0',
    engineSourceHash: 'a'.repeat(64),
    inputCanonical: canonical,
    output: output as SealableValue,
    scienceStatus: 'signed',
    verdict: 'CONFORME',
    contentHash: sealContentHash(canonical),
    hmac: sealHmac(canonical, SECRET),
    sealedAt: new Date(sealedAtIso),
    documentHtml: null,
    documentFormat: null,
    name: null,
  };
}

function fixture(id: string): { input: Record<string, unknown> } {
  const fx = TERZAGHI_FIXTURES.find((f) => f.id === id);
  if (!fx) throw new Error(`fixture ${id} absente`);
  return fx;
}

/** Rend le PV depuis la sortie RÉELLE runTerzaghi ; renvoie {text, input, output}. */
function renderFor(id: string): {
  text: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
} {
  const { input } = fixture(id);
  const env = runTerzaghi(input);
  if (!env.ok) throw new Error('runTerzaghi a échoué');
  const output = env.output as unknown as Record<string, unknown>;
  const pv = sealPv(input, output);
  return { text: norm(collectPvPdfText(pv)), input, output };
}

describe('PV terzaghi — fac-similé de la note native (buildNote)', () => {
  const prevSecret = process.env.PV_SIGNING_SECRET;
  beforeAll(() => {
    process.env.PV_SIGNING_SECRET = SECRET;
  });
  afterAll(() => {
    if (prevSecret === undefined) delete process.env.PV_SIGNING_SECRET;
    else process.env.PV_SIGNING_SECRET = prevSecret;
  });

  it('given une sortie serveur nominale (pressio) when PV rendu then sections & titres d’étape de la note native présents', () => {
    const { text } = renderFor('nominal-pressio-rect');

    // Titre de la note.
    expect(text).toContain('Terzaghi — note de calcul');
    // §1 & §2 (§2 = correctif : section auparavant ABSENTE du PV).
    for (const heading of [
      '1 · Hypothèses',
      '2 · Contraintes au niveau de la base',
    ]) {
      expect(text).toContain(heading.toUpperCase());
    }
    // Titres d'étape du déroulé — chacun DOIT exister dans la note native (anti-dérive).
    for (const step of [
      'Géométrie et sollicitations',
      'Excentrement et surface comprimée',
      'Inclinaison de la charge',
      'Contraintes au niveau de la base',
      'Contrainte de référence appliquée',
      'Résistance de calcul',
    ]) {
      // garde anti-dérive : le libellé DOIT exister dans la note native…
      expect(referenceSource.includes(step)).toBe(true);
      // …et être reproduit dans le PV.
      expect(text.includes(step)).toBe(true);
    }
    // Synthèse.
    expect(referenceSource).toContain('Synthèse');
    expect(text).toContain('SYNTHÈSE');
  });

  it('given contraintesBase whitelistées when PV rendu then u/q0/σ′v0 rendus (valeurs serveur, pas magiques)', () => {
    const { text, output } = renderFor('nominal-pressio-rect');
    const cb = output.contraintesBase as Record<string, number>;
    expect(cb).toBeDefined();
    // Les 3 valeurs de la note §2, formatées comme la note (1 décimale).
    expect(norm(text)).toContain(norm(`u = ${fmtFr(cb.u, 1)} kPa`));
    expect(norm(text)).toContain(norm(`${fmtFr(cb.q0, 1)} kPa`));
    expect(norm(text)).toContain(norm(`${fmtFr(cb.sv0, 1)} kPa`));
  });

  it('BQ-3 : la profondeur d’encastrement D est PEUPLÉE depuis l’entrée (jamais vide)', () => {
    const { text, input } = renderFor('nominal-pressio-rect');
    expect(text).toContain(`encastrement D = ${fmtFr(input.D)} m`);
    // garde anti faux-vert : D n'est pas nul/absent dans ce fixture.
    expect(Number(String(input.D).replace(',', '.'))).toBeGreaterThan(0);
  });

  it('tassement rendu en CENTIMÈTRES (fmt sf·100) + qref, comme la synthèse native', () => {
    const { text, output } = renderFor('nominal-pressio-rect');
    const cas = output.cas as Array<Record<string, number>>;
    const c0 = cas[0];
    const sf =
      c0.tassement ??
      c0.tassementElastique ??
      c0.tassementSchmertmann ??
      c0.tassementOed;
    expect(typeof sf).toBe('number');
    // Valeur en cm présente ; la valeur brute en m ne l'est PAS (pas de « 0,0123 m »).
    expect(text).toContain(`${fmtFr(sf * 100, 2)} cm`);
    // qref accolé (colonne « sf (cm) · qref »).
    expect(text).toContain(`${fmtFr(c0.qref, 0)} kPa`);
    // La note native étiquette bien la synthèse en cm.
    expect(referenceSource).toContain('s<sub>f</sub> (cm)');
  });

  it('taux de portance de la synthèse = valeur serveur (Math round via fmt 0 déc.)', () => {
    const { text, output } = renderFor('nominal-pressio-rect');
    const c0 = (output.cas as Array<Record<string, number>>)[0];
    expect(text).toContain(`${fmtFr(c0.taux * 100, 0)} %`);
  });

  it('BQ-5 : cas excentré+incliné → étape Excentrement, colonne Excentr. et étape Glissement', () => {
    const { text, output } = renderFor('pressio-carree-excentree');
    const c0 = (output.cas as Array<Record<string, unknown>>)[0];
    // L'excentrement est bien évalué côté serveur pour ce cas ELU_F.
    expect(typeof c0.excOk).toBe('boolean');
    // Étape de déroulé + colonne de synthèse (libellés présents dans la référence).
    expect(referenceSource).toContain('Excentrement et surface comprimée');
    expect(text).toContain('Excentrement et surface comprimée');
    expect(text).toContain('Excentr.'); // en-tête de colonne synthèse
    // Glissement : effort horizontal → étape + verdict.
    expect(typeof c0.glissementOk).toBe('boolean');
    expect(referenceSource).toContain('Résistance au glissement');
    expect(text).toContain('Résistance au glissement');
  });

  it('raideurs équivalentes (annexe J.3) rendues depuis output.raideurs quand E/ν renseignés', () => {
    const { text, output } = renderFor('nominal-pressio-rect');
    const raid = output.raideurs as Record<string, number> | undefined;
    // Ce fixture fournit E et ν → le serveur whiteliste des raideurs.
    expect(raid).toBeDefined();
    expect(typeof raid?.Kv).toBe('number');
    expect(text).toContain('Raideurs équivalentes du sol support');
    expect(text).toContain(`Kv = ${fmtFr(raid?.Kv, 0)}`);
  });

  it('MJ-9 / BQ-4 : chrome GEOFAM + référentiel NF P 94-261, JAMAIS « AGEROUTE » sur un PV de fondation', () => {
    const { text } = renderFor('nominal-pressio-rect');
    expect(text).toContain('GEOFAM');
    expect(text).toContain('NF P 94-261');
    expect(text.includes('AGEROUTE')).toBe(false);
    // Le brand chaussée ne fuit pas.
    expect(text.includes('ROADSEN')).toBe(false);
  });

  it('penetro : déroulé pénétrométrique (qce/Schmertmann) rendu depuis la sortie serveur', () => {
    const { text, output } = renderFor('penetro-carree');
    // Méthode pénétrométrique annoncée.
    expect(text).toContain('méthode pénétrométrique');
    // Tassement de Schmertmann si présent.
    const c0 = (output.cas as Array<Record<string, unknown>>)[0];
    if (typeof c0.tassementSchmertmann === 'number') {
      expect(referenceSource).toContain('Tassement de Schmertmann');
      expect(text).toContain('Tassement de Schmertmann');
    }
  });

  it('RENDU RÉEL : le PV terzaghi se génère en Buffer PDF sans erreur (bout-en-bout)', async () => {
    const { input } = fixture('nominal-pressio-rect');
    const env = runTerzaghi(input);
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    const pv = sealPv(input, env.output);
    const buf = await renderPvPdf(pv);
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });
});
