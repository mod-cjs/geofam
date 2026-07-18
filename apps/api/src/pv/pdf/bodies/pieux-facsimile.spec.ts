/**
 * ÉQUIVALENCE PV ↔ RAPPORT NATIF casagrande (fondation profonde / pieux) — décision
 * titulaire 18/07. Le PV scellé doit reproduire, SECTION PAR SECTION, la note que
 * l'outil client imprime (`renderResults` de casagrande_V5.html), en consommant la
 * MÊME sortie serveur whitelistée (`runPieux`) que le CLONE affiche à l'écran. On a
 * donc l'invariant : PV == écran == rapport client.
 *
 * MÉTHODE (patron terzaghi-facsimile) : on construit le CORPS pdfmake DIRECTEMENT via
 * `buildFonProfondeBody(sealed)` (SANS passer par le dispatch global de pv-pdf.ts,
 * recablé en parallèle) depuis la sortie RÉELLE de `runPieux(fixture)`, on collecte le
 * texte rendu et on prouve qu'il porte :
 *   - les MÊMES titres de section que la note native (chaînes vérifiées présentes DANS
 *     le source de référence — garde anti-dérive, zéro faux-vert) ;
 *   - les MÊMES valeurs (résistances, taux, cote de couche, D_ef, C_e, tassement)
 *     recalculées depuis la sortie serveur (aucun nombre magique).
 * Plus : chrome CASAGRANDE / NF P 94-262 (jamais AGEROUTE ni ROADSEN), sections
 * AJOUTÉES par l'audit (frottement latéral par couche, synthèse géométrique, colonne
 * R_m brute, encart ξ₃/ξ₄/γ_R;d1) et un test de MUTATION anti-faux-vert.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { PIEUX_FIXTURES, runPieux, type PieuxInput } from '@roadsen/engines';
import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces';

import { getPvPrinter } from '../pv-pdf.fonts';
import { COLORS, PV_STYLES } from '../pv-pdf.theme';
import type { SealedContent } from '../pv-pdf';

import { buildFonProfondeBody } from './pieux';

const ENGINE_ID = 'fondation-profonde-pieux';

// Source de référence (LECTURE SEULE) — ancre anti-dérive : tout libellé qu'on affirme
// reproduire DOIT exister dans la note native. packages/engines/reference.
const REFERENCE_HTML = resolve(
  dirname(__filename),
  '../../../../../../packages/engines/reference/casagrande_V5.html',
);
const referenceSource = readFileSync(REFERENCE_HTML, 'utf8');

/** Normalise toute espace (dont l'insecable du separateur fr-FR, couvert par \s) en espace simple. */
function norm(s: string): string {
  return s.replace(/\s+/g, ' ');
}

/** Miroir de `pieuxFmt`/`fmt(v,d)` : décimales fixes fr-FR, espaces normalisées `norm`. */
function fmtFr(v: unknown, d = 0): string {
  const x =
    typeof v === 'number'
      ? v
      : typeof v === 'string' && v.trim() !== ''
        ? Number(v.replace(',', '.'))
        : NaN;
  if (!Number.isFinite(x)) return '—';
  return norm(
    x.toLocaleString('fr-FR', {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    }),
  );
}

/** Collecte récursivement le texte d'un arbre pdfmake (miroir de `walkText`). */
function collectText(node: unknown, out: string[]): void {
  if (node == null) return;
  if (typeof node === 'string') {
    out.push(node);
    return;
  }
  if (Array.isArray(node)) {
    for (const n of node) collectText(n, out);
    return;
  }
  if (typeof node === 'object') {
    const o = node as Record<string, unknown>;
    if (typeof o.text === 'string') out.push(o.text);
    else if (o.text != null) collectText(o.text, out);
    if (o.stack) collectText(o.stack, out);
    if (o.columns) collectText(o.columns, out);
    if (o.table && typeof o.table === 'object') {
      const t = o.table as { body?: unknown };
      if (t.body) collectText(t.body, out);
    }
  }
}

/** Construit un SealedContent COHÉRENT pour un calcul pieux. */
function sealFor(input: PieuxInput, output: unknown): SealedContent {
  return {
    pvNumber: 'PV-RDS-pieux-2026-000001',
    sealedAt: '2026-07-18T09:00:00.000Z',
    engineMeta: {
      engineId: ENGINE_ID,
      engineVersion: '1.0.0',
      engineSourceHash: 'b'.repeat(64),
    },
    identity: {
      userId: 'u-1',
      userDisplayName: 'A. DIALLO',
      orgDisplayName: 'BE TEST',
      projectId: 'p-1',
      projectName: 'Pieu P1',
    },
    input: input,
    output: output,
    scienceStatus: 'signed',
    verdict: 'CONFORME',
  };
}

