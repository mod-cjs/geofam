/**
 * ÉQUIVALENCE PV ↔ RAPPORT NATIF chaussée (burmister / AGEROUTE 2015) — le PV scellé
 * doit reproduire le « Rapport détaillé » que l'outil client imprime (`renderDetails`
 * de roadsens_burmister_definitive.html), en consommant la MÊME sortie serveur
 * whitelistée (`runBurmister`) que le CLONE affiche à l'écran. Invariant : PV == écran
 * == rapport client.
 *
 * MÉTHODE (patron bodies/*-facsimile.spec) : on construit le CORPS pdfmake via
 * `renderRichBody(sealed, CHAUSSEE_PRESENTATION)` depuis la sortie RÉELLE de
 * `runBurmister(fixture)`, on collecte le texte rendu et on prouve qu'il porte :
 *   - les GRANDEURS du rapport détaillé (contraintes σ_z/σ_r, coefficients de la loi
 *     de fatigue LCPC kθ/SN/Sh/δ/kr/kc/ks/1_b, admissibles r/r=50 %, déformations),
 *     recalculées depuis `output.details` (aucun nombre magique) ;
 *   - des ANCRES anti-dérive : chaque coefficient/contrainte qu'on affiche EXISTE dans
 *     la note native (renderDetails) — preuve qu'il est bien affiché par l'outil
 *     client (détails-transparents, ADR 0014) et non réintroduit indûment.
 * Plus : chrome GEOFAM / AGEROUTE 2015 (jamais « ROADSEN »), fail-closed sur le chemin
 * d'erreur (pas de `details` -> pas d'annexe) et un test de MUTATION anti-faux-vert.
 *
 * §8 : on ne rend QUE les grandeurs de sortie que l'outil client affiche déjà ; la
 * matrice de transfert 4×4 et les formules de méthode (renderDetails §4 + lignes
 * `fml()`) NE sont PAS reproduites — elles décrivent l'algorithme (code serveur) et ne
 * sont pas portées par la sortie scellée.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import {
  BURMISTER_FIXTURES,
  runBurmister,
  type BurmisterFixture,
} from '@roadsen/engines';
import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces';

import { getPvPrinter } from '../pv-pdf.fonts';
import { COLORS, PV_STYLES } from '../pv-pdf.theme';
import type { SealedContent } from '../pv-pdf';

import { CHAUSSEE_PRESENTATION } from './chaussee';
import { formatValue } from './format';
import { renderRichBody } from './render';
import type { NumberFormat } from './types';

const ENGINE_ID = 'chaussee-burmister';

// Source de référence (LECTURE SEULE) — ancre anti-dérive : tout coefficient/contrainte
// qu'on affirme reproduire DOIT exister dans la note native (renderDetails).
const REFERENCE_HTML = resolve(
  dirname(__filename),
  '../../../../../../packages/engines/reference/roadsens_burmister_definitive.html',
);
const referenceSource = readFileSync(REFERENCE_HTML, 'utf8');

/** Normalise toute espace (dont l'insécable fr-FR) en espace simple. */
function norm(s: string): string {
  return s.replace(/\s+/g, ' ');
}

/** Collecte récursivement le texte d'un arbre pdfmake. */
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

/** SealedContent cohérent pour un calcul chaussée. */
function sealFor(input: unknown, output: unknown): SealedContent {
  return {
    pvNumber: 'PV-RDS-chaussee-2026-000001',
    sealedAt: '2026-07-18T09:00:00.000Z',
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
      projectName: 'RN1 Lot 3',
    },
    input,
    output,
    scienceStatus: 'signed',
    verdict: 'CONFORME',
  };
}

/** Rend le corps chaussée depuis la sortie RÉELLE runBurmister(input). */
function bodyFor(fx: BurmisterFixture): {
  content: Content[];
  text: string;
  output: Record<string, unknown>;
  details: Record<string, number | null>;
} {
  const env = runBurmister(fx.input);
  if (!env.ok) throw new Error(`runBurmister a échoué (${fx.id})`);
  const output = env.output as unknown as Record<string, unknown>;
  const content = renderRichBody(
    sealFor(fx.input, output),
    CHAUSSEE_PRESENTATION,
  );
  const acc: string[] = [];
  collectText(content, acc);
  const details = (output.details ?? {}) as Record<string, number | null>;
  return { content, text: norm(acc.join('\n')), output, details };
}

