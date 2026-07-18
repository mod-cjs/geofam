/**
 * ÉQUIVALENCE PV ↔ RAPPORT NATIF PressioPro (moteur pressiometre-menard, essai
 * Ménard NF EN ISO 22476-4) — décision titulaire 18/07. Le PV scellé doit
 * reproduire, SECTION PAR SECTION, le dépouillement que l'outil client affiche
 * (`renderResults` de packages/engines/reference/pressiometre__1_.html), en
 * consommant la MÊME sortie serveur whitelistée (`runPressiometre`) que le clone
 * rend à l'écran. Invariant : PV == écran == rapport client.
 *
 * MÉTHODE (patron terzaghi) : on rend le corps PV depuis la sortie RÉELLE de
 * `runPressiometre(fixture)` et on prouve qu'il porte :
 *   - les MÊMES titres de section / libellés que le rapport natif (chaînes
 *     vérifiées présentes DANS le source de référence — garde anti-dérive,
 *     ligne 0 faux-vert : on n'affirme reproduire QUE ce qui existe à l'écran) ;
 *   - les MÊMES valeurs (EM, pL, pf, pE, p₀, σh0, pL*, pf*, α, Ey, extrapolation
 *     A/B, volumes, β/mE) recalculées depuis la sortie serveur, formatées avec les
 *     décimales du rapport natif (pas de nombre magique).
 * Plus : les garde-fous AFFICHÉS (EM = 0, résultat non corrigé a=0 / a forcé),
 * la mutation anti-faux-vert, et la preuve de FERMETURE §8 (un champ confidentiel
 * injecté dans la sortie N'EST PAS rendu — lecture par clés nommées fail-closed).
 *
 * On teste `buildPressiometreBody` DIRECTEMENT (pas le dispatch global de pv-pdf,
 * câblé en parallèle) : le corps est une fonction pure SealedContent → Content[].
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import {
  PRESSIOMETRE_FIXTURES,
  runPressiometre,
  type PressiometreFixture,
} from '@roadsen/engines';

import { buildPressiometreBody } from './pressiometre';
import type { SealedContent } from '../pv-pdf';

// Source de référence (LECTURE SEULE) — ancre anti-dérive : tout libellé qu'on
// affirme reproduire DOIT exister dans le rapport natif. bodies/ est un niveau
// plus profond que pv-pdf.ts -> 6 remontées vers 05-Plateforme.
const REFERENCE_HTML = resolve(
  dirname(__filename),
  '../../../../../../packages/engines/reference/pressiometre__1_.html',
);
const referenceSource = readFileSync(REFERENCE_HTML, 'utf8');

// --- Miroirs EXACTS des helpers de formatage de bodies/pressiometre.ts : les
//     valeurs attendues sont formatées par la MÊME logique que la production, si
//     bien qu'elles suivent runPressiometre (aucune constante magique). ---
function fmt(v: number, d: number, unit?: string): string {
  let n = v;
  if (Math.abs(n) < 0.5 / Math.pow(10, d)) n = 0;
  const s = n
    .toLocaleString('fr-FR', {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    })
    .replace(/[\u202f\u00a0]/g, ' ');
  return unit ? `${s} ${unit}` : s;
}
function mpa(barVal: number, d: number, unit = 'MPa'): string {
  return fmt(barVal * 0.1, d, unit);
}
function expo(v: number): string {
  return v.toExponential(2).replace('.', ',');
}

/** Collecte le texte rendu par un arbre Content pdfmake (mêmes règles que
 * collectPvPdfText, restreint à notre sous-arbre de corps). */
function walkText(node: unknown, out: string[]): void {
  if (node == null) return;
  if (typeof node === 'string') {
    out.push(node);
    return;
  }
  if (Array.isArray(node)) {
    for (const n of node) walkText(n, out);
    return;
  }
  if (typeof node === 'object') {
    const o = node as Record<string, unknown>;
    if (typeof o.text === 'string') out.push(o.text);
    else if (o.text != null) walkText(o.text, out);
    if (o.stack) walkText(o.stack, out);
    if (o.columns) walkText(o.columns, out);
    if (o.table && typeof o.table === 'object') {
      const t = o.table as { body?: unknown };
      if (t.body) walkText(t.body, out);
    }
  }
}