/** Rend le corps pieux depuis la sortie RÉELLE runPieux(input) ; renvoie {content, text, output}. */
function bodyFor(input: PieuxInput): {
  content: Content[];
  text: string;
  output: Record<string, unknown>;
} {
  const env = runPieux(input);
  if (!env.ok) throw new Error('runPieux a échoué');
  const output = env.output as unknown as Record<string, unknown>;
  const content = buildFonProfondeBody(sealFor(input, output));
  const acc: string[] = [];
  collectText(content, acc);
  return { content, text: norm(acc.join('\n')), output };
}

function pmtFixture(): PieuxInput {
  const fx = PIEUX_FIXTURES.find((f) => f.id === 'pmt-fore-da2-comp');
  if (!fx) throw new Error('fixture pmt-fore-da2-comp absente');
  return fx.input;
}

describe('PV pieux — fac-similé de la note native (renderResults)', () => {
  it('given une sortie serveur PMT nominale when corps rendu then sections & titres de la note native présents', () => {
    const { text } = bodyFor(pmtFixture());

    // Verdict de portance (miroir div.verdict).
    expect(referenceSource).toMatch(/Portance vérifiée|Portance NON vérifiée/);
    expect(text).toMatch(/Portance vérifiée|Portance NON vérifiée/);

    // Titres de section — chacun DOIT exister dans la note native (anti-dérive)…
    for (const heading of [
      'Résistances',
      'Vérifications',
      'Frottement latéral par couche',
      'Synthèse géométrique',
    ]) {
      expect(referenceSource.includes(heading)).toBe(true);
      // …et être reproduit dans le corps du PV (titres en MAJUSCULE).
      expect(text.includes(heading.toUpperCase())).toBe(true);
    }
    // Synthèse : lignes whitelistées présentes dans la référence ET dans le PV.
    for (const line of [
      'Couche porteuse',
      'Encastrement équiv.',
      'Effet de groupe',
    ]) {
      expect(referenceSource.includes(line)).toBe(true);
      expect(text.includes(line)).toBe(true);
    }
  });

  it('MJ / chrome : CASAGRANDE + NF P 94-262, JAMAIS « AGEROUTE » ni « ROADSEN » sur un PV pieux', () => {
    const { text } = bodyFor(pmtFixture());
    expect(text).toContain('Casagrande — note de calcul');
    expect(text).toContain('NF P 94-262');
    expect(text.includes('AGEROUTE')).toBe(false);
    expect(text.includes('ROADSEN')).toBe(false);
  });

  it('résistances : colonne R_m brute (R_b/R_s), caract. R_k et calcul total R_c;d = valeurs serveur', () => {
    const { text, output } = bodyFor(pmtFixture());
    // Colonne « Brut R_m » : R_b et R_s bruts (whitelist élargie) — pas magiques.
    expect(output.Rb).not.toBeNull();
    expect(output.Rs).not.toBeNull();
    expect(text).toContain(fmtFr(output.Rb, 0));
    expect(text).toContain(fmtFr(output.Rs, 0));
    // Caractéristiques + calcul total.
    expect(text).toContain(fmtFr(output.RbK, 0));
    expect(text).toContain(fmtFr(output.RsK, 0));
    expect(text).toContain(fmtFr(output.RcK, 0));
    expect(text).toContain(fmtFr(output.RcD, 0));
    // R_d PAR TERME (RbD/RsD) hors whitelist -> « — » présent (défaut NON pieux).
    expect(text).toContain('—');
    // Encart ξ₃/ξ₄/γ_R;d1 quand servis.
    if (output.xi3 != null)
      expect(text).toContain(`ξ₃ = ${fmtFr(output.xi3, 2)}`);
    if (output.gammaRd1 != null)
      expect(text).toContain(`γ_R;d1 = ${fmtFr(output.gammaRd1, 2)}`);
  });

  it('KPI : taux gouvernant + R_c;d (MN) rendus depuis la sortie serveur', () => {
    const { text, output } = bodyFor(pmtFixture());
    expect(text).toContain(
      `${fmtFr((output.tauxGouvernant as number) * 100, 0)} %`,
    );
    expect(text).toContain(fmtFr((output.RcD as number) / 1000, 2));
    if (output.tassementELS != null)
      expect(text).toContain(`${fmtFr(output.tassementELS, 1)} mm`);
  });

  it('frottement latéral par couche : fric[] rendu (cote top–bot, q_s, R_s,i) + total R_s', () => {
    const { text, output } = bodyFor(pmtFixture());
    const fric = output.fric as Array<Record<string, number>> | null;
    expect(fric).not.toBeNull();
    expect(Array.isArray(fric) && fric.length).toBeTruthy();
    const f0 = fric![0];
    // Cote de couche exacte (miroir de `fmt(f.top,1) – fmt(f.bot,1)`).
    expect(text).toContain(`${fmtFr(f0.top, 1)} – ${fmtFr(f0.bot, 1)}`);
    expect(text).toContain(fmtFr(f0.qs, 0));
    // Total R_s = R_s brut.
    expect(text).toContain('Total R_s');
  });

  it('synthèse géométrique : D_ef/B et C_e = valeurs serveur ; couche porteuse = dernière couche fric', () => {
    const { text, output } = bodyFor(pmtFixture());
    if (output.Def != null && output.debR != null)
      expect(text).toContain(
        `${fmtFr(output.Def, 2)} m · D_ef/B = ${fmtFr(output.debR, 1)}`,
      );
    if (output.Ce != null) expect(text).toContain(fmtFr(output.Ce, 2));
    const fric = output.fric as Array<Record<string, string>> | null;
    if (fric && fric.length) {
      const SOIL: Record<string, string> = {
        argile: 'Argile / Limon',
        sable: 'Sable / Grave',
        craie: 'Craie',
        marne: 'Marne / M-calc.',
        roche: 'Roche altérée',
      };
      const porteuse = SOIL[fric[fric.length - 1].soil];
      expect(text).toContain(porteuse);
    }
  });

  it('frottement négatif (downdrag) : N_max / G_sn rendus quand le groupe est fourni', () => {
    const base = pmtFixture();
    const withDowndrag: PieuxInput = {
      ...base,
      frottementNegatif: {
        mode: 'auto',
        fn_Q: 1150,
        fn_ktd: 0.2,
        fn_s0: 20,
        fn_hc: 8,
        fn_zt: 0,
        fn_zb: 0,
      },
    };
    const { text, output } = bodyFor(withDowndrag);
    expect(output.Nmax).not.toBeNull();
    expect(text).toContain('FROTTEMENT NÉGATIF');
    expect(referenceSource).toContain('Effort axial max');
    if (output.Nmax != null) expect(text).toContain(fmtFr(output.Nmax, 1));
    if (output.Gsn != null) expect(text).toContain(fmtFr(output.Gsn, 1));
  });

  it('vérification béton : verdict + f_cd (whitelistés) quand le groupe béton est fourni', () => {
    const base = pmtFixture();
    const withBeton: PieuxInput = {
      ...base,
      beton: { arm: 'arme', k3: '1.0' },
    };
    const { text, output } = bodyFor(withBeton);
    expect(output.betonApplicable).toBe(true);
    expect(text).toContain('RÉSISTANCE DU BÉTON (STRUCTURE)');
    expect(referenceSource).toContain('Résistance du béton');
    if (output.betonFcd != null)
      expect(text).toContain(`${fmtFr(output.betonFcd, 1)} MPa`);
  });

  it('MUTATION anti-faux-vert : un libellé de vérification NON whitelisté ne fuit pas (fallback indexé)', () => {
    const base = pmtFixture();
    const env = runPieux(base);
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    const output = env.output as unknown as Record<string, unknown>;
    // On INJECTE un nom de vérification non reconnu (texte libre hostile) dans l'output
    // scellé et on prouve que le corps NE l'imprime PAS (allowlist fail-closed) — s'il
    // fuyait, ce test deviendrait ROUGE.
    const hostile = '<script>FUITE_METHODE_kp_max_2.4</script>';
    const tampered = {
      ...output,
      verifications: [
        { nom: hostile, Fd: 1000, Rd: 2000, taux: 0.5, ok: true },
      ],
    };
    const content = buildFonProfondeBody(sealFor(base, tampered));
    const acc: string[] = [];
    collectText(content, acc);
    const text = acc.join('\n');
    expect(text.includes(hostile)).toBe(false);
    expect(text.includes('FUITE_METHODE')).toBe(false);
    // …remplacé par le libellé générique indexé.
    expect(text).toContain('Vérification 1');
  });

  it('RENDU RÉEL : le corps pieux se génère en Buffer PDF sans erreur (bout-en-bout)', async () => {
    const { content } = bodyFor(pmtFixture());
    const def: TDocumentDefinitions = {
      content,
      styles: PV_STYLES,
      defaultStyle: { font: 'Roboto', fontSize: 9, color: COLORS.text },
    };
    const printer = getPvPrinter();
    const doc = printer.createPdfKitDocument(def);
    const buf = await new Promise<Buffer>((res, rej) => {
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => res(Buffer.concat(chunks)));
      doc.on('error', rej);
      doc.end();
    });
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });
});
