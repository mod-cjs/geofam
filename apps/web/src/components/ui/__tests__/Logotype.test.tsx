/**
 * Tests — A-18 Logotype
 *
 * La barre de strates = unique actif propriétaire.
 * Variante glyphe obligatoire < 32px — motif 3-strates INTERDIT à cette taille.
 */

import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import { Logotype, StrataBar } from "../Logotype";

function render(node: React.ReactElement): string {
  return renderToString(node);
}

describe("Logotype — A-18", () => {
  describe("Variante complète (≥ 32px)", () => {
    it("renders wordmark 'GEOFAM'", () => {
      const html = render(<Logotype size={48} />);
      expect(html).toContain("GEOFAM");
    });

    it("renders 3 strata bars (3px latérite + 2px pétrole + 1px asphalte)", () => {
      const html = render(<Logotype size={48} />);
      // Les 3 hauteurs distinctes
      expect(html).toContain("3px");
      expect(html).toContain("2px");
      expect(html).toContain("1px");
    });

    it("has aria-label='GEOFAM'", () => {
      const html = render(<Logotype size={48} />);
      expect(html).toContain('aria-label="GEOFAM"');
    });

    it("strata use brand colors (#b86a2e latérite, #1f4e4a pétrole, #22262b asphalte)", () => {
      const html = render(<Logotype size={48} />);
      expect(html).toContain("#b86a2e");
      expect(html).toContain("#1f4e4a");
      expect(html).toContain("#22262b");
    });
  });

  describe("Variante glyphe (< 32px)", () => {
    it("renders 'G' initial (not full wordmark)", () => {
      const html = render(<Logotype size={24} />);
      // La variante glyphe montre "G" mais pas "GEOFAM" complet dans le wordmark
      expect(html).toContain(">G<");
    });

    it("motif 3-strates NOT rendered (only single filet)", () => {
      const html = render(<Logotype size={24} />);
      // Pas de 3 strates distinctes — juste un filet latérite 2px
      // On vérifie qu'il n'y a pas 3 div strate côte à côte (pas de #1f4e4a pétrole spécifique)
      expect(html).not.toContain("#1f4e4a");
      expect(html).not.toContain("#22262b");
    });

    it("single filet uses accent-brand token (latérite)", () => {
      const html = render(<Logotype size={24} />);
      // La variante glyphe utilise le token var(--accent-brand) = #b86a2e
      // On vérifie le token CSS, pas la valeur résolue (CSS variables ne sont pas résolues en SSR)
      expect(html).toContain("accent-brand");
    });
  });

  describe("Variante forcée via prop", () => {
    it("variant=glyph forces glyph even at size=64", () => {
      const html = render(<Logotype size={64} variant="glyph" />);
      expect(html).toContain(">G<");
    });

    it("variant=full forces full at size=16", () => {
      const html = render(<Logotype size={16} variant="full" />);
      expect(html).toContain("GEOFAM");
    });
  });

  describe("StrataBar standalone", () => {
    it("renders 3 layers", () => {
      const html = render(<StrataBar />);
      expect(html).toContain("#b86a2e");
      expect(html).toContain("#1f4e4a");
      expect(html).toContain("#22262b");
    });

    it("aria-hidden on decorative bar", () => {
      const html = render(<StrataBar />);
      expect(html).toContain('aria-hidden="true"');
    });
  });
});
