'use client';

/**
 * Providers racine de l'application.
 * Wrappent l'arbre React côté client uniquement (Server Components conservés en dehors).
 */

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { ToastProvider } from '@/components/ui/Toast';
import { CommandPaletteProvider } from '@/components/ui/CommandPalette';
import type { DemoScenario } from '@/lib/api/mock-data';
import { setDemoScenario, getActiveScenario } from '@/lib/api/client';

// ---------------------------------------------------------------------------
// DemoContext — panneau de démo pour basculer les scénarios de gating
// ---------------------------------------------------------------------------

interface DemoContextValue {
  scenario: DemoScenario;
  setScenario: (s: DemoScenario) => void;
}

const DemoContext = createContext<DemoContextValue>({
  scenario: 'active',
  setScenario: () => {},
});

export function useDemoScenario() {
  return useContext(DemoContext);
}

// ---------------------------------------------------------------------------
// Providers globaux
// ---------------------------------------------------------------------------

interface ProvidersProps {
  children: ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  const [scenario, setScenarioState] = useState<DemoScenario>(() => {
    if (typeof window === 'undefined') return 'active';
    return getActiveScenario();
  });

  const setScenario = useCallback((s: DemoScenario) => {
    setScenarioState(s);
    setDemoScenario(s);
    // Recharger pour prendre en compte le nouveau scénario
    window.location.reload();
  }, []);

  return (
    <DemoContext.Provider value={{ scenario, setScenario }}>
      <ToastProvider>
        <CommandPaletteProvider>
          {children}
        </CommandPaletteProvider>
      </ToastProvider>
    </DemoContext.Provider>
  );
}
