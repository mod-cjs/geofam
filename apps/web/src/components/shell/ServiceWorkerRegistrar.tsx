'use client';

import { useEffect } from 'react';

/**
 * Enregistre le service worker (public/sw.js) — installabilité PWA uniquement
 * (cf. app/manifest.ts). Périmètre : PAS de mode hors-ligne complet, ne rien
 * promettre au-delà de l'existant (CLAUDE.md / ADR PWA).
 *
 * Restrictions volontaires :
 *  - uniquement en production : en dev, un SW actif entre en conflit avec le
 *    rechargement à chaud Turbopack (sert un bundle obsolète depuis le cache).
 *  - amélioration progressive : navigateur sans support, contexte non
 *    sécurisé (HTTP), ou échec de register() → absorbé silencieusement,
 *    l'app fonctionne à l'identique sans SW.
 *  - n'interfère jamais avec le middleware d'auth : le SW lui-même
 *    (public/sw.js) ne met en cache ni les navigations ni les routes
 *    d'API/tenant — voir les commentaires de ce fichier.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      // Best-effort — voir note de périmètre ci-dessus.
    });
  }, []);

  return null;
}
