/**
 * Test unitaire — DÉBORDEMENT MULTI-PAGES du gabarit générique (fallback).
 *
 * RE-SCOPE décidé le 14/07 : le PV labo (comme les 5 autres moteurs réels) passe
 * désormais par un gabarit MÉTIER dédié (buildLaboBody…) CURÉ, qui tient sur une
 * page — c'est la décision produit du 02/07 avec STARFIRE (afficher tous les
 * diagnostics OutputSchema en excluant les paramètres de méthode ; PV labo
 * complété ; démo PV-000020), pas une régression. La couverture « débordement
 * multi-pages » de l'ancien test e2e #7 (qui s'appuyait à tort sur labo) est donc
 * RÉCUPÉRÉE ICI, au niveau unitaire, contre le VRAI sujet : le gabarit générique
 * clé-valeur (buildKeyValueTable). On l'atteint via un `engineId` HORS des 6
 * moteurs réels (aucun builder dédié -> fallback lignes « Données d'entrée » /
 * « Résultats »), avec un gros volume d'entrées -> pages > 1.
 *
 * On construit un OfficialPv SCELLÉ en mémoire (sceau valide) : aucune base, aucun
 * réseau. On prouve : (1) le PDF réel déborde sur > 1 page ; (2) les titres
 * génériques sont rendus ; (3) le tableau d'entrée porte headerRows:1 (en-tête
 * répété à chaque page) ; (4) le bloc scellement est insécable (unbreakable) ;
 * (5) le footer émet « page X / Y » avec Y > 1.
 */
import type { OfficialPv } from '@prisma/client';
import {
  canonicalize,
  sealContentHash,
  sealHmac,
  type SealableValue,
} from '@roadsen/shared';

import { buildPvDocDefinition, collectPvPdfText, renderPvPdf } from './pv-pdf';

const SECRET = 'secret-unitaire-multipage';

/** Construit un OfficialPv COHÉRENT (sceau valide) pour le fallback générique. */
function makeSealedPv(input: SealableValue, output: SealableValue): OfficialPv {
  const pvNumber = 'PV-RDS-org-a-2026-009001';
  const engineId = 'generic-fallback'; // HORS des 6 -> gabarit générique
  const sealedAtIso = '2026-07-14T10:00:00.000Z';
  const content: SealableValue = {
    pvNumber,
    sealedAt: sealedAtIso,
    engineMeta: {
      engineId,
      engineVersion: '1.0.0',
      engineSourceHash: 'a'.repeat(64),
    },
    identity: { userId: 'u-1', projectId: 'p-1', projectName: 'Profil massif' },
    input,
    output,
    scienceStatus: 'unsigned',
  };
  const canonical = canonicalize(content);
  return {
    id: 'pv-mp-1',
    orgId: '11111111-1111-1111-1111-111111111111',
    calcResultId: 'c-1',
    projectId: 'p-1',
    pvNumber,
    userId: 'u-1',
    projectName: 'Profil massif',
    engineId,
    engineVersion: '1.0.0',
    engineSourceHash: 'a'.repeat(64),
    inputCanonical: canonical,
    output,
    scienceStatus: 'unsigned',
    verdict: 'NON_APPLICABLE',
    contentHash: sealContentHash(canonical),
    hmac: sealHmac(canonical, SECRET),
    sealedAt: new Date(sealedAtIso),
  };
}

/** Entrée VOLUMINEUSE : ~220 champs -> le tableau déborde largement sur A4. */
function bigInput(): SealableValue {
  const o: Record<string, number> = {};
  for (let i = 1; i <= 220; i += 1) {
    o[`parametre_identification_no_${String(i).padStart(3, '0')}`] = i * 1.25;
  }
  return o;
}

/** Compte les pages d'un PDF (même technique que l'e2e : /Type /Pages /Count). */
function pdfPageCount(buf: Buffer): number {
  const s = buf.toString('latin1');
  const m =
    /\/Type\s*\/Pages[\s\S]{0,400}?\/Count\s+(\d+)/.exec(s) ??
    /\/Count\s+(\d+)/.exec(s);
  return m ? Number(m[1]) : 0;
}

