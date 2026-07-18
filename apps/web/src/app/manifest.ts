import type { MetadataRoute } from 'next';

/**
 * Web App Manifest — installabilité PWA (desktop & mobile).
 *
 * Couleurs alignées sur les tokens de la charte (globals.css) :
 *  - background_color = --surface-canvas (fond de l'app / écran de démarrage)
 *  - theme_color       = --surface-nav (barre de navigation toujours visible,
 *    cf. Topbar/Sidebar). L'app ne suit pas prefers-color-scheme (bascule
 *    clair/sombre = toggle explicite — voir globals.css §2), donc une seule
 *    couleur ici plutôt qu'une paire clair/sombre.
 *
 * Périmètre (ADR/CLAUDE.md) : installabilité + responsive uniquement — PAS de
 * mode hors-ligne complet.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'GEOFAM',
    short_name: 'GEOFAM',
    description:
      'GEOFAM — suite géotechnique : calculs de chaussées et de fondations, essais de sols et in situ, notes et procès-verbaux.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    lang: 'fr',
    background_color: '#f7f6f4',
    theme_color: '#22262b',
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512-maskable.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
