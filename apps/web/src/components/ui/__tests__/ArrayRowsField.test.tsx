/**
 * Tests composant — ArrayRowsField (#109).
 *
 * TDD : tests RED avant implémentation.
 *
 * Vérifie :
 *   - Rendu initial (N lignes selon value JSON)
 *   - Ajout d'une ligne : onChange reçoit JSON de longueur N+1
 *   - Suppression d'une ligne : onChange reçoit JSON de longueur N-1
 *   - Respect de minRows : bouton Supprimer désactivé quand rows.length === minRows
 *   - JSON malformé : rendu stable (1 ligne de secours)
 *   - A11y : labels aria présents
 *
 * Note : tests d'interaction via react-dom/client + act (jsdom).
 * Les tests SSR (renderToString) couvrent le rendu statique.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { ArrayRowsField } from '../ArrayRowsField';

import type { FieldDescriptor } from '@/lib/engine-descriptors';

// ── Descripteur de test minimal ────────────────────────────────────────────

const TEST_FIELD: FieldDescriptor = {
  key: 'layers',
  label: 'Couches de sol',
  type: 'array-rows',
  minRows: 1,
  columns: [
    {
      key: 'soil',
      label: 'Nature',
      type: 'select',
      example: 'argile',
      options: [
        { value: 'argile', label: 'Argile' },
        { value: 'sable', label: 'Sable' },
      ],
    },
    {
      key: 'th',
      label: 'Épaisseur',
      type: 'number',
      example: 5,
      unit: 'm',
    },
  ],
};

const ONE_ROW = JSON.stringify([{ soil: 'argile', th: '5' }]);
const TWO_ROWS = JSON.stringify([
  { soil: 'argile', th: '5' },
  { soil: 'sable', th: '7' },
]);

// ── Helpers jsdom ──────────────────────────────────────────────────────────

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

async function renderField(
  value: string,
  onChange: (v: string) => void,
  field: FieldDescriptor = TEST_FIELD,
) {
  await act(async () => {
    root = createRoot(container);
    root.render(<ArrayRowsField field={field} value={value} onChange={onChange} />);
  });
}

// ── Rendu SSR statique ─────────────────────────────────────────────────────

describe('ArrayRowsField — rendu SSR', () => {
  it('given 1 ligne, when renderToString, then contient le label du champ', () => {
    const html = renderToString(
      <ArrayRowsField field={TEST_FIELD} value={ONE_ROW} onChange={() => {}} />,
    );
    expect(html).toContain('Couches de sol');
  });

  it('given 2 lignes, when renderToString, then contient les 2 numéros de ligne', () => {
    const html = renderToString(
      <ArrayRowsField field={TEST_FIELD} value={TWO_ROWS} onChange={() => {}} />,
    );
    // Les deux numéros de ligne (#1 et #2) doivent apparaître
    expect(html).toContain('>1<');
    expect(html).toContain('>2<');
  });

  it('given JSON malformé, when renderToString, then rendu stable (pas de crash)', () => {
    expect(() => {
      renderToString(
        <ArrayRowsField
          field={TEST_FIELD}
          value="NOT_VALID_JSON{{"
          onChange={() => {}}
        />,
      );
    }).not.toThrow();
  });

  it('given 1 ligne, when renderToString, then bouton ajouter présent', () => {
    const html = renderToString(
      <ArrayRowsField field={TEST_FIELD} value={ONE_ROW} onChange={() => {}} />,
    );
    expect(html).toContain('data-testid="array-rows-add"');
  });

  it("given error prop, when renderToString, then message d'erreur présent", () => {
    const html = renderToString(
      <ArrayRowsField
        field={TEST_FIELD}
        value={ONE_ROW}
        onChange={() => {}}
        error="Au moins une couche requise"
      />,
    );
    expect(html).toContain('Au moins une couche requise');
  });

  it('given colonnes, when renderToString, then headers des colonnes présents', () => {
    const html = renderToString(
      <ArrayRowsField field={TEST_FIELD} value={ONE_ROW} onChange={() => {}} />,
    );
    expect(html).toContain('Nature');
    expect(html).toContain('Épaisseur');
  });

  it(
    'given minRows=1 et 1 ligne, ' +
      'when renderToString, then bouton supprimer est désactivé',
    () => {
      const html = renderToString(
        <ArrayRowsField field={TEST_FIELD} value={ONE_ROW} onChange={() => {}} />,
      );
      expect(html).toContain('disabled');
    },
  );
});

// ── Tests interactifs (jsdom + act) ───────────────────────────────────────

describe('ArrayRowsField — interaction add/remove (jsdom)', () => {
  it(
    'given 1 ligne, when clic sur "+ Ajouter une couche", ' +
      'then onChange reçoit JSON de longueur 2',
    async () => {
      let captured = '';
      await renderField(ONE_ROW, (v) => {
        captured = v;
      });

      const addBtn = container.querySelector(
        '[data-testid="array-rows-add"]',
      ) as HTMLButtonElement;
      expect(addBtn).not.toBeNull();

      await act(async () => {
        addBtn.click();
      });

      const parsed = JSON.parse(captured);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(2);
    },
  );

  it(
    'given 2 lignes, when clic sur supprimer ligne 1, ' +
      'then onChange reçoit JSON de longueur 1',
    async () => {
      let captured = '';
      await renderField(TWO_ROWS, (v) => {
        captured = v;
      });

      const removeBtn = container.querySelector(
        '[data-testid="array-rows-remove-0"]',
      ) as HTMLButtonElement;
      expect(removeBtn).not.toBeNull();

      await act(async () => {
        removeBtn.click();
      });

      const parsed = JSON.parse(captured);
      expect(parsed).toHaveLength(1);
    },
  );

  it(
    'given 1 ligne (minRows=1), when clic sur supprimer, ' +
      "then onChange N'est PAS appelé (contrainte minRows)",
    async () => {
      let callCount = 0;
      await renderField(ONE_ROW, () => {
        callCount++;
      });

      const removeBtn = container.querySelector(
        '[data-testid="array-rows-remove-0"]',
      ) as HTMLButtonElement;

      await act(async () => {
        removeBtn.click();
      });

      expect(callCount).toBe(0);
    },
  );

  it(
    'given 3 lignes avec minRows=2, when suppression, ' +
      'then bouton désactivé après être descendu à minRows',
    async () => {
      const fieldMinRows2: FieldDescriptor = { ...TEST_FIELD, minRows: 2 };
      const threeRows = JSON.stringify([
        { soil: 'argile', th: '3' },
        { soil: 'sable', th: '5' },
        { soil: 'marne', th: '7' },
      ]);
      let captured = '';
      await act(async () => {
        root = createRoot(container);
        root.render(
          <ArrayRowsField
            field={fieldMinRows2}
            value={threeRows}
            onChange={(v) => {
              captured = v;
            }}
          />,
        );
      });

      const removeBtn = container.querySelector(
        '[data-testid="array-rows-remove-0"]',
      ) as HTMLButtonElement;
      expect(removeBtn.disabled).toBe(false);

      // Supprimer la couche 1 → 2 couches, passe à minRows → boutons désactivés
      await act(async () => {
        removeBtn.click();
      });
      // Re-render avec la nouvelle valeur
      await act(async () => {
        root.render(
          <ArrayRowsField
            field={fieldMinRows2}
            value={captured}
            onChange={(v) => {
              captured = v;
            }}
          />,
        );
      });

      const btnAfter = container.querySelector(
        '[data-testid="array-rows-remove-0"]',
      ) as HTMLButtonElement;
      expect(btnAfter.disabled).toBe(true);
    },
  );

  it('given JSON malformé, when rendu jsdom, then un bouton ajouter est présent', async () => {
    await renderField('INVALID{', () => {});
    const addBtn = container.querySelector('[data-testid="array-rows-add"]');
    expect(addBtn).not.toBeNull();
  });

  it(
    'given 1 ligne, when ajout de ligne, ' +
      'then les valeurs de la ligne initiale sont préservées dans formValues["layers"]',
    async () => {
      const initial = JSON.stringify([{ soil: 'sable', th: '3' }]);
      let captured = '';
      await renderField(initial, (v) => {
        captured = v;
      });

      const addBtn = container.querySelector(
        '[data-testid="array-rows-add"]',
      ) as HTMLButtonElement;
      await act(async () => {
        addBtn.click();
      });

      const parsed = JSON.parse(captured) as Array<{ soil: string; th: string }>;
      expect(parsed[0].soil).toBe('sable');
      expect(parsed[0].th).toBe('3');
    },
  );
});

// ── A11y ──────────────────────────────────────────────────────────────────

describe('ArrayRowsField — accessibilité', () => {
  it('given 1 ligne, when SSR, then aria-label sur le bouton supprimer', () => {
    const html = renderToString(
      <ArrayRowsField field={TEST_FIELD} value={ONE_ROW} onChange={() => {}} />,
    );
    expect(html).toContain('aria-label="Supprimer la couche 1"');
  });

  it('given error, when SSR, then role=alert présent', () => {
    const html = renderToString(
      <ArrayRowsField
        field={TEST_FIELD}
        value={ONE_ROW}
        onChange={() => {}}
        error="Champ requis"
      />,
    );
    expect(html).toContain('role="alert"');
  });
});
