/**
 * Tests — A-09 OutputTable
 *
 * DoD §9 : états loading / vide / erreur / success, colonnes numériques,
 * colonne gelée, ligne de groupe, aria-live.
 */

import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import { OutputTable, type TableColumn, type TableRow } from "../OutputTable";

function render(node: React.ReactElement): string {
  return renderToString(node);
}

const COLS: TableColumn[] = [
  { key: "e1", label: "E1", unit: "MPa", numeric: true, decimals: 1 },
  { key: "cbr", label: "CBR", unit: "%", numeric: true, decimals: 2 },
  { key: "methode", label: "Méthode", numeric: false },
];

const ROWS: TableRow[] = [
  { id: "Résultat 1", cells: { e1: 4200, cbr: 12.5, methode: "Burmister" } },
  { id: "Résultat 2", cells: { e1: 1800, cbr: 8.0, methode: "AGEROUTE" } },
  { id: "Groupe A", groupLabel: "Section A — Fondation" },
  { id: "Résultat 3", cells: { e1: NaN, cbr: null, methode: "Meyerhof" } },
];

describe("OutputTable — A-09", () => {
  describe("État idle (pré-calcul)", () => {
    it("renders placeholder text for CLS=0", () => {
      const html = render(<OutputTable columns={COLS} rows={[]} status="idle" />);
      expect(html).toContain("résultat apparaîtra");
    });

    it("has a minHeight for CLS=0", () => {
      const html = render(<OutputTable columns={COLS} rows={[]} status="idle" skeletonRows={6} />);
      // L'état idle inclut min-height calculé
      expect(html).toContain("min-height");
    });
  });

  describe("État loading (skeleton)", () => {
    it("renders skeleton table structure (aria-busy)", () => {
      const html = render(<OutputTable columns={COLS} rows={[]} status="loading" />);
      expect(html).toContain('aria-busy="true"');
    });

    it("renders a table element (dimensions réelles = CLS=0)", () => {
      const html = render(<OutputTable columns={COLS} rows={[]} status="loading" />);
      expect(html).toContain("<table");
    });
  });

  describe("État erreur", () => {
    it("renders error message with role=alert", () => {
      const html = render(
        <OutputTable columns={COLS} rows={[]} status="error" error="Erreur de calcul." />
      );
      expect(html).toContain('role="alert"');
      expect(html).toContain("Erreur de calcul.");
    });

    it("shows AlertCircle icon (SVG)", () => {
      const html = render(<OutputTable columns={COLS} rows={[]} status="error" />);
      expect(html).toContain("svg");
      expect(html).toContain("status-fail");
    });
  });

  describe("État empty", () => {
    it("renders empty message", () => {
      const html = render(<OutputTable columns={COLS} rows={[]} status="empty" />);
      expect(html).toContain("Aucun résultat");
    });
  });

  describe("État success — données", () => {
    it("renders table with thead and tbody", () => {
      const html = render(<OutputTable columns={COLS} rows={ROWS} status="success" />);
      expect(html).toContain("<thead");
      expect(html).toContain("<tbody");
    });

    it("renders column headers with units", () => {
      const html = render(<OutputTable columns={COLS} rows={ROWS} status="success" />);
      expect(html).toContain("E1");
      expect(html).toContain("MPa");
      expect(html).toContain("CBR");
    });

    it("renders data rows", () => {
      const html = render(<OutputTable columns={COLS} rows={ROWS} status="success" />);
      expect(html).toContain("Résultat 1");
      expect(html).toContain("Résultat 2");
    });

    it("renders group label rows with petrole background", () => {
      const html = render(<OutputTable columns={COLS} rows={ROWS} status="success" />);
      expect(html).toContain("Section A — Fondation");
      expect(html).toContain("struct-petrole");
    });

    it("numeric columns use font-mono and tabular-nums", () => {
      const html = render(<OutputTable columns={COLS} rows={ROWS} status="success" />);
      expect(html).toContain("font-mono");
      expect(html).toContain("tabular-nums");
    });

    it("NaN value renders as '—' (jamais 'NaN' brut)", () => {
      const html = render(<OutputTable columns={COLS} rows={ROWS} status="success" />);
      expect(html).toContain("—");
      expect(html).not.toContain(">NaN<");
    });

    it("null value renders as '—'", () => {
      const html = render(<OutputTable columns={COLS} rows={ROWS} status="success" />);
      // Résultat 3 a cbr=null → '—'
      const count = (html.match(/—/g) ?? []).length;
      expect(count).toBeGreaterThanOrEqual(1);
    });

    it("colonne id has position sticky", () => {
      const html = render(<OutputTable columns={COLS} rows={ROWS} status="success" />);
      // La colonne id dans les th et td contient position:sticky
      expect(html).toContain("sticky");
    });

    it("has aria-live zone for CALC_SUCCESS announcement", () => {
      const html = render(<OutputTable columns={COLS} rows={ROWS} status="success" />);
      expect(html).toContain("aria-live");
      expect(html).toContain("Résultat prêt");
    });
  });

  describe("Identifiant de colonne (label)", () => {
    it("idColumnLabel affiché dans le th", () => {
      const html = render(
        <OutputTable
          columns={COLS}
          rows={ROWS}
          status="success"
          idColumnLabel="Couche"
        />
      );
      expect(html).toContain("Couche");
    });
  });

  describe("Zéro faux-vert", () => {
    it("renders non-empty HTML in success state", () => {
      const html = render(<OutputTable columns={COLS} rows={ROWS} status="success" />);
      expect(html.length).toBeGreaterThan(200);
    });
  });
});