interface TableNode {
  table: { headerRows?: number; body?: unknown };
}
function findFirstTableWithHeader(content: unknown): TableNode | undefined {
  let found: TableNode | undefined;
  const walk = (n: unknown): void => {
    if (found || n == null) return;
    if (Array.isArray(n)) {
      n.forEach(walk);
      return;
    }
    if (typeof n === 'object') {
      const o = n as Record<string, unknown>;
      if (
        o.table &&
        typeof o.table === 'object' &&
        typeof (o.table as { headerRows?: unknown }).headerRows === 'number'
      ) {
        found = n as TableNode;
        return;
      }
      Object.values(o).forEach(walk);
    }
  };
  walk(content);
  return found;
}
function hasUnbreakableSeal(content: unknown): boolean {
  let ok = false;
  const walk = (n: unknown): void => {
    if (ok || n == null) return;
    if (Array.isArray(n)) {
      n.forEach(walk);
      return;
    }
    if (typeof n === 'object') {
      const o = n as Record<string, unknown>;
      if (o.unbreakable === true) {
        ok = true;
        return;
      }
      Object.values(o).forEach(walk);
    }
  };
  walk(content);
  return ok;
}
function renderFooterText(
  def: ReturnType<typeof buildPvDocDefinition>,
  page: number,
  pageCount: number,
): string {
  if (typeof def.footer !== 'function') return '';
  const out: string[] = [];
  const walk = (n: unknown): void => {
    if (n == null) return;
    if (typeof n === 'string') {
      out.push(n);
      return;
    }
    if (Array.isArray(n)) {
      n.forEach(walk);
      return;
    }
    if (typeof n === 'object') {
      const o = n as Record<string, unknown>;
      if (typeof o.text === 'string') out.push(o.text);
      else if (o.text != null) walk(o.text);
      if (o.stack) walk(o.stack);
      if (o.columns) walk(o.columns);
    }
  };
  walk(
    def.footer(page, pageCount, {
      width: 595,
      height: 842,
      orientation: 'portrait',
    }),
  );
  return out.join('\n');
}

describe('Gabarit générique (fallback) — débordement multi-pages', () => {
  const prevSecret = process.env.PV_SIGNING_SECRET;
  beforeAll(() => {
    process.env.PV_SIGNING_SECRET = SECRET;
  });
  afterAll(() => {
    if (prevSecret === undefined) delete process.env.PV_SIGNING_SECRET;
    else process.env.PV_SIGNING_SECRET = prevSecret;
  });

  it('un gros profil d’entrées DÉBORDE strictement sur plusieurs pages', async () => {
    const pv = makeSealedPv(bigInput(), { synthese: 'OK', indice: 42 });
    const buf = await renderPvPdf(pv);
    expect(buf.slice(0, 5).toString()).toBe('%PDF-');
    const pages = pdfPageCount(buf);
    expect(pages).toBeGreaterThan(1);
  });

  it('rend les titres GÉNÉRIQUES (« Données d’entrée » / « Résultats »)', () => {
    const pv = makeSealedPv(bigInput(), { synthese: 'OK', indice: 42 });
    const text = collectPvPdfText(pv);
    expect(text).toContain('DONNÉES D’ENTRÉE');
    expect(text).toContain('RÉSULTATS');
    // Le fallback n'invente pas de section métier (pas de curation).
    expect(text.includes('CLASSIFICATION GTR')).toBe(false);
  });

  it('en-tête de tableau répété (headerRows:1) + bloc scellement insécable', () => {
    const pv = makeSealedPv(bigInput(), { synthese: 'OK', indice: 42 });
    const def = buildPvDocDefinition(pv);
    const inputTable = findFirstTableWithHeader(def.content);
    expect(inputTable?.table.headerRows).toBe(1);
    expect(hasUnbreakableSeal(def.content)).toBe(true);
  });

  it('pagination « page X / Y » avec Y > 1 (footer, dernière page)', async () => {
    const pv = makeSealedPv(bigInput(), { synthese: 'OK', indice: 42 });
    const pages = pdfPageCount(await renderPvPdf(pv));
    expect(pages).toBeGreaterThan(1);
    const def = buildPvDocDefinition(pv);
    const footer = renderFooterText(def, pages, pages);
    expect(footer).toContain(`page ${pages} / ${pages}`);
    expect(footer).toContain(pv.pvNumber); // numéro répété en pied, toutes pages
  });
});
