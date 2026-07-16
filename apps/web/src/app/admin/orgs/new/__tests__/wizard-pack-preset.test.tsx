/**
 * Tests — wizard onboarding /admin/orgs/new — pré-remplissage des modules par pack
 * (mission titulaire 14/07 : « le choix d'un pack doit PRÉ-REMPLIR les modules
 * débloqués » — diagnostic « packs pas appliqués »).
 *
 * DoD §9 : given/when/then, chemin heureux + personnalisation, zéro faux-vert.
 * Patron d'interaction : react-dom/client + act (pas de @testing-library/react
 * dans ce dépôt — cf. roadsens-preset-behavior.test.tsx).
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/lib/api/admin-client', () => ({
  clientSearchUsers: vi.fn(),
  clientCreateUser: vi.fn(),
  clientCreateOrg: vi.fn(),
}));

import NewOrgPage from '../page';

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

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function render() {
  root = createRoot(container);
  act(() => {
    root.render(<NewOrgPage />);
  });
}

function inputByLabel(text: string): HTMLInputElement {
  const label = Array.from(container.querySelectorAll('label')).find(
    (l) => l.textContent?.trim() === text,
  );
  if (!label) throw new Error(`Label introuvable : ${text}`);
  const id = label.getAttribute('for');
  const el = container.querySelector(`#${id}`);
  if (!el) throw new Error(`Champ introuvable pour le label : ${text}`);
  return el as HTMLInputElement;
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  )?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function clickButtonByText(text: string) {
  const btn = Array.from(container.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === text,
  );
  if (!btn) throw new Error(`Bouton introuvable : ${text}`);
  act(() => {
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

/** Navigue jusqu'à l'étape 3 (Abonnement) via le mode « Nouveau compte ». */
async function goToSubscriptionStep() {
  render();
  await flush();

  // Étape 0 — Compte OWNER (création inline, évite de mocker la recherche)
  clickButtonByText('Nouveau compte');
  await flush();
  setInputValue(inputByLabel('Nom complet'), 'Amadou Diallo');
  setInputValue(inputByLabel('Email'), 'amadou@example.com');
  setInputValue(inputByLabel('Mot de passe initial'), 'motdepasse123');
  clickButtonByText('Suivant');
  await flush();

  // Étape 1 — Organisation
  setInputValue(inputByLabel("Nom de l'organisation"), "Bureau d'Études Dakar");
  clickButtonByText('Suivant');
  await flush();
}

function packSelect(): HTMLSelectElement {
  return container.querySelector('#pack') as HTMLSelectElement;
}

function moduleCheckbox(slug: string): HTMLInputElement {
  const label = Array.from(container.querySelectorAll('label')).find(
    (l) =>
      l.querySelector(`input[type="checkbox"]`) &&
      l.textContent?.includes(moduleLabel(slug)),
  );
  if (!label) throw new Error(`Case module introuvable : ${slug}`);
  return label.querySelector('input[type="checkbox"]') as HTMLInputElement;
}

function moduleLabel(slug: string): string {
  const map: Record<string, string> = {
    burmister: 'ROADSENS',
    terzaghi: 'Terzaghi',
    pieux: 'CASAGRANDE',
    radier: 'GEOPLAQUE',
    pressiometre: 'PressioPro',
    labo: 'FASTLAB',
  };
  return map[slug] ?? slug;
}

function selectPack(value: string) {
  const select = packSelect();
  act(() => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function toggleModule(slug: string) {
  const cb = moduleCheckbox(slug);
  act(() => {
    cb.click();
  });
}

function warningText(): string | null {
  return container.querySelector('[role="status"]')?.textContent ?? null;
}

describe('Wizard onboarding — étape 3 (Abonnement) — préremplissage des modules par pack', () => {
  it('given le pack par défaut COMPLETE, when le formulaire arrive à l’étape Abonnement, then les 6 modules sont cochés et aucun avertissement ne s’affiche', async () => {
    await goToSubscriptionStep();

    expect(packSelect().value).toBe('COMPLETE');
    for (const slug of [
      'burmister',
      'terzaghi',
      'pieux',
      'radier',
      'pressiometre',
      'labo',
    ]) {
      expect(moduleCheckbox(slug).checked).toBe(true);
    }
    expect(warningText()).toBeNull();
  });

  it('given l’étape Abonnement affichée, when l’utilisateur choisit le pack ROUTES, then seul burmister reste coché (remplacement) et aucun avertissement ne s’affiche', async () => {
    await goToSubscriptionStep();

    selectPack('ROUTES');
    await flush();

    expect(moduleCheckbox('burmister').checked).toBe(true);
    for (const slug of ['terzaghi', 'pieux', 'radier', 'pressiometre', 'labo']) {
      expect(moduleCheckbox(slug).checked).toBe(false);
    }
    expect(warningText()).toBeNull();
  });

  it('given le pack ROUTES sélectionné, when l’utilisateur coche manuellement un module hors preset, then la case reste cochée et un avertissement de personnalisation s’affiche', async () => {
    await goToSubscriptionStep();

    selectPack('ROUTES');
    await flush();

    toggleModule('terzaghi');
    await flush();

    expect(moduleCheckbox('burmister').checked).toBe(true);
    expect(moduleCheckbox('terzaghi').checked).toBe(true);
    expect(warningText()).toBe(
      'Contenu personnalisé — ne correspond pas au pack ROUTES standard',
    );
  });

  it('given un avertissement affiché après personnalisation, when l’utilisateur change à nouveau de pack, then la sélection est remplacée par le nouveau preset et l’avertissement disparaît', async () => {
    await goToSubscriptionStep();

    selectPack('ROUTES');
    await flush();
    toggleModule('terzaghi');
    await flush();
    expect(warningText()).not.toBeNull();

    selectPack('FONDATIONS');
    await flush();

    expect(moduleCheckbox('terzaghi').checked).toBe(true);
    expect(moduleCheckbox('pieux').checked).toBe(true);
    expect(moduleCheckbox('burmister').checked).toBe(false);
    expect(moduleCheckbox('radier').checked).toBe(false);
    expect(moduleCheckbox('pressiometre').checked).toBe(false);
    expect(warningText()).toBeNull();
  });
});
