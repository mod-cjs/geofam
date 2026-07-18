/**
 * ÉQUIVALENCE PV ↔ RAPPORT NATIF GEOPLAQUE (radier / plaque + modes 2D) — décision
 * titulaire 18/07. Le PV scellé doit reproduire, SECTION PAR SECTION, la note que
 * l'outil client imprime (`printReport` de GEOPLAQUE_V10.html), en consommant la MÊME
 * sortie serveur whitelistée (`runRadier` / `runPlaneStrain` / `runAxi` / `runTriRaft`)
 * que le CLONE affiche à l'écran. Invariant : PV == écran == rapport client.
 *
 * MÉTHODE (patron pieux/terzaghi-facsimile) : on construit le CORPS pdfmake DIRECTEMENT
 * via `buildRadierBody(sealed)` (etc.), SANS passer par le dispatch global de pv-pdf.ts
 * (recablé en parallèle), depuis la sortie RÉELLE des `run*(fixture)`. On prouve :
 *   - les MÊMES titres de section que la note native (chaînes vérifiées présentes DANS le
 *     source de référence — garde anti-dérive, zéro faux-vert) ;
 *   - le TABLEAU DE VÉRIFICATIONS EC7 (annexe H) avec un VERDICT PAR CRITÈRE ;
 *   - le « Modèle — fondations » (échos d'entrée saisis) ;
 *   - la décision d'affichage COPIE-CLIENT préservée (tassements ×1000, angles crus) ;
 *   - la réserve nœuds EF #54 (aucune localisation de nœud/maillage n'est imprimée) ;
 *   - un test de MUTATION anti-faux-vert (le verdict EC7 SUIT la donnée).
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import {
  AXI_FIXTURES,
  PLANE_STRAIN_FIXTURES,
  RADIER_FIXTURES,
  TRI_RAFT_FIXTURES,
  runAxi,
  runPlaneStrain,
  runRadier,
  runTriRaft,
  type RadierInput,
} from '@roadsen/engines';
import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces';

import { getPvPrinter } from '../pv-pdf.fonts';
import { COLORS, PV_STYLES } from '../pv-pdf.theme';
import type { SealedContent } from '../pv-pdf';

import {
  buildAxiBody,
  buildPlaneStrainBody,
  buildRadierBody,
  buildTriRaftBody,
} from './radier';

// Source de référence (LECTURE SEULE) — ancre anti-dérive : tout libellé qu'on affirme
// reproduire DOIT exister dans la note native. packages/engines/reference.
const REFERENCE_HTML = resolve(
  dirname(__filename),
  '../../../../../../packages/engines/reference/GEOPLAQUE_V10.html',
);
const referenceSource = readFileSync(REFERENCE_HTML, 'utf8');

/** Normalise toute espace (dont l'insécable fr-FR) en espace simple. */
function norm(s: string): string {
  return s.replace(/\s+/g, ' ');
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

/** Cellule pdfmake -> texte (index dans une ligne de table). */
function cellText(c: unknown): string {
  return c &&
    typeof c === 'object' &&
    typeof (c as { text?: unknown }).text === 'string'
    ? (c as { text: string }).text
    : '';
}

/** Renvoie les textes de cellule de la 1re ligne dont la cellule 0 = `label`. */
function findRowCells(content: unknown, label: string): string[] | null {
  let found: string[] | null = null;
  const walk = (n: unknown): void => {
    if (found || n == null) return;
    if (Array.isArray(n)) {
      n.forEach(walk);
      return;
    }
    if (typeof n === 'object') {
      const o = n as Record<string, unknown>;
      const table = o.table as { body?: unknown[][] } | undefined;
      if (table?.body) {
        for (const row of table.body) {
          if (Array.isArray(row) && cellText(row[0]) === label) {
            found = row.map(cellText);
            return;
          }
        }
      }
      Object.values(o).forEach(walk);
    }
  };
  walk(content);
  return found;
}

/** Formatte fr-FR décimales fixes, espaces normalisées (miroir fdnNum sans unité). */
function fmtFr(v: number, d = 0): string {
  return norm(
    v.toLocaleString('fr-FR', {
      maximumFractionDigits: d,
    }),
  );
}

/** Miroir de `fdnSettleMm` : (v×1000) fr-FR 1 décimale + « mm ». */
function settleMm(v: number): string {
  return `${fmtFr(v * 1000, 1)} mm`;
}

// Seuils EC7 (annexe H) — miroir des `lvl*` de la note native, ré-affirmés ci-dessous
// contre le SOURCE DE RÉFÉRENCE (anti-dérive).
type Level = 'CONFORME' | 'ATTENTION' | 'DÉPASSEMENT';
function verdictSettle(mm: number): Level {
  return mm <= 25 ? 'CONFORME' : mm <= 50 ? 'ATTENTION' : 'DÉPASSEMENT';
}
function verdictDiff(mm: number): Level {
  return mm <= 10 ? 'CONFORME' : mm <= 20 ? 'ATTENTION' : 'DÉPASSEMENT';
}
function verdictBeta(bv: number): Level {
  return bv <= 1 / 500
    ? 'CONFORME'
    : bv <= 1 / 150
      ? 'ATTENTION'
      : 'DÉPASSEMENT';
}

const ENGINE_ID = 'radier-plaque';

/** Construit un SealedContent COHÉRENT pour un calcul radier. */
function sealFor(
  engineId: string,
  input: unknown,
  output: unknown,
): SealedContent {
  return {
    pvNumber: 'PV-RDS-radier-2026-000001',
    sealedAt: '2026-07-18T09:00:00.000Z',
    engineMeta: {
      engineId,
      engineVersion: '1.0.0',
      engineSourceHash: 'c'.repeat(64),
    },
    identity: {
      userId: 'u-1',
      userDisplayName: 'A. DIALLO',
      orgDisplayName: 'BE TEST',
      projectId: 'p-1',
      projectName: 'Radier R1',
    },
    input,
    output,
    scienceStatus: 'signed',
    verdict: 'NON_APPLICABLE',
  };
}

function radierFixture(id: string): RadierInput {
  const fx = RADIER_FIXTURES.find((f) => f.id === id);
  if (!fx) throw new Error(`fixture radier ${id} absente`);
  return fx.input;
}

/** Rend le corps radier depuis la sortie RÉELLE runRadier(input). */
function bodyFor(input: RadierInput): {
  content: Content[];
  text: string;
  output: Record<string, unknown>;
} {
  const env = runRadier(input);
  if (!env.ok) throw new Error('runRadier a échoué');
  const output = env.output as unknown as Record<string, unknown>;
  const content = buildRadierBody(sealFor(ENGINE_ID, input, output));
  const acc: string[] = [];
  collectText(content, acc);
  return { content, text: norm(acc.join('\n')), output };
}

describe('PV radier — fac-similé de la note native (printReport GEOPLAQUE_V10)', () => {
  it('given une sortie serveur radier when corps rendu then sections & titres de la note native présents', () => {
    const { text } = bodyFor(radierFixture('carre-charge-centree'));
    for (const heading of [
      'Modèle — fondations',
      'Vérifications — Eurocode 7, annexe H',
    ]) {
      expect(referenceSource.includes(heading)).toBe(true);
      expect(text.includes(heading.toUpperCase())).toBe(true);
    }
    // Sections de diagnostic (déjà présentes avant l'ajout).
    expect(text).toContain('DÉFLEXIONS & DISTORSIONS');
    expect(text).toContain('SYNTHÈSE — BILAN GLOBAL');
  });

  it('les seuils EC7 (annexe H) que le PV applique sont ceux de la note native (anti-dérive)', () => {
    // Ancre : la note native définit bien ces seuils publics (mm & ratios).
    expect(referenceSource).toContain(
      "function lvlSettle(mm){ return mm<=25?'ok':mm<=50?'warn':'bad'; }",
    );
    expect(referenceSource).toContain(
      "function lvlDiff(mm){ return mm<=10?'ok':mm<=20?'warn':'bad'; }",
    );
    expect(referenceSource).toContain(
      "function lvlBeta(bv){ return bv<=1/500?'ok':bv<=1/150?'warn':'bad'; }",
    );
    // Et les 3 verdicts textuels.
    for (const v of ['CONFORME', 'ATTENTION', 'DÉPASSEMENT'])
      expect(referenceSource.includes(v)).toBe(true);
  });

  it('Vérifications EC7 : VERDICT PAR CRITÈRE + valeur + repère, recalculés depuis la sortie serveur', () => {
    const { content, output } = bodyFor(radierFixture('carre-charge-centree'));
    const wMax = output.wMax as number;
    const diff = output.diff as number;
    const betaGov = output.betaGov as number;

    // Tassement total max : valeur ×1000, repère « ≈ 50 mm », verdict = lvlSettle.
    const rowW = findRowCells(content, 'Tassement total max');
    expect(rowW).not.toBeNull();
    expect(rowW![1]).toBe(settleMm(wMax));
    expect(rowW![2]).toBe('≈ 50 mm');
    expect(rowW![3]).toBe(verdictSettle(wMax * 1000));

    // Tassement différentiel : repère « ≈ 20 mm », verdict = lvlDiff.
    const rowD = findRowCells(content, 'Tassement différentiel');
    // (deux lignes portent ce libellé — EC7 ET Déflexions ; findRowCells prend la 1re
    //  rencontrée = celle de la table EC7, à 4 colonnes.)
    expect(rowD).not.toBeNull();
    expect(rowD![2]).toBe('≈ 20 mm');
    expect(rowD![3]).toBe(verdictDiff(diff * 1000));

    // Distorsion angulaire β : repère ELS/ELU, verdict = lvlBeta.
    const rowB = findRowCells(content, 'Distorsion angulaire β');
    expect(rowB).not.toBeNull();
    expect(rowB![2]).toBe('ELS 1/500 · ELU 1/150');
    expect(rowB![3]).toBe(verdictBeta(betaGov));
  });

  it('réserve nœuds EF #54 : AUCUNE localisation de nœud (« — en (x,y) ») n’est imprimée', () => {
    const { text, output } = bodyFor(radierFixture('carre-charge-centree'));
    // La sortie serveur ne whiteliste PAS les localisations *At (méthode EF).
    expect('wMaxAt' in output).toBe(false);
    expect('wMinAt' in output).toBe(false);
    expect('betaGovAt' in output).toBe(false);
    // La note native adjoint « — en (…) » aux valeurs EC7 ; le PV ne le fait jamais.
    expect(text.includes(' — en (')).toBe(false);
    expect(text.includes(' — entre (')).toBe(false);
  });

  it('inter-plaques : critère « Distorsion entre plaques » présent avec son verdict (2 radiers)', () => {
    const { content, output } = bodyFor(radierFixture('deux-plaques-inter'));
    expect(output.nRafts).toBeGreaterThan(1);
    const row = findRowCells(content, 'Distorsion entre plaques');
    expect(row).not.toBeNull();
    expect(row![2]).toBe('ELS 1/500');
    expect(row![3]).toBe(verdictBeta(output.betaInter as number));
  });

  it('entre charges voisines : critère avec paire P?↔P? présent quand worstLoadPair servi (4 poteaux)', () => {
    const { content, text, output } = bodyFor(
      radierFixture('carre-quatre-poteaux'),
    );
    const wlp = output.worstLoadPair as Record<string, number> | null;
    expect(wlp).not.toBeNull();
    // Le libellé du critère porte la paire (indices SAISIS ki/kj, client-safe).
    expect(text).toContain(
      `Distorsion entre charges (max) — P${fmtFr(wlp!.ki)}↔P${fmtFr(wlp!.kj)}`,
    );
    // Verdict = lvlBeta(worst.beta).
    const label = `Distorsion entre charges (max) — P${fmtFr(wlp!.ki)}↔P${fmtFr(wlp!.kj)}`;
    const row = findRowCells(content, label);
    expect(row).not.toBeNull();
    expect(row![3]).toBe(verdictBeta(wlp!.beta));
  });

  it('Modèle — fondations : plaque (E en MPa, ν, e), profil de sol = échos d’entrée saisis', () => {
    const input = radierFixture('carre-charge-centree');
    const { content } = bodyFor(input);
    const raft = input.rafts[0];
    // La plaque R1 porte E en MPa (SANS le /1000 de la note native, qui convertit ses kPa).
    const rowR1 = findRowCells(content, 'R1');
    expect(rowR1).not.toBeNull();
    expect(rowR1).toContain(`${fmtFr(raft.E)} MPa`);
    expect(rowR1).toContain(`${fmtFr(raft.nu, 2)}`);
    expect(rowR1).toContain(`${fmtFr(raft.e, 2)} m`);
    // Profil de sol : 1re couche (nom + E MPa).
    const layer0 = input.layers[0];
    const name = layer0.name ?? 'Couche 1';
    const rowL = findRowCells(content, name);
    expect(rowL).not.toBeNull();
    expect(rowL).toContain(`${fmtFr(layer0.E)} MPa`);
  });

  it('COPIE-CLIENT préservée : tassements ×1000 (Déflexions) + angles crus « rad » via ratio1', () => {
    const { text, output } = bodyFor(radierFixture('carre-charge-centree'));
    // Tassement max ×1000 (défaut d'affichage copié).
    expect(text).toContain(settleMm(output.wMax as number));
    // Distorsion gouvernante CRUE : ratio1(β) + « (…e… rad) ».
    const beta = output.betaGov as number;
    if (beta > 0) {
      expect(text).toContain(`${beta.toExponential(1).replace('.', ',')} rad`);
    }
  });

  it('MUTATION anti-faux-vert : le VERDICT EC7 suit la donnée (CONFORME → ATTENTION → DÉPASSEMENT)', () => {
    const input = radierFixture('carre-charge-centree');
    const env = runRadier(input);
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    const output = env.output as unknown as Record<string, unknown>;

    // wMax 0,02 -> 20 mm ≤ 25 -> CONFORME.
    const conforme = buildRadierBody(
      sealFor(ENGINE_ID, input, { ...output, wMax: 0.02 }),
    );
    expect(findRowCells(conforme, 'Tassement total max')![3]).toBe('CONFORME');

    // wMax 0,04 -> 40 mm ∈ ]25;50] -> ATTENTION.
    const attention = buildRadierBody(
      sealFor(ENGINE_ID, input, { ...output, wMax: 0.04 }),
    );
    expect(findRowCells(attention, 'Tassement total max')![3]).toBe(
      'ATTENTION',
    );

    // wMax 0,06 -> 60 mm > 50 -> DÉPASSEMENT.
    const depassement = buildRadierBody(
      sealFor(ENGINE_ID, input, { ...output, wMax: 0.06 }),
    );
    expect(findRowCells(depassement, 'Tassement total max')![3]).toBe(
      'DÉPASSEMENT',
    );
  });

  it('RENDU RÉEL : le corps radier se génère en Buffer PDF sans erreur (bout-en-bout)', async () => {
    const { content } = bodyFor(radierFixture('carre-quatre-poteaux'));
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

describe('PV modes 2D GEOPLAQUE — corps déplacés, panneaux natifs préservés', () => {
  it('plane-strain : panneau #ps-run (tassement ×1000, moments, rigidité D) rendu', () => {
    const fx = PLANE_STRAIN_FIXTURES.find((f) => f.id === 'bande-repartie');
    if (!fx) throw new Error('fixture plane-strain absente');
    const env = runPlaneStrain(fx.input);
    if (!env.ok) throw new Error('runPlaneStrain a échoué');
    const output = env.output as unknown as Record<string, unknown>;
    const content = buildPlaneStrainBody(
      sealFor('plane-strain', fx.input, output),
    );
    const acc: string[] = [];
    collectText(content, acc);
    const text = norm(acc.join('\n'));
    expect(text).toContain('RÉSULTATS — COUPE EN DÉFORMATIONS PLANES');
    expect(text).toContain('Rigidité de flexion D');
    expect(findRowCells(content, 'Tassement maximal w_max')![1]).toBe(
      settleMm(output.wMax as number),
    );
  });

  it('axi & tri : les corps se génèrent (panneaux #ax-run / #tri-run) sans throw', () => {
    const axiFx = AXI_FIXTURES.find((f) => f.id === 'q-reparti-2couches');
    const triFx = TRI_RAFT_FIXTURES.find(
      (f) => f.id === 'carre-charge-centree',
    );
    if (!axiFx || !triFx) throw new Error('fixture axi/tri absente');
    const axiEnv = runAxi(axiFx.input);
    const triEnv = runTriRaft(triFx.input);
    expect(axiEnv.ok).toBe(true);
    expect(triEnv.ok).toBe(true);
    if (!axiEnv.ok || !triEnv.ok) return;
    const axiContent = buildAxiBody(
      sealFor('axi-plaque', axiFx.input, axiEnv.output),
    );
    const triContent = buildTriRaftBody(
      sealFor('radier-tri', triFx.input, triEnv.output),
    );
    const a: string[] = [];
    collectText(axiContent, a);
    const t: string[] = [];
    collectText(triContent, t);
    expect(norm(a.join('\n'))).toContain('RÉSULTATS — PLAQUE AXISYMÉTRIQUE');
    expect(norm(t.join('\n'))).toContain(
      'RÉSULTATS — RADIER MAILLÉ (TRIANGULAIRE)',
    );
  });
});
