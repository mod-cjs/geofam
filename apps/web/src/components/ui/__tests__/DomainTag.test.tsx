/**
 * Tests — A-07 DomainTag
 *
 * Préfixe texte NON SUPPRIMABLE : règle critique (impression N&B / daltonisme)
 */

import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import { DomainTag } from "../DomainTag";

function render(node: React.ReactElement): string {
  return renderToString(node);
}

describe("DomainTag — A-07", () => {
  describe("Préfixes texte obligatoires", () => {
    it("domain=road always renders 'CH.' prefix", () => {
      const html = render(<DomainTag domain="road" />);
      expect(html).toContain("CH.");
    });

    it("domain=foundation always renders 'FD.' prefix", () => {
      const html = render(<DomainTag domain="foundation" />);
      expect(html).toContain("FD.");
    });

    it("domain=lab always renders 'LB.' prefix", () => {
      const html = render(<DomainTag domain="lab" />);
      expect(html).toContain("LB.");
    });
  });

  describe("Préfixe présent en mode compact (non supprimable)", () => {
    it("domain=road compact still has CH. prefix", () => {
      const html = render(<DomainTag domain="road" size="compact" />);
      expect(html).toContain("CH.");
    });

    it("domain=foundation compact still has FD. prefix", () => {
      const html = render(<DomainTag domain="foundation" size="compact" />);
      expect(html).toContain("FD.");
    });
  });

  describe("Libellé complet en mode normal", () => {
    it("domain=road normal shows 'Chaussées' label", () => {
      const html = render(<DomainTag domain="road" size="normal" />);
      expect(html).toContain("Chaussées");
    });

    it("domain=foundation normal shows 'Fondations' label", () => {
      const html = render(<DomainTag domain="foundation" size="normal" />);
      expect(html).toContain("Fondations");
    });

    it("domain=lab normal shows 'Laboratoire' label", () => {
      const html = render(<DomainTag domain="lab" size="normal" />);
      expect(html).toContain("Laboratoire");
    });
  });

  describe("Pastille 6px — complément visuel, jamais seule", () => {
    it("domain=road renders a dot alongside the prefix (not alone)", () => {
      const html = render(<DomainTag domain="road" />);
      // La pastille est présente (width 6px) MAIS le préfixe l'est aussi
      expect(html).toContain("CH.");
      expect(html).toContain("6px");
    });
  });

  describe("Couleurs domaine distinctes", () => {
    it("road uses domain-road-bg", () => {
      const html = render(<DomainTag domain="road" />);
      expect(html).toContain("domain-road-bg");
    });

    it("foundation uses domain-found-bg", () => {
      const html = render(<DomainTag domain="foundation" />);
      expect(html).toContain("domain-found-bg");
    });

    it("lab uses domain-lab-bg", () => {
      const html = render(<DomainTag domain="lab" />);
      expect(html).toContain("domain-lab-bg");
    });
  });

  // Régression : la liste des projets passait les CODES data (CH/FD/LB) au lieu des
  // clés sémantiques (road/foundation/lab) → cfg undefined → crash hydratation
  // "Cannot read properties of undefined (reading 'label')".
  describe("Régression — tolérance des codes data + fallback (anti-crash)", () => {
    it("accepte le code data 'CH' et rend 'Chaussées' / 'CH.'", () => {
      const html = render(<DomainTag domain="CH" />);
      expect(html).toContain("Chaussées");
      expect(html).toContain("CH.");
    });

    it("accepte les codes data 'FD' et 'LB'", () => {
      expect(render(<DomainTag domain="FD" />)).toContain("Fondations");
      expect(render(<DomainTag domain="LB" />)).toContain("Laboratoire");
    });

    it("une valeur de domaine inconnue ne crashe jamais (fallback neutre)", () => {
      // @ts-expect-error — valeur volontairement hors type pour prouver le fail-safe
      expect(() => render(<DomainTag domain="INCONNU" />)).not.toThrow();
    });
  });
});
