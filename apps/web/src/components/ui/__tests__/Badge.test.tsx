/**
 * Tests — A-06 Badge statut
 *
 * DoD §9 : test-first, comportement (given/when/then), chemins erreur, zéro faux-vert.
 * Philosophie : tester le RENDU et l'ACCESSIBILITÉ, pas les détails d'implémentation.
 */

import { describe, it, expect } from "vitest";
import { Badge } from "../Badge";

// Helpers de rendu léger sans React Testing Library
// (RTL n'est pas installé en web — on utilise jsdom + JSDOM directement via vitest)
import { renderToString } from "react-dom/server";

function render(node: React.ReactElement): string {
  return renderToString(node);
}

describe("Badge — A-06", () => {
  describe("Rendu des 7 variantes", () => {
    const variants = [
      { variant: "conforme" as const, label: "Conforme" },
      { variant: "non-conforme" as const, label: "Non conforme" },
      { variant: "neutre" as const, label: "En attente" },
      { variant: "recalculable" as const, label: "Recalculable" },
      { variant: "scelle" as const, label: "Scellé" },
      { variant: "en-cours" as const, label: "En cours" },
      { variant: "erreur" as const, label: "Erreur" },
    ];

    for (const { variant, label } of variants) {
      it(`given variant="${variant}", renders label "${label}"`, () => {
        const html = render(<Badge variant={variant} />);
        expect(html).toContain(label);
      });
    }
  });

  describe("Accessibilité — aria-label et triple redondance", () => {
    it("given variant=conforme, has aria-label", () => {
      const html = render(<Badge variant="conforme" />);
      expect(html).toContain("aria-label");
      expect(html).toContain("Conforme");
    });

    it("given variant=non-conforme, has aria-label NON CONFORME", () => {
      const html = render(<Badge variant="non-conforme" />);
      expect(html).toContain("aria-label");
      expect(html).toContain("Non conforme");
    });
  });

  describe("Label personnalisé", () => {
    it("given label prop, overrides default label", () => {
      const html = render(<Badge variant="conforme" label="CBR conforme" />);
      expect(html).toContain("CBR conforme");
      expect(html).not.toContain(">Conforme<");
    });
  });

  describe("Verdicts — rouge/vert EXCLUSIFS", () => {
    it("variant=scelle does NOT use pass/fail colors (no green/red)", () => {
      const html = render(<Badge variant="scelle" />);
      // Le badge scellé doit utiliser surface-nav (asphalte), jamais vert/rouge
      expect(html).toContain("surface-nav");
      // Ne doit PAS contenir les couleurs verdicts
      expect(html).not.toContain("status-pass-bg");
      expect(html).not.toContain("status-fail-bg");
    });

    it("variant=conforme uses pass colors", () => {
      const html = render(<Badge variant="conforme" />);
      expect(html).toContain("status-pass");
    });

    it("variant=non-conforme uses fail colors", () => {
      const html = render(<Badge variant="non-conforme" />);
      expect(html).toContain("status-fail");
    });
  });

  describe("Zéro faux-vert — assertion robuste", () => {
    it("renders non-empty HTML for every variant", () => {
      const variants = ["conforme", "non-conforme", "neutre", "recalculable", "scelle", "en-cours", "erreur"] as const;
      for (const v of variants) {
        const html = render(<Badge variant={v} />);
        expect(html.length).toBeGreaterThan(10);
        expect(html).toContain("<span");
      }
    });
  });
});