function norm(s: string): string {
  return s.replace(/[  \s]+/g, ' ');
}

function fixture(id: string): PressiometreFixture {
  const fx = PRESSIOMETRE_FIXTURES.find((f) => f.id === id);
  if (!fx) throw new Error(`fixture ${id} absente`);
  return fx;
}

/** Construit un SealedContent cohérent (input fixture + sortie serveur réelle). */
function sealFor(
  id: string,
  outputOverride?: (o: Record<string, unknown>) => Record<string, unknown>,
): { sealed: SealedContent; output: Record<string, unknown> } {
  const fx = fixture(id);
  const env = runPressiometre(fx.input);
  if (!env.ok) throw new Error('runPressiometre a échoué');
  const output = env.output as unknown as Record<string, unknown>;
  const sealed: SealedContent = {
    pvNumber: 'PV-RDS-pm-2026-000001',
    sealedAt: '2026-07-18T09:00:00.000Z',
    engineMeta: {
      engineId: 'pressiometre-menard',
      engineVersion: '1.0.0',
      engineSourceHash: 'a'.repeat(64),
    },
    identity: {
      userId: 'u-1',
      userDisplayName: 'A. DIALLO',
      orgDisplayName: 'BE TEST',
      projectId: 'p-1',
      projectName: 'Sondage BH-01',
    },
    input: fx.input,
    output: outputOverride ? outputOverride({ ...output }) : output,
    scienceStatus: 'signed',
    verdict: 'NON_APPLICABLE',
  };
  return { sealed, output };
}

/** Rend le corps PV depuis une fixture et renvoie le texte normalisé + la sortie. */
function renderFor(id: string): {
  text: string;
  output: Record<string, unknown>;
} {
  const { sealed, output } = sealFor(id);
  const out: string[] = [];
  walkText(buildPressiometreBody(sealed), out);
  return { text: norm(out.join('\n')), output };
}

const NOMINAL = 'demo-6m-seuils-manuels';

