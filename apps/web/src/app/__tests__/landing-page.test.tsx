/**
 * Tests — Landing publique GEOFAM (`/`, item mission « landing-support-dashboard »).
 *
 * DoD §9 : given/when/then, chemins clés (rendu, liens de contact) — pas de
 * mock d'API ici, la page est 100% statique (aucun fetch, aucun calcul).
 *
 * NOTE périmètre : la préservation de la redirection d'un visiteur déjà
 * authentifié (middleware.ts, `/` -> `/app/[orgSlug]/projets`) est prouvée
 * dans `src/__tests__/middleware.test.ts` (suite « route racine / »), pas ici
 * — cette page n'est atteinte QUE par un visiteur non authentifié (la
 * décision de routage est entièrement dans le middleware, pas dans page.tsx).
 *
 * Patron d'interaction : react-dom/client + act (pas de @testing-library/react
 * dans ce dépôt — cf. dashboard-page.test.tsx).
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import Home from '../page';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

function renderHome() {
  act(() => {
    root = createRoot(container);
    root.render(<Home />);
  });
}

describe('Landing publique GEOFAM (/) — rendu des sections clés', () => {
  it('GIVEN la landing WHEN elle est rendue THEN un seul <h1> porte le message principal', () => {
    renderHome();
    const h1s = container.querySelectorAll('h1');
    expect(h1s).toHaveLength(1);
    expect(h1s[0]?.textContent).toContain(
      'Les mêmes logiciels de calcul géotechnique et routier que vous utilisez déjà',
    );
    expect(h1s[0]?.textContent).toContain('un PV inaltérable à chaque résultat');
  });

  it('GIVEN la landing WHEN elle est rendue THEN la nav expose les 4 ancres attendues (sans #tutoriels)', () => {
    renderHome();
    const nav = container.querySelector('nav[aria-label="Navigation principale"]');
    expect(nav).not.toBeNull();
    const hrefs = Array.from(nav!.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['#logiciels', '#pourquoi', '#tarifs', '#contact']);
  });

  it('GIVEN la landing WHEN elle est rendue THEN les 6 logiciels du catalogue apparaissent dans #logiciels', () => {
    renderHome();
    const section = container.querySelector('#logiciels');
    expect(section).not.toBeNull();
    const text = section!.textContent ?? '';
    for (const nom of ['ROADSENS', 'Terzaghi', 'CASAGRANDE', 'GEOPLAQUE', 'PressioPro', 'FASTLAB']) {
      expect(text).toContain(nom);
    }
  });

  it('GIVEN la landing WHEN elle est rendue THEN la section Pourquoi liste les 4 différenciateurs sans survente', () => {
    renderHome();
    const section = container.querySelector('#pourquoi');
    expect(section).not.toBeNull();
    const text = section!.textContent ?? '';
    expect(text).toContain('Le même outil, sur le web');
    expect(text).toContain("Un PV qu'on ne peut pas trafiquer");
    expect(text).toContain('Vos données restent les vôtres');
    expect(text).toContain('Installable comme un vrai logiciel');
    const h3s = Array.from(section!.querySelectorAll('h3'));
    expect(h3s).toHaveLength(4);
    // Wording juridique — jamais « certifié »/« opposable » (cf. mémoire PV scellé)
    expect(text).not.toMatch(/certifié|opposable/i);
  });

  it('GIVEN la landing WHEN elle est rendue THEN les tarifs affichent la grille réelle (Mensuel/Annuel/À vie/Bureau multi-postes) et PayTech, sans prix secondaire en euros', () => {
    renderHome();
    const section = container.querySelector('#tarifs');
    expect(section).not.toBeNull();
    const text = section!.textContent ?? '';
    // Grille réelle reprise de geofam.tech (décision titulaire 18/07).
    expect(text).toContain('Mensuel');
    expect(text).toContain('32 800 FCFA / mois');
    expect(text).toContain('Annuel');
    expect(text).toContain('196 800 FCFA / an');
    expect(text).toContain('À vie');
    expect(text).toContain('1 968 000 FCFA');
    // 4e carte — trou tarifaire équipe comblé sans montant inventé.
    expect(text).toContain('Bureau — multi-postes');
    expect(text).toContain('Sur devis');
    expect(text).toContain('PayTech');
    // Plus de placeholder « à définir ».
    expect(text).not.toContain('à définir');
    // Audience Dakar — pense en FCFA, pas de prix secondaire en euros.
    expect(text).not.toMatch(/≈\s*\d/);
    expect(text).not.toContain('€');
    // Descriptions réécrites côté prospect.
    expect(text).toContain(
      'Accès aux 6 logiciels sur un poste. Renouvelé chaque mois ; vous arrêtez quand vous voulez.',
    );
    expect(text).toContain('16 400 FCFA/mois en moyenne');
  });

  it('GIVEN les cartes tarifaires WHEN elles sont rendues THEN Mensuel/Annuel pointent vers WhatsApp (« Demander un essai ») et À vie/Bureau vers #contact (« Nous contacter »)', () => {
    renderHome();
    const section = container.querySelector('#tarifs');
    expect(section).not.toBeNull();
    const ctaLinks = Array.from(section!.querySelectorAll('a')).filter(
      (a) => a.textContent?.trim() === 'Demander un essai' || a.textContent?.trim() === 'Nous contacter',
    );
    expect(ctaLinks).toHaveLength(4);

    const essaiLinks = ctaLinks.filter((a) => a.textContent?.trim() === 'Demander un essai');
    expect(essaiLinks).toHaveLength(2);
    for (const link of essaiLinks) {
      expect(link.getAttribute('href')).toContain('https://wa.me/221768745508');
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toContain('noopener');
    }

    const contactLinks = ctaLinks.filter((a) => a.textContent?.trim() === 'Nous contacter');
    expect(contactLinks).toHaveLength(2);
    for (const link of contactLinks) {
      expect(link.getAttribute('href')).toBe('#contact');
    }
  });

  it('GIVEN la landing WHEN elle est rendue THEN le contact expose WhatsApp et l’e-mail direct', () => {
    renderHome();
    const section = container.querySelector('#contact');
    expect(section).not.toBeNull();
    const links = Array.from(section!.querySelectorAll('a'));
    const whatsapp = links.find((a) => a.getAttribute('href')?.startsWith('https://wa.me/221768745508'));
    const email = links.find((a) => a.getAttribute('href') === 'mailto:direction@geofam.tech');
    expect(whatsapp).toBeDefined();
    expect(email).toBeDefined();
  });

  it('GIVEN la landing WHEN elle est rendue THEN le CTA primaire d’essai (hero + bandeau de clôture) pointe vers WhatsApp, pas un mailto trompeur', () => {
    renderHome();
    const ctas = Array.from(container.querySelectorAll('a')).filter((a) =>
      a.textContent?.trim().startsWith('Demander un essai'),
    );
    // Hero + bandeau de clôture + 2 cartes tarifaires (Mensuel/Annuel) = 4 CTA WhatsApp.
    expect(ctas.length).toBeGreaterThanOrEqual(4);
    for (const cta of ctas) {
      const href = cta.getAttribute('href') ?? '';
      expect(href.startsWith('https://wa.me/221768745508')).toBe(true);
      expect(cta.getAttribute('target')).toBe('_blank');
    }
    // Aucun libellé résiduel trompeur (promesse d'un délai que rien ne tient).
    expect(container.textContent).not.toContain('Essai gratuit — 24 h');
  });

  it('GIVEN le hero WHEN il est rendu THEN un lien secondaire « ou par e-mail » reste disponible (mailto pré-rempli)', () => {
    renderHome();
    const link = Array.from(container.querySelectorAll('a')).find(
      (a) => a.textContent?.trim() === 'ou par e-mail',
    );
    expect(link).toBeDefined();
    expect(link?.getAttribute('href')).toMatch(/^mailto:direction@geofam\.tech\?subject=/);
  });

  it('GIVEN le hero WHEN il est rendu THEN le surtitre nomme la cible (bureaux d’études, Sénégal & Afrique de l’Ouest)', () => {
    renderHome();
    const section = container.querySelector('main')?.querySelector('section');
    expect(section).not.toBeNull();
    expect(section!.textContent).toContain("Pour les bureaux d'études");
    expect(section!.textContent).toContain('Sénégal');
    expect(section!.textContent).toContain("Afrique de l'Ouest");
    // Le mot-remplissage « Innovation » (ancien surtitre générique) a disparu.
    expect(section!.textContent).not.toMatch(/Géotechnique · Logiciels · Formation · Innovation/);
  });

  it('GIVEN la landing WHEN elle est rendue THEN les sections principales suivent l’ordre orienté prospect (logiciels juste après le hero, tarifs avant contact)', () => {
    renderHome();
    const main = container.querySelector('main');
    expect(main).not.toBeNull();
    const sections = Array.from(main!.querySelectorAll(':scope > section'));
    const ids = sections.map((s) => s.getAttribute('id'));
    // Hero (sans id) en premier, « Les 6 logiciels » juste après (répond en 5 s
    // « est-ce que ça couvre mon métier »), tarifs avant contact, clôture en fin.
    expect(ids[0]).toBeNull();
    expect(ids[1]).toBe('logiciels');
    expect(ids).toContain('pourquoi');
    expect(ids).toContain('tarifs');
    expect(ids).toContain('contact');
    expect(ids[ids.length - 1]).toBeNull(); // bandeau de clôture, sans id

    const logicielsIndex = ids.indexOf('logiciels');
    const pourquoiIndex = ids.indexOf('pourquoi');
    const tarifsIndex = ids.indexOf('tarifs');
    const contactIndex = ids.indexOf('contact');
    expect(logicielsIndex).toBeLessThan(pourquoiIndex);
    expect(pourquoiIndex).toBeLessThan(tarifsIndex);
    expect(tarifsIndex).toBeLessThan(contactIndex);

    // « Comment ça marche » se situe entre les logiciels et Pourquoi GEOFAM.
    const commentIndex = sections.findIndex((s) => s.textContent?.includes('Comment ça marche'));
    expect(commentIndex).toBeGreaterThan(logicielsIndex);
    expect(commentIndex).toBeLessThan(pourquoiIndex);
  });

  it('GIVEN la landing WHEN elle est rendue THEN un bloc de réassurance nomme l’éditeur et l’expert métier, sans chiffre inventé', () => {
    renderHome();
    expect(container.textContent).toContain(
      'Édité par STARFIRE Technology — moteurs de calcul conçus et validés par un ingénieur expert en géotechnique.',
    );
  });

  it('GIVEN la landing WHEN elle est rendue THEN le lien tutoriels vidéo est un lien discret dans la section Contact (pas de section #tutoriels autonome)', () => {
    renderHome();
    expect(container.querySelector('#tutoriels')).toBeNull();
    const contactSection = container.querySelector('#contact');
    expect(contactSection).not.toBeNull();
    const link = Array.from(contactSection!.querySelectorAll('a')).find(
      (a) => a.getAttribute('href') === 'https://www.youtube.com/@GEOTECHNIQUE-c7h',
    );
    expect(link).toBeDefined();
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toContain('noopener');
  });

  it('GIVEN la landing WHEN elle est rendue THEN le lien « Se connecter » pointe vers /login', () => {
    renderHome();
    const link = Array.from(container.querySelectorAll('a')).find(
      (a) => a.textContent?.trim() === 'Se connecter',
    );
    expect(link?.getAttribute('href')).toBe('/login');
  });

  it('GIVEN la landing WHEN elle est rendue THEN le footer affiche le copyright et masque les liens légaux non rédigés (pas de lien mort href="#")', () => {
    renderHome();
    const footer = container.querySelector('footer');
    expect(footer).not.toBeNull();
    expect(footer!.textContent).toContain('© 2026 STARFIRE Technology SAS');
    expect(footer!.textContent).toContain('Sénégal');
    // Les pages Mentions légales / Confidentialité ne sont pas rédigées :
    // masquées plutôt que laissées en lien mort href="#" (revue adverse 17/07).
    const legalLinks = Array.from(footer!.querySelectorAll('a')).filter(
      (a) => a.textContent?.trim() === 'Mentions légales' || a.textContent?.trim() === 'Confidentialité',
    );
    expect(legalLinks).toHaveLength(0);
    // Les autres liens footer restent réels et cliquables.
    const productLinks = Array.from(footer!.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(productLinks).toContain('#tarifs');
    expect(productLinks).toContain('#logiciels');
  });

  it('GIVEN la landing WHEN elle est rendue THEN le logo GEOFAM porte l’alt d’accessibilité attendu', () => {
    renderHome();
    const img = container.querySelector('img[src*="geofam.jpeg"]');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('alt')).toBe('GEOFAM — géotechnique, logiciels, formation, innovation');
  });
});
