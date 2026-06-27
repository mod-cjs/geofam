/**
 * Tests — A-01 Button
 *
 * DoD §9 : given/when/then, chemins négatifs (disabled/loading), a11y de base.
 */

import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import { Button } from "../Button";

function render(node: React.ReactElement): string {
  return renderToString(node);
}

describe("Button — A-01", () => {
  describe("Rendu des 4 variantes", () => {
    it("variant=action renders with action background token", () => {
      const html = render(<Button variant="action">Calculer</Button>);
      expect(html).toContain("Calculer");
      expect(html).toContain("accent-action");
    });

    it("variant=secondary renders with petrole outline", () => {
      const html = render(<Button variant="secondary">Annuler</Button>);
      expect(html).toContain("Annuler");
      expect(html).toContain("struct-petrole");
    });

    it("variant=ghost renders", () => {
      const html = render(<Button variant="ghost">Paramètres</Button>);
      expect(html).toContain("Paramètres");
    });

    it("variant=danger renders with fail bg", () => {
      const html = render(<Button variant="danger">Supprimer</Button>);
      expect(html).toContain("Supprimer");
      expect(html).toContain("status-fail");
    });
  });

  describe("État disabled", () => {
    it("when disabled, renders disabled attribute", () => {
      const html = render(<Button disabled>Calculer</Button>);
      expect(html).toContain("disabled");
    });

    it("when disabled, opacity is 0.65", () => {
      const html = render(<Button disabled>X</Button>);
      expect(html).toContain("0.65");
    });
  });

  describe("État loading", () => {
    it("when loading, renders aria-busy=true", () => {
      const html = render(<Button loading>Calculer</Button>);
      expect(html).toContain('aria-busy="true"');
    });

    it("when loading, renders 'Calcul en cours' text", () => {
      const html = render(<Button loading>Calculer</Button>);
      expect(html).toContain("Calcul en cours");
    });

    it("when loading, renders disabled (button not clickable)", () => {
      const html = render(<Button loading>Calculer</Button>);
      expect(html).toContain("disabled");
    });
  });

  describe("Tailles sm/md/lg", () => {
    it("size=sm has height 28px", () => {
      const html = render(<Button size="sm">Sm</Button>);
      expect(html).toContain("28px");
    });

    it("size=lg has height 40px", () => {
      const html = render(<Button size="lg">Lg</Button>);
      expect(html).toContain("40px");
    });
  });

  describe("font-weight minimum 500", () => {
    it("button always has font-weight 500", () => {
      const html = render(<Button>Calculer</Button>);
      expect(html).toContain("font-weight:500");
    });
  });

  describe("iconOnly + a11y", () => {
    it("iconOnly wraps children in sr-only", () => {
      const html = render(
        <Button iconOnly aria-label="Calculer">
          Calculer
        </Button>
      );
      expect(html).toContain("sr-only");
      expect(html).toContain("Calculer");
    });
  });

  describe("onDark — accent-action-on-nav", () => {
    it("when onDark=true, uses accent-action-on-nav color", () => {
      const html = render(<Button onDark>Accès</Button>);
      expect(html).toContain("accent-action-on-nav");
    });
  });

  describe("Zéro faux-vert", () => {
    it("each variant renders non-empty button HTML", () => {
      for (const v of ["action", "secondary", "ghost", "danger"] as const) {
        const html = render(<Button variant={v}>X</Button>);
        expect(html).toContain("<button");
        expect(html.length).toBeGreaterThan(20);
      }
    });
  });
});
