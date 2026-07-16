/**
 * Tests — SubscriptionEditor (modal « Modules ») — pré-remplissage des modules par
 * pack (mission titulaire 14/07 : « le choix d'un pack doit PRÉ-REMPLIR les modules
 * débloqués » — diagnostic « packs pas appliqués », une org affichait COMPLETE
 * avec 1 seul module actif).
 *
 * DoD §9 : given/when/then, chemin heureux + personnalisation + réparation,
 * pas d'écrasement silencieux à l'ouverture, zéro faux-vert.
 * Patron d'interaction : react-dom/client + act (pas de @testing-library/react
 * dans ce dépôt — cf. roadsens-preset-behavior.test.tsx).
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/api/admin-mutations-client', () => ({
  clientAttachSubscription: vi.fn(),
  clientSetEntitlements: vi.fn(),
  clientRenew: vi.fn(),
  clientTopUp: vi.fn(),
}));

import { SubscriptionEditor } from '../SubscriptionEditor';

import type { OrgSubscriptionDetail } from '@/lib/api/admin-server';

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

function render(subscription: OrgSubscriptionDetail | null) {
  root = createRoot(container);
  act(() => {
    root.render(
      <SubscriptionEditor
        orgId="org_01"
        subscription={subscription}
        onMutated={vi.fn()}
      />,
    );
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

function packSelect(): HTMLSelectElement {
  const select = Array.from(container.querySelectorAll('select')).find((s) =>
    Array.from(s.querySelectorAll('option')).some((o) => o.value === 'COMPLETE'),
  );
  if (!select) throw new Error('Select pack introuvable');
  return select;
}

function selectPack(value: string) {
  const select = packSelect();
  act(() => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
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

function moduleCheckbox(slug: string): HTMLInputElement {
  const label = Array.from(container.querySelectorAll('label')).find(
    (l) =>
      l.querySelector('input[type="checkbox"]') &&
      l.textContent?.includes(moduleLabel(slug)),
  );
  if (!label) throw new Error(`Case module introuvable : ${slug}`);
  return label.querySelector('input[type="checkbox"]') as HTMLInputElement;
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

const BASE_SUBSCRIPTION: OrgSubscriptionDetail = {
  pack: 'ROUTES',
  quota: 100,
  consommation: 5,
  remaining: 95,
  dateFin: '2027-01-01T00:00:00.000Z',
  expired: false,
  entitlements: ['burmister'],
};

describe('SubscriptionEditor — modal Modules — pré-remplissage par pack', () => {
  it("given un abonnement cohérent (pack ROUTES, entitlements=[burmister]), when on ouvre la modal Modules, then aucun avertissement ne s'affiche (pas d'écrasement silencieux à l'ouverture)", async () => {
    render(BASE_SUBSCRIPTION);
    await flush();

    clickButtonByText('Modules');
    await flush();

    expect(moduleCheckbox('burmister').checked).toBe(true);
    expect(moduleCheckbox('terzaghi').checked).toBe(false);
    expect(warningText()).toBeNull();
  });

  it("given une souscription incohérente (pack COMPLETE, 1 seul module) — signal de réparation — when on ouvre la modal Modules, then l'avertissement apparaît d'emblée SANS écraser la sélection réelle", async () => {
    render({ ...BASE_SUBSCRIPTION, pack: 'COMPLETE', entitlements: ['burmister'] });
    await flush();

    clickButtonByText('Modules');
    await flush();

    // Pas d'écrasement silencieux : la sélection reflète la vérité serveur (1 module),
    // pas le preset du pack affiché (6 modules).
    expect(moduleCheckbox('burmister').checked).toBe(true);
    expect(moduleCheckbox('terzaghi').checked).toBe(false);
    expect(moduleCheckbox('labo').checked).toBe(false);
    expect(warningText()).toBe(
      'Contenu personnalisé — ne correspond pas au pack COMPLETE standard',
    );
  });

  it('given la modal Modules ouverte, when l’utilisateur change le pack vers FONDATIONS, then la sélection est remplacée par terzaghi+pieux et l’avertissement disparaît', async () => {
    render(BASE_SUBSCRIPTION);
    await flush();

    clickButtonByText('Modules');
    await flush();

    selectPack('FONDATIONS');
    await flush();

    expect(moduleCheckbox('terzaghi').checked).toBe(true);
    expect(moduleCheckbox('pieux').checked).toBe(true);
    expect(moduleCheckbox('burmister').checked).toBe(false);
    expect(moduleCheckbox('radier').checked).toBe(false);
    expect(moduleCheckbox('pressiometre').checked).toBe(false);
    expect(warningText()).toBeNull();
  });

  it('given le pack FONDATIONS appliqué, when l’utilisateur décoche manuellement pieux, then la case reste décochée (édition conservée) et l’avertissement de personnalisation apparaît', async () => {
    render(BASE_SUBSCRIPTION);
    await flush();

    clickButtonByText('Modules');
    await flush();

    selectPack('FONDATIONS');
    await flush();
    toggleModule('pieux');
    await flush();

    expect(moduleCheckbox('terzaghi').checked).toBe(true);
    expect(moduleCheckbox('pieux').checked).toBe(false);
    expect(warningText()).toBe(
      'Contenu personnalisé — ne correspond pas au pack FONDATIONS standard',
    );
  });
});
