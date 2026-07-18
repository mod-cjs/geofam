/* eslint-env serviceworker, browser */
/**
 * GEOFAM — service worker minimal (installabilité PWA uniquement).
 *
 * Périmètre volontairement restreint (cf. CLAUDE.md / ADR PWA) :
 *  - installabilité desktop & mobile (manifest + SW + icônes) ;
 *  - PAS de mode hors-ligne complet — ne rien promettre au-delà d'un écran
 *    "hors connexion" minimal quand la navigation échoue.
 *
 * Règles de sécurité (non négociables) :
 *  - Aucune requête non-GET n'est interceptée (POST/PUT/PATCH/DELETE passent
 *    nativement — jamais rejouées depuis un cache).
 *  - Aucune réponse d'API tenant n'est mise en cache : tout ce qui matche
 *    API_NETWORK_ONLY_PATTERNS est envoyé au réseau, sans passer par le cache,
 *    qu'il réussisse ou échoue (pas de fallback silencieux sur des données
 *    d'un autre utilisateur/tenant).
 *  - Les navigations (documents HTML) sont toujours réseau-d'abord : jamais de
 *    contenu authentifié servi depuis le cache — le middleware d'auth doit
 *    toujours voir passer la requête réseau.
 */

const CACHE_VERSION = 'geofam-static-v1';

// Chemins d'API jamais mis en cache — réseau uniquement, dans tous les cas.
// Couvre le préfixe /api/ (Route Handlers Next) ainsi que les segments métier
// si l'API backend est un jour appelée sous le même chemin.
const API_NETWORK_ONLY_PATTERNS = [
  /^\/api\//,
  /\/auth(\/|$)/,
  /\/projects(\/|$)/,
  /\/calc(\/|$)/,
  /\/me(\/|$)/,
];

// Assets publics, statiques, non-tenant — seuls candidats au cache.
const PRECACHE_URLS = [
  '/offline.html',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_VERSION)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function isApiRequest(url) {
  return API_NETWORK_ONLY_PATTERNS.some((pattern) => pattern.test(url.pathname));
}

function isStaticAsset(url) {
  return (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname === '/manifest.webmanifest' ||
    url.pathname === '/favicon.ico' ||
    url.pathname === '/icon.jpeg' ||
    url.pathname === '/apple-icon.png'
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Jamais de non-GET intercepté (mutations, actions serveur...).
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Cross-origin (ex. API sur un autre domaine/port) : laisser passer nativement.
  if (url.origin !== self.location.origin) return;

  // Données tenant / auth : réseau uniquement, jamais de cache.
  if (isApiRequest(url)) return;

  // Navigations (documents) : réseau d'abord, jamais de HTML authentifié
  // servi depuis le cache. Fallback hors-ligne minimal si le réseau échoue.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/offline.html')),
    );
    return;
  }

  // Assets statiques publics : cache d'abord, réseau en secours + mise à jour.
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const network = fetch(request)
          .then((response) => {
            if (response.ok) {
              caches.open(CACHE_VERSION).then((cache) => cache.put(request, response.clone()));
            }
            return response;
          })
          .catch(() => cached);
        return cached ?? network;
      }),
    );
    return;
  }

  // Tout le reste : pas d'interception — comportement réseau natif.
});
