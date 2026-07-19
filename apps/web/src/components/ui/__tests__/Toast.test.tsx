/**
 * Tests — A-14 Toast / Notification
 *
 * DoD §9 : on teste le VRAI composant (Toast.tsx), pas un double local.
 *  - la map couleur réelle `colorByType` (4 clés, valeurs de référence) ;
 *  - le rendu SSR du vrai `ToastCard` (role / aria-live / message / action) ;
 *  - la constante `MAX_TOASTS` réelle.
 *
 * Esprit mutation : si on change le mapping role/aria-live dans ToastCard,
 * ou une valeur de colorByType, ces tests deviennent ROUGES.
 *
 * Note : les timers auto-dismiss et les animations relèvent de Playwright
 * (pas testables en rendu statique). On ne les simule pas ici.
 */

import { renderToString } from 'react-dom/server';
import { describe, it, expect } from 'vitest';

import {
  ToastCard,
  colorByType,
  MAX_TOASTS,
  type ToastItem,
  type ToastType,
} from '../Toast';

function html(node: React.ReactElement): string {
  return renderToString(node);
}

function makeToast(over: Partial<ToastItem> = {}): ToastItem {
  return {
    id: 't1',
    type: 'success',
    message: 'Calcul terminé avec succès.',
    exiting: false,
    ...over,
  };
}

const noop = () => {};

// ---------------------------------------------------------------------------
// colorByType — la VRAIE map du composant
// ---------------------------------------------------------------------------

describe('colorByType (map couleur réelle)', () => {
  it('given la map, then elle a exactement les 4 types de toast', () => {
    expect(Object.keys(colorByType).sort()).toEqual(
      ['error', 'info', 'success', 'warning'].sort(),
    );
  });

  // Valeurs de référence — figées d'après le DS. Un changement de jeton
  // (ex. succès qui passe sur une autre variable) casse ce test.
  const REFERENCE: Record<ToastType, { icon: string; border: string }> = {
    success: { icon: 'var(--status-pass-tx)', border: 'rgba(47,107,70,0.2)' },
    error: { icon: 'var(--status-fail-tx)', border: 'rgba(139,26,26,0.2)' },
    warning: { icon: '#92550a', border: 'rgba(146,85,10,0.2)' },
    info: { icon: 'var(--struct-petrole-text)', border: 'rgba(31,78,74,0.2)' },
  };

  it.each(Object.keys(REFERENCE) as ToastType[])(
    'given type=%s, then icon et border correspondent aux valeurs de référence',
    (type) => {
      expect(colorByType[type]).toEqual(REFERENCE[type]);
    },
  );

  it('given succès et erreur, then leurs couleurs d icône diffèrent', () => {
    expect(colorByType.success.icon).not.toBe(colorByType.error.icon);
  });
});

// ---------------------------------------------------------------------------
// ToastCard — rendu SSR du VRAI composant
// ---------------------------------------------------------------------------

describe('ToastCard — a11y (rendu réel)', () => {
  it('given un toast type=error, then role=alert et aria-live=assertive', () => {
    const out = html(
      <ToastCard
        toast={makeToast({ type: 'error', message: 'Erreur critique.' })}
        onDismiss={noop}
      />,
    );
    expect(out).toContain('role="alert"');
    expect(out).toContain('aria-live="assertive"');
  });

  it.each(['success', 'warning', 'info'] as ToastType[])(
    'given un toast type=%s, then role=status et aria-live=polite',
    (type) => {
      const out = html(<ToastCard toast={makeToast({ type })} onDismiss={noop} />);
      expect(out).toContain('role="status"');
      expect(out).toContain('aria-live="polite"');
      // Chemin négatif : ce n'est PAS une alerte assertive
      expect(out).not.toContain('aria-live="assertive"');
    },
  );

  it('given n importe quel toast, then aria-atomic=true', () => {
    const out = html(<ToastCard toast={makeToast()} onDismiss={noop} />);
    expect(out).toContain('aria-atomic="true"');
  });

  it('given un message, then le texte du message est rendu dans le HTML', () => {
    const out = html(
      <ToastCard
        toast={makeToast({ message: 'PV émis avec succès.' })}
        onDismiss={noop}
      />,
    );
    expect(out).toContain('PV émis avec succès.');
  });

  it('given un bouton de fermeture, then il porte un aria-label explicite', () => {
    const out = html(<ToastCard toast={makeToast()} onDismiss={noop} />);
    expect(out).toContain('aria-label="Fermer la notification"');
  });
});

describe('ToastCard — action inline (rendu réel)', () => {
  it('given actionLabel + onAction, then le bouton d action est rendu avec son libellé', () => {
    const out = html(
      <ToastCard
        toast={makeToast({ actionLabel: 'Réessayer', onAction: noop })}
        onDismiss={noop}
      />,
    );
    expect(out).toContain('Réessayer');
  });

  it('given pas de actionLabel, then aucun bouton d action (chemin négatif)', () => {
    const out = html(<ToastCard toast={makeToast()} onDismiss={noop} />);
    expect(out).not.toContain('Réessayer');
  });
});

// ---------------------------------------------------------------------------
// Constante MAX_TOASTS — la VRAIE valeur du module
// ---------------------------------------------------------------------------

describe('Stack — MAX_TOASTS (constante réelle)', () => {
  it('given le module Toast, then MAX_TOASTS vaut 3', () => {
    expect(MAX_TOASTS).toBe(3);
  });
});
