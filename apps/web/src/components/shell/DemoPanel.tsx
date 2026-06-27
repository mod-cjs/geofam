'use client';

/**
 * DemoPanel — Panneau de contrôle de démo (visible uniquement en mode mock).
 * Permet de basculer entre les scénarios de gating d'abonnement.
 * Position : coin inférieur droit, hors du flux normal.
 */

import { Settings2, X } from 'lucide-react';
import { useState } from 'react';

import type { DemoScenario } from '@/lib/api/mock-data';
import { useDemoScenario } from '@/providers';

const SCENARIOS: { id: DemoScenario; label: string; description: string }[] = [
  {
    id: 'active',
    label: 'Abonnement actif',
    description: 'Pack complet · 363 calculs restants',
  },
  {
    id: 'expired',
    label: 'Abonnement expiré',
    description: 'Lecture seule — calculs bloqués',
  },
  {
    id: 'quota-exhausted',
    label: 'Quota épuisé',
    description: '0 calcul restant · expiré fin 2026',
  },
  {
    id: 'module-locked',
    label: 'Pack ROUTES (limité)',
    description: 'Fondations et labo verrouillés',
  },
];

export function DemoPanel() {
  const [open, setOpen] = useState(false);
  const { scenario, setScenario } = useDemoScenario();
  const current = SCENARIOS.find((s) => s.id === scenario);

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 16,
        right: 16,
        zIndex: 200,
        fontFamily: 'var(--font-sans)',
      }}
    >
      {/* Bouton d'ouverture */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Ouvrir le panneau de démo"
          title="Scénario de démo"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 10px',
            background: 'var(--struct-petrole)',
            color: '#fff',
            border: 'none',
            borderRadius: 'var(--radius-base)',
            cursor: 'pointer',
            fontSize: 'var(--text-xs)',
            fontWeight: 500,
            boxShadow: 'var(--elevation-float)',
          }}
        >
          <Settings2 size={14} strokeWidth={1.5} aria-hidden="true" />
          Démo : {current?.label ?? scenario}
        </button>
      )}

      {/* Panneau ouvert */}
      {open && (
        <div
          role="dialog"
          aria-label="Panneau de démo — scénarios de gating"
          style={{
            background: 'var(--surface-base)',
            borderRadius: 'var(--radius-xl)',
            boxShadow: 'var(--elevation-modal)',
            width: 300,
            overflow: 'hidden',
          }}
        >
          {/* Header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 16px',
              borderBottom: '1px solid var(--border-subtle)',
              background: 'var(--struct-petrole)',
              color: '#fff',
            }}
          >
            <span style={{ fontSize: 'var(--text-sm)', fontWeight: 500 }}>
              Scénarios de démo
            </span>
            <button
              onClick={() => setOpen(false)}
              aria-label="Fermer le panneau de démo"
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: '#fff',
                display: 'flex',
              }}
            >
              <X size={16} strokeWidth={1.5} aria-hidden="true" />
            </button>
          </div>

          {/* Corps */}
          <div style={{ padding: '8px 0' }}>
            <p
              style={{
                fontSize: 'var(--text-xs)',
                color: 'var(--text-muted)',
                padding: '4px 16px 10px',
                lineHeight: 1.5,
              }}
            >
              {
                "Basculer le gating d'abonnement (UI uniquement — le serveur barrerait en prod)."
              }
            </p>
            {SCENARIOS.map((s) => (
              <button
                key={s.id}
                onClick={() => {
                  setScenario(s.id);
                  setOpen(false);
                }}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                  width: '100%',
                  padding: '10px 16px',
                  background: s.id === scenario ? 'var(--state-selected-bg)' : 'none',
                  border: 'none',
                  borderLeft:
                    s.id === scenario
                      ? '3px solid var(--struct-petrole)'
                      : '3px solid transparent',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: `background var(--dur-fast) var(--ease-state)`,
                }}
                onMouseOver={(e) => {
                  if (s.id !== scenario)
                    (e.currentTarget as HTMLElement).style.background =
                      'var(--row-hover-bg)';
                }}
                onMouseOut={(e) => {
                  if (s.id !== scenario)
                    (e.currentTarget as HTMLElement).style.background = 'none';
                }}
              >
                <span
                  style={{
                    fontSize: 'var(--text-sm)',
                    fontWeight: s.id === scenario ? 500 : 400,
                    color: 'var(--text-primary)',
                  }}
                >
                  {s.label}
                </span>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                  {s.description}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