function fixture(id: string): BurmisterFixture {
  const fx = BURMISTER_FIXTURES.find((f) => f.id === id);
  if (!fx) throw new Error(`fixture ${id} absente`);
  return fx;
}

/** Miroir de formatValue().value pour asserter une grandeur recalculée (pas magique). */
function shown(v: number | null | undefined, fmt: NumberFormat): string {
  return formatValue(v, fmt).value;
}

describe('PV chaussée — fac-similé du « Rapport détaillé » (renderDetails)', () => {
  it('given une sortie serveur bitumineuse when corps rendu then les sections du rapport détaillé sont présentes', () => {
    const { text } = bodyFor(fixture('bitumineuse-epaisse-defaut'));
    for (const heading of [
      'RAPPORT DÉTAILLÉ DE CALCUL',
      'Modules pondérés et plateforme',
      'Contraintes à l’interface critique',
      'Déformation de fatigue ε_t',
      'Coefficients de la loi de fatigue',
      'Déformation d’orniérage ε_z',
    ]) {
      expect(text.includes(heading)).toBe(true);
    }
  });

  it('anti-dérive : chaque coefficient/contrainte reproduit EXISTE dans la note native (renderDetails)', () => {
    // Preuve que l'outil client AFFICHE bien ces grandeurs (détails-transparents,
    // ADR 0014) — ce sont des ancres LITTÉRALES du source de référence.
    for (const anchor of [
      'interface critique', // §5 contraintes
      'sommet PSC', // §8 σ_z/σ_r PSC
      'k&theta;', // kθ
      'kr risque',
      'kc calage',
      'ks support',
      '&delta;', // δ
      'LCPC 1994', // §7 loi de fatigue
      'Rapport d&#233;taill&#233;', // le rapport détaillé natif existe bien
    ]) {
      expect(referenceSource.includes(anchor)).toBe(true);
    }
  });

  it('coefficients de la loi de fatigue = valeurs serveur (details.*), recalculées et non magiques', () => {
    const { text, details } = bodyFor(fixture('bitumineuse-epaisse-defaut'));
    // kθ / kc / ks / kr / δ / SN / Sh / 1_b : chacun rendu depuis output.details.
    expect(details.ktheta).not.toBeNull();
    expect(text).toContain(shown(details.ktheta, { decimals: 3 }));
    expect(text).toContain(shown(details.kc, { decimals: 2 }));
    expect(text).toContain(shown(details.ks, { decimals: 4 }));
    expect(text).toContain(shown(details.kr, { decimals: 4 }));
    expect(text).toContain(shown(details.delta, { decimals: 4 }));
    expect(text).toContain(shown(details.sn, { decimals: 2 }));
    expect(text).toContain(shown(details.sh_cm, { decimals: 2 }));
    expect(text).toContain(shown(details.ub, { decimals: 1 }));
    // Libellés lisibles (pas de clés brutes).
    expect(text).toContain('kθ (température)');
    expect(text).toContain('kr (risque)');
    expect(text.includes('details.kr')).toBe(false);
  });

  it('contraintes σ_z/σ_r (interface critique + sommet PSC) = valeurs serveur en kPa', () => {
    const { text, details } = bodyFor(fixture('bitumineuse-epaisse-defaut'));
    expect(details.sigmaZ_r0).not.toBeNull();
    expect(text).toContain(shown(details.sigmaZ_r0, { decimals: 2 }));
    expect(text).toContain(shown(details.sigmaR_r0, { decimals: 2 }));
    expect(text).toContain(shown(details.sigmaZ_psc_kpa, { decimals: 2 }));
    expect(text).toContain('σ_z au sommet de la plateforme');
    expect(text).toContain('kPa');
  });

  it('déformations & modules détaillés = valeurs serveur (ε_t/ε_z, Ē pondérée, admissibles)', () => {
    const { text, details } = bodyFor(fixture('bitumineuse-epaisse-defaut'));
    expect(text).toContain(shown(details.E1_pond, { decimals: 0 }));
    expect(text).toContain(shown(details.epsilonT, { decimals: 2 }));
    expect(text).toContain(shown(details.epsilonZ_axe, { decimals: 2 }));
    // admissible à r=50 % (kr=1) — grandeur DISTINCTE de l'admissible au risque r.
    expect(details.adm_r50).not.toBeNull();
    expect(text).toContain('ε_t admissible à r=50 %');
    expect(text).toContain(shown(details.adm_r50, { decimals: 2 }));
  });

  it('famille RIGIDE : les admissibles du rapport basculent en MPa (miroir de `d.sig`)', () => {
    // beton-multi-bc5 : fatigue.rigide=true -> σ_t (MPa), pas ε_t (µdef).
    const { text, output, details } = bodyFor(fixture('beton-multi-bc5'));
    const fatigue = output.fatigue as { rigide?: boolean } | undefined;
    expect(fatigue?.rigide).toBe(true);
    if (details.adm_r50 != null) {
      // rigideFormat -> 3 décimales + MPa (et non µdef).
      expect(text).toContain(shown(details.adm_r50, { decimals: 3 }));
    }
    // L'annexe rigide affiche MPa sur l'admissible (pas seulement kPa des contraintes).
    expect(text).toContain('MPa');
  });

  it('CHROME : GEOFAM / AGEROUTE 2015, JAMAIS « ROADSEN » dans le rendu chaussée', () => {
    const { text } = bodyFor(fixture('bitumineuse-epaisse-defaut'));
    // AGEROUTE 2015 = référentiel CORRECT de ce moteur (conservé).
    expect(text).toContain('AGEROUTE');
    // Aucune trace de la marque « ROADSEN(S) » (le rapport natif l'affiche en en-tête ;
    // notre PV ne la reproduit pas).
    expect(text.toUpperCase().includes('ROADSEN')).toBe(false);
  });

  it('§8 FAIL-CLOSED : aucune formule de méthode ni matrice de transfert dans le PV', () => {
    const { text } = bodyFor(fixture('bitumineuse-epaisse-defaut'));
    // La sortie scellée ne porte pas ces chaînes ; le PV ne doit pas les réintroduire.
    expect(text.includes('M_top')).toBe(false);
    expect(text.includes('matrice de transfert')).toBe(false);
    expect(text.toLowerCase().includes('transfer matrix')).toBe(false);
    expect(text.includes('Hankel')).toBe(false);
  });

  it('§8 FAIL-CLOSED : sur le chemin d’erreur (pas de details) l’annexe détaillée est OMISE', () => {
    const env = runBurmister(fixture('bitumineuse-epaisse-defaut').input);
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    const output = env.output as unknown as Record<string, unknown>;
    // On retire `details` (simule le chemin d'erreur où le moteur ne le projette pas).
    const { details: _drop, ...noDetails } = output;
    void _drop;
    const content = renderRichBody(
      sealFor({}, noDetails),
      CHAUSSEE_PRESENTATION,
    );
    const acc: string[] = [];
    collectText(content, acc);
    const text = norm(acc.join('\n'));
    // L'en-tête d'annexe et les libellés de coefficients n'apparaissent plus.
    expect(text.includes('RAPPORT DÉTAILLÉ DE CALCUL')).toBe(false);
    expect(text.includes('kθ (température)')).toBe(false);
  });

  it('MUTATION anti-faux-vert : altérer details.kc change la valeur rendue (le PV lit bien le serveur)', () => {
    const base = fixture('bitumineuse-epaisse-defaut');
    const env = runBurmister(base.input);
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    const output = env.output as unknown as Record<string, unknown>;
    const details = output.details as Record<string, number | null>;
    const original = shown(details.kc, { decimals: 2 });

    // Sortie serveur AUTHENTIQUE -> la valeur d'origine est présente.
    const okText = norm(
      (() => {
        const a: string[] = [];
        collectText(
          renderRichBody(sealFor(base.input, output), CHAUSSEE_PRESENTATION),
          a,
        );
        return a.join('\n');
      })(),
    );
    expect(okText).toContain(original);

    // On INJECTE une valeur sentinelle distincte -> le PV DOIT la refléter (il rend la
    // donnée scellée, pas une constante). Si le rendu ignorait details, ce test rougit.
    const SENTINEL = 9.87;
    const tampered = { ...output, details: { ...details, kc: SENTINEL } };
    const tamperedText = norm(
      (() => {
        const a: string[] = [];
        collectText(
          renderRichBody(sealFor(base.input, tampered), CHAUSSEE_PRESENTATION),
          a,
        );
        return a.join('\n');
      })(),
    );
    expect(tamperedText).toContain(shown(SENTINEL, { decimals: 2 }));
  });

  it('RENDU RÉEL : le corps chaussée (avec annexe détaillée) se génère en Buffer PDF', async () => {
    const { content } = bodyFor(fixture('bitumineuse-epaisse-defaut'));
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
