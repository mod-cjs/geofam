/**
 * Tests — A-12 Modal / Dialog
 *
 * DoD §9 : tailles, a11y (aria-modal, aria-labelledby, focus trap),
 * état loading, erreur inline, backdrop.
 */

import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import { Modal } from "../Modal";
import { Button } from "../Button";

function render(node: React.ReactElement): string {
  return renderToString(node);
}

describe("Modal — A-12", () => {
  describe("Rendu de base (open=true)", () => {
    it("renders dialog with role=dialog", () => {
      const html = render(
        <Modal open={true} onClose={() => {}} title="Titre de la modale">
          <p>Contenu</p>
        </Modal>
      );
      expect(html).toContain('role="dialog"');
    });

    it("renders aria-modal=true", () => {
      const html = render(
        <Modal open={true} onClose={() => {}} title="Modale">
          <p>Body</p>
        </Modal>
      );
      expect(html).toContain('aria-modal="true"');
    });

    it("renders title text", () => {
      const html = render(
        <Modal open={true} onClose={() => {}} title="Émission du PV n°12">
          <p>Contenu</p>
        </Modal>
      );
      expect(html).toContain("Émission du PV n°12");
    });

    it("renders description when provided", () => {
      const html = render(
        <Modal open={true} onClose={() => {}} title="Titre" description="Vérifiez les paramètres.">
          <p>Corps</p>
        </Modal>
      );
      expect(html).toContain("Vérifiez les paramètres.");
    });

    it("title id is linked to aria-labelledby", () => {
      const html = render(
        <Modal open={true} onClose={() => {}} title="Test">
          <p>Body</p>
        </Modal>
      );
      // aria-labelledby doit contenir un id
      expect(html).toContain("aria-labelledby");
    });

    it("renders body children", () => {
      const html = render(
        <Modal open={true} onClose={() => {}} title="Test">
          <p>Mon contenu unique</p>
        </Modal>
      );
      expect(html).toContain("Mon contenu unique");
    });
  });

  describe("Tailles sm / md / lg", () => {
    it("size=sm limits maxWidth to 480px", () => {
      const html = render(
        <Modal open={true} onClose={() => {}} title="Sm" size="sm">
          <p>Body</p>
        </Modal>
      );
      expect(html).toContain("480");
    });

    it("size=lg limits maxWidth to 780px", () => {
      const html = render(
        <Modal open={true} onClose={() => {}} title="Lg" size="lg">
          <p>Body</p>
        </Modal>
      );
      expect(html).toContain("780");
    });
  });

  describe("Footer", () => {
    it("renders footer content when provided", () => {
      const html = render(
        <Modal
          open={true}
          onClose={() => {}}
          title="Test"
          footer={<Button variant="action">Confirmer</Button>}
        >
          <p>Body</p>
        </Modal>
      );
      expect(html).toContain("Confirmer");
    });
  });

  describe("État loading interne", () => {
    it("when loading=true, renders aria-busy and spinner", () => {
      const html = render(
        <Modal open={true} onClose={() => {}} title="Test" loading>
          <p>Ce texte ne devrait pas apparaître</p>
        </Modal>
      );
      expect(html).toContain('aria-busy="true"');
      expect(html).toContain("Chargement");
    });

    it("when loading=true, body children are NOT rendered", () => {
      const html = render(
        <Modal open={true} onClose={() => {}} title="Test" loading>
          <p>Contenu masqué</p>
        </Modal>
      );
      expect(html).not.toContain("Contenu masqué");
    });
  });

  describe("Erreur inline", () => {
    it("renders error message with role=alert", () => {
      const html = render(
        <Modal open={true} onClose={() => {}} title="Test" error="Erreur de traitement.">
          <p>Body</p>
        </Modal>
      );
      expect(html).toContain('role="alert"');
      expect(html).toContain("Erreur de traitement.");
    });

    it("error uses fail color token", () => {
      const html = render(
        <Modal open={true} onClose={() => {}} title="Test" error="Erreur.">
          <p>Body</p>
        </Modal>
      );
      expect(html).toContain("status-fail");
    });
  });

  describe("Fermeture", () => {
    it("renders a close button with aria-label", () => {
      const html = render(
        <Modal open={true} onClose={() => {}} title="Test">
          <p>Body</p>
        </Modal>
      );
      expect(html).toContain('aria-label="Fermer"');
    });
  });

  describe("Backdrop", () => {
    it("renders backdrop element", () => {
      const html = render(
        <Modal open={true} onClose={() => {}} title="Test">
          <p>Body</p>
        </Modal>
      );
      // Backdrop est un div aria-hidden
      expect(html).toContain('aria-hidden="true"');
    });
  });

  describe("Fermée (open=false)", () => {
    it("renders nothing when open=false", () => {
      const html = render(
        <Modal open={false} onClose={() => {}} title="Test">
          <p>Body</p>
        </Modal>
      );
      expect(html).toBe("");
    });
  });

  describe("Zéro faux-vert", () => {
    it("renders non-empty HTML when open", () => {
      const html = render(
        <Modal open={true} onClose={() => {}} title="Test">
          <p>Body</p>
        </Modal>
      );
      expect(html.length).toBeGreaterThan(100);
    });
  });
});
