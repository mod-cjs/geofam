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
    expect(h1s[0]?.textContent).toContain('recalculés côté serveur');
    expect(h1s[0]?.textContent).toContain('scellés à chaque procès-verbal');
  });

  it('GIVEN la landing WHEN elle est rendue THEN la nav expose les 5 ancres attendues', () => {
    renderHome();
    const nav = container.querySelector('nav[aria-label="Navigation principale"]');
    expect(nav).not.toBeNull();
    const hrefs = Array.from(nav!.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['#logiciels', '#pourquoi', '#tarifs', '#tutoriels', '#contact']);
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

  it('GIVEN la landing WHEN elle est rendue THEN la section Pourquoi liste les 5 différenciateurs sans survente', () => {
    renderHome();
    const section = container.querySelector('#pourquoi');
    expect(section).not.toBeNull();
    const text = section!.textContent ?? '';
    expect(text).toContain('Fidélité aux outils');
    expect(text).toContain('Calcul côté serveur');
    expect(text).toContain('PV scellés');
    expect(text).toContain('Multi-bureaux');
    expect(text).toContain('Installable');
    // Wording juridique — jamais « certifié »/« opposable » (cf. mémoire PV scellé)
    expect(text).not.toMatch(/certifié|opposable/i);
  });

  it('GIVEN la landing WHEN elle est rendue THEN les tarifs affichent un placeholder explicite, jamais un montant inventé', () => {
    renderHome();
    const section = container.querySelector('#tarifs');
    expect(section).not.toBeNull();
    const text = section!.textContent ?? '';
    expect(text).toContain('[à définir] FCFA / mois');
    expect(text).toContain('Sur devis');
    expect(text).toContain('PayTech');
    expect(text).not.toMatch(/\d[\s ]?\d{3}[\s ]?FCFA/); // aucun montant chiffré inventé
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

  it('GIVEN la landing WHEN elle est rendue THEN le CTA « Essai gratuit » pointe vers un e-mail pré-rempli (pas de flux self-service)', () => {
    renderHome();
    const ctas = Array.from(container.querySelectorAll('a')).filter(
      (a) => a.textContent?.trim() === 'Essai gratuit — 24 h' || a.textContent?.trim() === 'Essai gratuit',
    );
    expect(ctas.length).toBeGreaterThan(0);
    for (const cta of ctas) {
      const href = cta.getAttribute('href') ?? '';
      expect(href.startsWith('mailto:direction@geofam.tech?subject=')).toBe(true);
    }
  });

  it('GIVEN la landing WHEN elle est rendue THEN le CTA tutoriels pointe vers la chaîne YouTube en nouvel onglet', () => {
    renderHome();
    const link = Array.from(container.querySelectorAll('a')).find(
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

  it('GIVEN la landing WHEN elle est rendue THEN le footer affiche le copyright et les liens légaux en placeholder explicite', () => {
    renderHome();
    const footer = container.querySelector('footer');
    expect(footer).not.toBeNull();
    expect(footer!.textContent).toContain('© 2026 STARFIRE Technology SAS');
    expect(footer!.textContent).toContain('Sénégal');
    const legalLinks = Array.from(footer!.querySelectorAll('a')).filter(
      (a) => a.textContent?.trim() === 'Mentions légales' || a.textContent?.trim() === 'Confidentialité',
    );
    expect(legalLinks).toHaveLength(2);
    for (const l of legalLinks) {
      expect(l.getAttribute('href')).toBe('#');
    }
  });

  it('GIVEN la landing WHEN elle est rendue THEN le logo GEOFAM porte l’alt d’accessibilité attendu', () => {
    renderHome();
    const img = container.querySelector('img[src*="geofam.jpeg"]');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('alt')).toBe('GEOFAM — géotechnique, logiciels, formation, innovation');
  });
});
