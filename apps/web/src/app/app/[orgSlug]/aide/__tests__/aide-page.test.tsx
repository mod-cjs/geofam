/**
 * Tests — page Aide & support (item PRODUIT #3).
 *
 * DoD §9 : given/when/then. AidePage est un Server Component statique (pas de
 * données async) — rendu direct via react-dom/client + act, cohérent avec le
 * reste du dépôt (pas de @testing-library/react ici).
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, afterEach, beforeEach } from 'vitest';

import AidePage from '../page';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container.remove();
});

async function renderPage() {
  await act(async () => {
    root = createRoot(container);
    root.render(<AidePage />);
  });
}

describe('AidePage', () => {
  it('given la page rendue, when on cherche le lien WhatsApp, then il pointe vers wa.me avec le message pré-rempli et s’ouvre dans un nouvel onglet', async () => {
    await renderPage();
    const link = container.querySelector('a[href^="https://wa.me/221768745508"]') as HTMLAnchorElement;
    expect(link).not.toBeNull();
    expect(decodeURIComponent(link.getAttribute('href')!)).toContain("Bonjour, j'ai besoin d'aide sur GEOFAM");
    expect(link.target).toBe('_blank');
    expect(link.rel).toContain('noopener');
  });

  it('given la page rendue, when on cherche le lien YouTube, then il pointe vers la chaîne des tutoriels', async () => {
    await renderPage();
    const link = container.querySelector('a[href="https://www.youtube.com/@GEOTECHNIQUE-c7h"]');
    expect(link).not.toBeNull();
  });

  it('given la page rendue, when on cherche le lien e-mail, then c’est un mailto vers direction@geofam.tech', async () => {
    await renderPage();
    const link = container.querySelector('a[href="mailto:direction@geofam.tech"]');
    expect(link).not.toBeNull();
  });

  it('given la page rendue, when on compte les entrées de FAQ, then au moins 6 questions concrètes sont présentes', async () => {
    await renderPage();
    const summaries = container.querySelectorAll('details summary');
    expect(summaries.length).toBeGreaterThanOrEqual(6);
    expect(container.textContent).toMatch(/Comment lancer un calcul/);
    expect(container.textContent).toMatch(/Comment émettre un PV scellé/);
    expect(container.textContent).toMatch(/quota/i);
    expect(container.textContent).toMatch(/PWA|installer/i);
  });

  it('given la page rendue, when on regarde les raccourcis clavier, then ils sont toujours présents', async () => {
    await renderPage();
    expect(container.textContent).toMatch(/⌘K/);
    expect(container.textContent).toMatch(/Émettre un PV/);
  });

  it('given la page rendue, then le hors-ligne est clairement écarté du périmètre (pas de promesse d’offline complet)', async () => {
    await renderPage();
    // La seule affirmation autorisée sur le hors-ligne est la clarification négative.
    expect(container.textContent).toMatch(/pas de mode hors-ligne complet/i);
    expect(container.textContent).not.toMatch(/fonctionne hors[- ]ligne/i);
    expect(container.textContent).not.toMatch(/mode hors-ligne complet (est disponible|inclus)/i);
  });
});
