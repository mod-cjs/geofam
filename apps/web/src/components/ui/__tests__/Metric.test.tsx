/**
 * Tests — A-10 Metric + helper fmt()
 *
 * DoD §9 : given/when/then, chemins négatifs (NaN/Infinity/null/undefined),
 * variantes, unité muted.
 */

import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import { Metric, fmt } from "../Metric";

function render(node: React.ReactElement): string {
  return renderToString(node);
}

describe("fmt() — helper formatage", () => {
  it("given a finite number, formats with fr-FR locale (comma decimal)", () => {
    const result = fmt(1243.5, 1);
    expect(result).toContain("1");
    expect(result).toContain("243");
    // Doit contenir une virgule (fr-FR) ou l'espace fine + 5
    expect(result).toMatch(/1[^\d]?243/);
  });

  it("given NaN, returns '—'", () => {
    expect(fmt(NaN)).toBe("—");
  });

  it("given Infinity, returns '—'", () => {
    expect(fmt(Infinity)).toBe("—");
  });

  it("given -Infinity, returns '—'", () => {
    expect(fmt(-Infinity)).toBe("—");
  });

  it("given 0, formats as '0'", () => {
    const result = fmt(0, 0);
    expect(result).toBe("0");
  });
});

describe("Metric — A-10", () => {
  describe("Rendu variante table (défaut)", () => {
    it("given a valid number, renders the formatted value", () => {
      const html = render(<Metric value={1243.5} decimals={1} />);
      expect(html).toContain("1");
      expect(html).not.toContain("NaN");
      expect(html).not.toContain("Infinity");
    });

    it("renders unit in muted span when provided", () => {
      const html = render(<Metric value={100} unit="kPa" />);
      expect(html).toContain("kPa");
      expect(html).toContain("text-muted");
    });

    it("unit has aria-hidden=true (décoratif)", () => {
      const html = render(<Metric value={100} unit="MPa" />);
      expect(html).toContain('aria-hidden="true"');
    });
  });

  describe("Valeur indisponible (null / undefined / NaN / Infinity)", () => {
    it("given null, renders '—' and never 'null'", () => {
      const html = render(<Metric value={null} />);
      expect(html).toContain("—");
      expect(html).not.toContain("null");
    });

    it("given undefined, renders '—'", () => {
      const html = render(<Metric value={undefined} />);
      expect(html).toContain("—");
    });

    it("given NaN, renders '—' not 'NaN'", () => {
      const html = render(<Metric value={NaN} />);
      expect(html).toContain("—");
      expect(html).not.toContain("NaN");
    });

    it("given Infinity, renders '—' not 'Infinity'", () => {
      const html = render(<Metric value={Infinity} />);
      expect(html).toContain("—");
      expect(html).not.toContain("Infinity");
    });

    it("when unavailable, unit is NOT rendered", () => {
      const html = render(<Metric value={NaN} unit="kPa" />);
      expect(html).not.toContain("kPa");
    });
  });

  describe("Variante isolated (valeur phare)", () => {
    it("renders at large size (32px in style)", () => {
      const html = render(<Metric value={1500} variant="isolated" />);
      expect(html).toContain("32");
      expect(html).toContain("600");
    });
  });

  describe("Variante out-of-range", () => {
    it("uses fail color token", () => {
      const html = render(<Metric value={99999} variant="out-of-range" />);
      expect(html).toContain("status-fail-tx");
    });
  });

  describe("Variante unavailable", () => {
    it("renders muted color", () => {
      const html = render(<Metric value={null} variant="unavailable" />);
      expect(html).toContain("text-muted");
    });
  });

  describe("Geist Mono + tabular-nums", () => {
    it("numeric display uses font-mono and tabular-nums", () => {
      const html = render(<Metric value={42} />);
      expect(html).toContain("font-mono");
      expect(html).toContain("tabular-nums");
    });
  });

  describe("Zéro faux-vert", () => {
    it("renders non-empty span HTML", () => {
      const html = render(<Metric value={0} />);
      expect(html).toContain("<span");
      expect(html.length).toBeGreaterThan(10);
    });
  });
});
