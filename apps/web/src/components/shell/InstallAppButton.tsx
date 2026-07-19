'use client';

/**
 * Bouton d'installation PWA — patron « deferred beforeinstallprompt ».
 *
 * DIA et certains navigateurs Chromium dérivés ne proposent pas l'icône
 * d'installation native dans la barre d'adresse : ce bouton, monté dans le
 * shell authentifié (panneau du lanceur d'aide), donne un point d'entrée
 * explicite quel que soit le navigateur.
 *
 * - `beforeinstallprompt` capturé + `preventDefault()` → prompt différé stocké.
 * - Tant que l'événement n'a pas été reçu, on affiche un repli honnête (lien
 *   « Comment installer ») plutôt qu'un bouton qui ne ferait jamais rien —
 *   Safari iOS, Firefox et DIA ne déclenchent jamais cet événement.
 * - `appinstalled` + détection `display-mode: standalone` masquent le bouton
 *   une fois l'app installée/lancée en PWA.
 *
 * SSR-safe : aucun accès à window/navigator au premier rendu (mêmes valeurs
 * côté serveur et côté client avant hydratation, cf. erreur React #418 déjà
 * documentée dans Sidebar/Topbar).
 */

import { Download, Info } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { Modal } from '@/components/ui/Modal';

/**
 * `BeforeInstallPromptEvent` n'existe pas dans lib.dom (API encore non
 * standardisée) — déclaration locale minimale, pas de `any`.
 */
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  prompt: () => Promise<void>;
}

function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') return false;
  const mql = window.matchMedia?.('(display-mode: standalone)');
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean })
    .standalone;
  return Boolean(mql?.matches) || iosStandalone === true;
}

const linkStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: 0,
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: 'var(--text-secondary)',
  fontSize: 'var(--text-xs)',
  fontWeight: 500,
  textAlign: 'left',
};

export function InstallAppButton() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(
    null,
  );
  const [installed, setInstalled] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    if (isStandaloneDisplay()) setInstalled(true);

    function onBeforeInstallPrompt(e: Event) {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    }
    function onAppInstalled() {
      setInstalled(true);
      setDeferredPrompt(null);
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, []);

  const handleInstall = useCallback(async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    // Que l'utilisateur accepte ou refuse, l'événement différé ne peut être
    // rejoué — on l'efface. `appinstalled` (si accepté) masquera le bouton.
    setDeferredPrompt(null);
  }, [deferredPrompt]);

  if (installed) return null;

  if (deferredPrompt) {
    return (
      <button
        type="button"
        onClick={handleInstall}
        style={{ ...linkStyle, color: 'var(--struct-petrole-text)' }}
      >
        <Download size={14} strokeWidth={1.5} aria-hidden="true" />
        Installer l&rsquo;application
      </button>
    );
  }

  return (
    <>
      <button type="button" onClick={() => setHelpOpen(true)} style={linkStyle}>
        <Info size={14} strokeWidth={1.5} aria-hidden="true" />
        Comment installer l&rsquo;application ?
      </button>

      <Modal
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        title="Installer GEOFAM sur cet appareil"
        size="sm"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <p
            style={{
              fontSize: 'var(--text-sm)',
              color: 'var(--text-secondary)',
              margin: 0,
              lineHeight: 1.6,
            }}
          >
            Certains navigateurs — dont <strong>DIA</strong> — ne proposent pas
            l&rsquo;installation d&rsquo;application web. Pour installer GEOFAM, utilisez
            de préférence <strong>Chrome</strong> ou <strong>Edge</strong>, puis suivez
            les instructions ci-dessous selon votre appareil.
          </p>

          <section>
            <h3
              style={{
                fontSize: 'var(--text-sm)',
                fontWeight: 600,
                color: 'var(--text-primary)',
                margin: '0 0 4px',
              }}
            >
              Ordinateur (Chrome / Edge)
            </h3>
            <p
              style={{
                fontSize: 'var(--text-sm)',
                color: 'var(--text-secondary)',
                margin: 0,
                lineHeight: 1.6,
              }}
            >
              Icône d&rsquo;installation dans la barre d&rsquo;adresse, ou menu du
              navigateur (⋮) → « Installer l&rsquo;application ».
            </p>
          </section>

          <section>
            <h3
              style={{
                fontSize: 'var(--text-sm)',
                fontWeight: 600,
                color: 'var(--text-primary)',
                margin: '0 0 4px',
              }}
            >
              Android (Chrome)
            </h3>
            <p
              style={{
                fontSize: 'var(--text-sm)',
                color: 'var(--text-secondary)',
                margin: 0,
                lineHeight: 1.6,
              }}
            >
              Menu (⋮) → « Ajouter à l&rsquo;écran d&rsquo;accueil ».
            </p>
          </section>

          <section>
            <h3
              style={{
                fontSize: 'var(--text-sm)',
                fontWeight: 600,
                color: 'var(--text-primary)',
                margin: '0 0 4px',
              }}
            >
              iPhone / iPad (Safari)
            </h3>
            <p
              style={{
                fontSize: 'var(--text-sm)',
                color: 'var(--text-secondary)',
                margin: 0,
                lineHeight: 1.6,
              }}
            >
              Bouton Partager → « Sur l&rsquo;écran d&rsquo;accueil ».
            </p>
          </section>
        </div>
      </Modal>
    </>
  );
}

export type { BeforeInstallPromptEvent };
