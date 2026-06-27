/**
 * Tests — A-08 VerdictBanner
 *
 * Triple redondance : couleur + icône + libellé texte
 * Règle : rouge/vert = verdicts UNIQUEMENT
 */

import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import { VerdictBanner } from "../VerdictBanner";

function render(node: React.ReactElement): string {
  return renderToString(node);
}

describe("VerdictBanner — A-08", () => {
  describe("Libellés par défaut", () => {
    it("verdict=pass renders 'CONFORME'", () => {
      const html = render(<VerdictBanner verdict="pass" />);
      expect(html).toContain("CONFORME");
    });

    it("verdict=fail renders 'NON CONFORME'", () => {
      const html = render(<VerdictBanner verdict="fail" />);
      expect(html).toContain("NON CONFORME");
    });
  });

  describe("Label personnalisé", () => {
    it("custom label overrides default", () => {
      const html = render(<VerdictBanner verdict="pass" label="CBR CONFORME" />);
      expect(html).toContain("CBR CONFORME");
    });
  });

  describe("Message explicatif", () => {
    it("renders message content", () => {
      const html = render(
        <VerdictBanner verdict="fail" message="Module hors tolérance." />
      );
      expect(html).toContain("Module hors tolérance.");
    });

    it("renders without message (message absent is valid)", () => {
      const html = render(<VerdictBanner verdict="pass" />);
      expect(html).toContain("CONFORME");
      // Pas d'erreur de rendu sans message
      expect(html).toContain("<div");
    });
  });

  describe("Couleurs — verdicts exclusifs", () => {
    it("pass uses status-pass-bg (not brand/accent)", () => {
      const html = render(<VerdictBanner verdict="pass" />);
      expect(html).toContain("status-pass-bg");
      expect(html).not.toContain("accent-action");
      expect(html).not.toContain("accent-brand");
    });

    it("fail uses status-fail-bg (not brand/accent)", () => {
      const html = render(<VerdictBanner verdict="fail" />);
      expect(html).toContain("status-fail-bg");
      expect(html).not.toContain("accent-action");
      expect(html).not.toContain("accent-brand");
    });
  });

  describe("Mode compact", () => {
    it("mode=compact renders span (inline)", () => {
      const html = render(<VerdictBanner verdict="pass" mode="compact" />);
      expect(html).toContain("<span");
      expect(html).toContain("CONFORME");
    });

    it("mode=extended renders div (block)", () => {
      const html = render(<VerdictBanner verdict="fail" mode="extended" />);
      expect(html).toContain("<div");
      expect(html).toContain("NON CONFORME");
    });
  });

  describe("Accessibilité", () => {
    it("extended mode has role=status", () => {
      const html = render(<VerdictBanner verdict="pass" />);
      expect(html).toContain('role="status"');
    });

    it("extended mode has aria-live=polite", () => {
      const html = render(<VerdictBanner verdict="pass" />);
      expect(html).toContain('aria-live="polite"');
    });
  });

  describe("Règle adjacence — pas de latérite/bordeaux côte à côte", () => {
    it("fail banner does NOT use accent-brand (#b86a2e) color", () => {
      const html = render(<VerdictBanner verdict="fail" />);
      // La couleur latérite (#b86a2e) ne doit pas apparaître dans un bandeau verdict
      expect(html).not.toContain("#b86a2e");
      expect(html).not.toContain("accent-brand");
    });
  });
});