describe('PV pressiometre — fac-similé du rapport natif PressioPro (renderResults)', () => {
  it('given une sortie serveur nominale when corps PV rendu then sections & libellés du rapport natif présents', () => {
    const { text } = renderFor(NOMINAL);

    // En-tête d'analyse (extraction/classification, sans verdict de conformité).
    expect(text).toContain('extraction / classification');

    // Sections reproduites — chaque libellé DOIT exister dans le rapport natif
    // (anti-dérive), et être rendu dans le PV (titres de section en MAJUSCULE).
    const anchors: Array<[string, string]> = [
      ['Extrapolation p', 'EXTRAPOLATION PLM'],
      ['Courbe inverse', 'Courbe inverse'],
      ['Paramètres normalisés', 'PARAMÈTRES NORMALISÉS'],
      ['Tableau des mesures corrigées', 'TABLEAU DES MESURES CORRIGÉES'],
      ['α Ménard', 'α Ménard'],
      ['E/α', 'E/α'],
    ];
    for (const [inRef, inPv] of anchors) {
      expect(referenceSource.includes(inRef)).toBe(true);
      expect(text.includes(inPv)).toBe(true);
    }
    // Colonnes de la table des mesures + phases (verbatim client).
    for (const phase of ['Recompression', 'Pseudo-élast.', 'Plastique']) {
      expect(referenceSource.includes(phase)).toBe(true);
      expect(text.includes(phase)).toBe(true);
    }
  });

  it('grilles KPI : EM · pL · Pf · E/PLM (+ classement) puis P*LM · P*f · α · Ey — valeurs serveur', () => {
    const { text, output } = renderFor(NOMINAL);
    const o = output as Record<string, number>;

    // KPI 1 (décimales du rapport natif : EM 2, pressions ×0,1 → 3, ratio 1).
    expect(text).toContain(`${fmt(o.EM, 2)}`); // 23,62
    expect(text).toContain(mpa(o.pL, 3, '')); // 1,909
    expect(text).toContain(mpa(o.pf, 3, '')); // 0,850
    expect(text).toContain(`${fmt(o.ratioEMpL, 1)}`); // 12,4
    // Classement rhéologique : ratio ≥ 12 → Précons. (miroir des seuils client).
    expect(o.ratioEMpL).toBeGreaterThanOrEqual(12);
    expect(text).toContain('Précons.');
    expect(referenceSource).toContain('Précons.');

    // KPI 2.
    expect(text).toContain(mpa(o.pLNette, 3, '')); // 1,837
    expect(text).toContain(mpa(o.pfNette, 3, '')); // 0,778
    expect(text).toContain(`${fmt(o.alpha, 2)}`); // 0,33
    expect(text).toContain(`${fmt(o.Ey, 1)}`); // 71,6
  });

  it('Extrapolation pLM §D.4.3 : coefficients A/B (notation exp) + PLM/asymptote/erreur', () => {
    const { text, output } = renderFor(NOMINAL);
    const ext = (output.extrapolation ?? {}) as Record<string, number>;
    expect(text).toContain(expo(ext.a)); // A en notation scientifique fr-FR
    expect(text).toContain(expo(ext.b)); // B
    expect(text).toContain(mpa(ext.plmVLim, 3)); // pLM au V conventionnel
    expect(text).toContain(mpa(ext.plmAsymptote, 3)); // pLM asymptote
    expect(text).toContain(fmt(ext.errV, 2, 'cm³')); // écart d'ajustement
    // pL extrapolée sur ce fixture → mention de méthode §D.4.3.2.
    expect(output.pLDirect).toBe(false);
    expect(text).toContain('§D.4.3.2');
  });

  it('Paramètres normalisés : pE, p₀, σh0 (avec z), pf*, pL* + table des volumes', () => {
    const { text, output } = renderFor(NOMINAL);
    const o = output as Record<string, number>;
    const vol = output.volumes as Record<string, number>;
    // Pressions de calage (4 décimales pour pE/p₀/σh0, comme le rapport natif).
    expect(text).toContain(mpa(o.pE, 4, '')); // 0,0500
    expect(text).toContain(mpa(o.p0, 4, '')); // 0,2500
    expect(text).toContain(mpa(o.sigmaH0, 4, '')); // 0,0717
    // Annotation de profondeur z sur σh0.
    expect(text).toContain(`z = ${fmt(o.z, 1)} m`); // z = 6,0 m
    // Volumes de référence (cm³, 0 décimale).
    expect(text).toContain(fmt(vol.vE, 0)); // VE
    expect(text).toContain(fmt(vol.v0, 0)); // V(p0)
    expect(text).toContain(fmt(vol.vf, 0)); // V(pf)
    expect(text).toContain(fmt(vol.vLim, 0)); // VLim
  });

  it('Synthèse : β, mE (×10 cm³/MPa), plage auto Lx→Ly, corrections a/Ph/Pe/Vs (entrée opérateur)', () => {
    const { sealed, output } = sealFor(NOMINAL);
    const out: string[] = [];
    walkText(buildPressiometreBody(sealed), out);
    const text = norm(out.join('\n'));
    const synth = output.synthese as Record<string, number>;
    const params = (sealed.input as Record<string, Record<string, number>>)
      .params;

    expect(text).toContain(`β = ${fmt(synth.beta, 3)}`); // 1,500
    // mE affiché ×10 (cm³/bar interne → cm³/MPa).
    expect(text).toContain(`${fmt(synth.mE * 10, 0)} cm³/MPa`);
    // Plage auto (indices 0-base → L{+1}).
    expect(text).toContain(
      `L${synth.plageAutoDebut + 1}→L${synth.plageAutoFin + 1}`,
    );
    // Corrections = ENTRÉE opérateur (a en cm³/bar → cm³/MPa ×10).
    expect(text).toContain(`a = ${fmt(params.a * 10, 3)} cm³/MPa`); // 5,000
    expect(text).toContain(`Ph = ${fmt(params.Ph, 3)} bar`);
    expect(text).toContain(`Pe = ${fmt(params.Pe, 2)} bar`);
    expect(text).toContain(`Vs = ${fmt(params.V0, 0)} cm³`);
  });

  it('Table des mesures corrigées : # / P brut / P corr. / V60 / Δ60/30 / Phase depuis output.courbe', () => {
    const { text, output } = renderFor(NOMINAL);
    const courbe = output.courbe as Array<Record<string, number | string>>;
    expect(courbe.length).toBeGreaterThan(0);
    const c0 = courbe[0];
    expect(text).toContain(fmt(c0.p as number, 3)); // P brut (3 déc.)
    expect(text).toContain(fmt(c0.pCorr as number, 4)); // P corr. (4 déc.)
    expect(text).toContain(String(c0.phase)); // Phase verbatim
  });

  it('encadré catégorie de sol : lettre + libellé + description (valeurs serveur)', () => {
    const { text, output } = renderFor(NOMINAL);
    expect(text).toContain(String(output.categorieLibelle));
    expect(text).toContain(String(output.categorieDescription));
    // La catégorie de ce fixture est bien peuplée (garde anti faux-vert).
    expect(String(output.categorie).length).toBeGreaterThan(0);
  });

  it('garde-fou « Résultat non corrigé » : a = 0 (calibrage non renseigné) → avertissement', () => {
    const { text, output } = renderFor('demo-4m-a-nul');
    expect(output.aUsed).toBe(0);
    expect(output.aForced).toBe(false);
    expect(referenceSource).toContain('Résultat non corrigé');
    expect(text).toContain('Résultat non corrigé');
    expect(text).toContain('calibrage non renseigné');
  });

  it('garde-fou « a forcé à 0 » : a écrêté par la garde volume → mention distincte', () => {
    const { text, output } = renderFor('borne-a-trop-grand');
    expect(output.aUsed).toBe(0);
    expect(output.aForced).toBe(true);
    expect(text).toContain('Résultat non corrigé');
    expect(text).toContain('forcé à 0');
  });

  it('garde-fou « EM = 0 » : plage pseudo-élastique invalide → avertissement', () => {
    const { text, output } = renderFor('degenere-em-nul-dv-negatif');
    expect(output.EM).toBe(0);
    expect(text).toContain('EM = 0');
  });

  it('chrome GEOFAM + référentiel NF EN ISO 22476-4 ; JAMAIS AGEROUTE ni ROADSEN', () => {
    const { text } = renderFor(NOMINAL);
    expect(text).toContain('GEOFAM');
    expect(text).toContain('NF EN ISO 22476-4');
    expect(text.includes('AGEROUTE')).toBe(false);
    expect(text.includes('ROADSEN')).toBe(false);
  });

  it('FERMETURE §8 : un champ confidentiel injecté dans la sortie N’EST PAS rendu (clés nommées, fail-closed)', () => {
    // On pollue la sortie scellée avec des intermédiaires SERVEUR (jamais affichés :
    // décomposition σV0, pression nette par palier, analyse de pente) — le corps PV
    // lit par clés NOMMÉES et ne doit en rendre AUCUN.
    const { sealed } = sealFor(NOMINAL, (o) => ({
      ...o,
      sigV0Confidentiel: 987654,
      penteBruteInterne: [123456, 234567],
      pressionNetteParPalier: [345678],
    }));
    const out: string[] = [];
    walkText(buildPressiometreBody(sealed), out);
    const text = out.join('\n');
    expect(text.includes('987654')).toBe(false);
    expect(text.includes('123456')).toBe(false);
    expect(text.includes('234567')).toBe(false);
    expect(text.includes('345678')).toBe(false);
  });

  it('MUTATION anti-faux-vert : la valeur EM RÉELLE est rendue, une valeur perturbée ne l’est PAS', () => {
    const { text, output } = renderFor(NOMINAL);
    const em = output.EM as number;
    const correct = fmt(em, 2); // 23,62
    const mutated = fmt(em + 1.11, 2); // 24,73 — absent si le rendu suit la sortie
    expect(correct).not.toBe(mutated); // l'assertion est discriminante
    expect(text).toContain(correct);
    expect(text.includes(mutated)).toBe(false);
  });
});
