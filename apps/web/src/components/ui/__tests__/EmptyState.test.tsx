/**
 * Tests — A-16 EmptyState
 *
 * DoD §9 : variantes distinctes, textes métier, CTA conditionnel, a11y.
 */

import { describe, it, expect, vi } from "vitest";
import { renderToString } from "react-dom/server";
import {
  EmptyState,
  PreCalcEmptyState,
  NoCalcEmptyState,
  NoPvEmptyState,
  NetworkErrorEmptyState,
  FilterEmptyState,
} from "../EmptyState";

function render(node: React.ReactElement): string {
  return renderToString(node);
}

describe("EmptyState — A-16", () => {
  describe("Variante blank (premier usage)", () => {
    it("renders title text", () => {
      const html = render(<EmptyState variant="blank" title="Aucun projet disponible." />);
      expect(html).toContain("Aucun projet disponible.");
    });

    it("renders description when provided", () => {
      const html = render(
        <EmptyState
          variant="blank"
          title="Titre"
          description="Description contextuelle."
        />
      );
      expect(html).toContain("Description contextuelle.");
    });

    it("renders CTA button when ctaLabel and onCta provided", () => {
      const html = render(
        <EmptyState
          variant="blank"
          title="Vide"
          ctaLabel="Nouveau calcul"
          onCta={() => {}}
        />
      );
      expect(html).toContain("Nouveau calcul");
    });

    it("does NOT render CTA when onCta is absent", () => {
      const html = render(
        <EmptyState variant="blank" title="Vide" ctaLabel="CTA sans handler" />
      );
      expect(html).not.toContain("CTA sans handler");
    });
  });

  describe("Variante filtered (filtre sans résultat)", () => {
    it("renders filter-specific content", () => {
      const html = render(
        <EmptyState variant="filtered" title="Aucun résultat." ctaLabel="Effacer les filtres" onCta={() => {}} />
      );
      expect(html).toContain("Effacer les filtres");
    });
  });

  describe("Variante pre-calc (zone résultat avant calcul)", () => {
    it("has a minHeight attribute for CLS=0", () => {
      const html = render(<PreCalcEmptyState minHeight={240} />);
      expect(html).toContain("240");
    });

    it("renders the pre-calc text", () => {
      const html = render(<PreCalcEmptyState />);
      expect(html).toContain("résultat apparaîtra");
    });
  });

  describe("Variante network-err (erreur réseau)", () => {
    it("renders error icon (AlertCircle)", () => {
      const html = render(
        <EmptyState variant="network-err" title="Erreur de connexion." />
      );
      // AlertCircle génère un SVG
      expect(html).toContain("svg");
      // couleur d'erreur
      expect(html).toContain("status-fail-tx");
    });

    it("renders 'Réessayer' button", () => {
      const html = render(
        <NetworkErrorEmptyState onRetry={() => {}} />
      );
      expect(html).toContain("Réessayer");
    });
  });

  describe("a11y — role status et aria-live", () => {
    it("has role=status", () => {
      const html = render(<EmptyState variant="blank" title="Vide" />);
      expect(html).toContain('role="status"');
    });

    it("has aria-live=polite", () => {
      const html = render(<EmptyState variant="blank" title="Vide" />);
      expect(html).toContain('aria-live="polite"');
    });
  });

  describe("Règles métier ROADSEN", () => {
    it("NoPvEmptyState renders correct contextual text", () => {
      const html = render(<NoPvEmptyState />);
      expect(html).toContain("PV");
      expect(html).toContain("scellé");
    });

    it("NoCalcEmptyState renders with CTA when handler provided", () => {
      const html = render(<NoCalcEmptyState onNewCalc={() => {}} />);
      expect(html).toContain("Nouveau calcul");
    });

    it("FilterEmptyState renders clear filters CTA", () => {
      const html = render(<FilterEmptyState onClear={() => {}} />);
      expect(html).toContain("Effacer les filtres");
    });
  });

  describe("Règle NO emoji", () => {
    it("pre-calc variant contains no emoji", () => {
      const html = render(<PreCalcEmptyState />);
      // Pas d'emoji Unicode courants
      expect(html).not.toMatch(/[\u{1F300}-\u{1F9FF}]/u);
    });
  });

  describe("Zéro faux-vert", () => {
    it("renders non-empty HTML", () => {
      const html = render(<EmptyState variant="blank" title="Test" />);
      expect(html.length).toBeGreaterThan(40);
    });
  });
});
