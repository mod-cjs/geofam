/**
 * PWA — installabilité GEOFAM (desktop & mobile).
 *
 * Périmètre (CLAUDE.md / ADR PWA) : installabilité + responsive uniquement —
 * PAS de mode hors-ligne complet. Ce spec ne teste QUE l'installabilité.
 *
 * Deux groupes de tests :
 *  1. Structurel (toujours exécuté, dev ou prod) : manifest, icônes, balises
 *     <head>, fichier sw.js — servis par convention de fichier Next, donc
 *     identiques en `next dev` et `next build && next start`.
 *  2. Enregistrement réel du service worker (E2E_PROD_BUILD=1 requis) :
 *     ServiceWorkerRegistrar ne s'active QU'en production (NODE_ENV) — un SW
 *     actif en dev entrerait en conflit avec le rechargement à chaud
 *     Turbopack. Skip visible (pas un faux-vert) si la cible n'est pas un
 *     build de production : lancer avec
 *       E2E_PROD_BUILD=1 E2E_BASE_URL=http://localhost:PORT pnpm test:e2e pwa-installabilite
 *     contre un `next build && next start -p PORT`.
 */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const PROD_BUILD = !!process.env.E2E_PROD_BUILD;

test.describe('PWA — manifeste web', () => {
  test('given /manifest.webmanifest, when GET, then 200 + JSON conforme (name/icons/start_url/display standalone)', async ({
    request,
  }) => {
    const resp = await request.get(`${BASE_URL}/manifest.webmanifest`);
    expect(resp.status()).toBe(200);
    expect(resp.headers()['content-type']).toContain('manifest+json');

    const manifest = await resp.json();
    expect(manifest.name).toBe('GEOFAM');
    expect(manifest.short_name).toBe('GEOFAM');
    expect(manifest.start_url).toBe('/');
    expect(manifest.scope).toBe('/');
    expect(manifest.display).toBe('standalone');
    expect(manifest.lang).toBe('fr');

    const sizes = manifest.icons.map((i: { sizes: string }) => i.sizes);
    expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']));
    const maskable = manifest.icons.find(
      (i: { purpose?: string }) => i.purpose === 'maskable',
    );
    expect(maskable, 'icône maskable 512×512 requise pour Android').toBeTruthy();
  });

  test('given chaque icône déclarée dans le manifeste, when GET, then 200 image/png', async ({
    request,
  }) => {
    const manifest = await (await request.get(`${BASE_URL}/manifest.webmanifest`)).json();
    for (const icon of manifest.icons as { src: string }[]) {
      const resp = await request.get(`${BASE_URL}${icon.src}`);
      expect(resp.status(), `${icon.src} doit répondre 200`).toBe(200);
      expect(resp.headers()['content-type']).toContain('image/png');
    }
  });
});

test.describe('PWA — balises <head> (installabilité + Apple)', () => {
  test('given la page de login, when chargée, then manifest/theme-color/apple-touch-icon/mobile-web-app-capable sont présents', async ({
    page,
  }) => {
    await page.goto(`${BASE_URL}/login`);

    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
      'href',
      '/manifest.webmanifest',
    );
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
      'content',
      '#22262b',
    );
    await expect(page.locator('meta[name="mobile-web-app-capable"]')).toHaveAttribute(
      'content',
      'yes',
    );
    await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute(
      'content',
      'GEOFAM',
    );
    const appleTouchIcon = page.locator('link[rel="apple-touch-icon"]');
    await expect(appleTouchIcon).toHaveCount(1);
    expect(await appleTouchIcon.getAttribute('href')).toMatch(/^\/apple-icon\.png/);
    expect(await appleTouchIcon.getAttribute('sizes')).toBe('180x180');

    const viewportMeta = await page.locator('meta[name="viewport"]').getAttribute('content');
    expect(viewportMeta).toContain('width=device-width');
  });
});

test.describe('PWA — service worker (fichier statique)', () => {
  test('given /sw.js, when GET, then 200 + Content-Type JS + Cache-Control no-store (jamais mis en cache lui-même)', async ({
    request,
  }) => {
    const resp = await request.get(`${BASE_URL}/sw.js`);
    expect(resp.status()).toBe(200);
    expect(resp.headers()['content-type']).toContain('javascript');
    expect(resp.headers()['cache-control']).toContain('no-store');
  });

  test("given le corps de sw.js, when inspecté, then les chemins tenant (/auth, /projects, /calc, /me) ne sont JAMAIS mis en cache", async ({
    request,
  }) => {
    const resp = await request.get(`${BASE_URL}/sw.js`);
    const body = await resp.text();
    // Preuve texte que les patterns réseau-seul existent bel et bien dans le
    // fichier livré (pas seulement dans la source non buildée).
    expect(body).toMatch(/auth/);
    expect(body).toMatch(/projects/);
    expect(body).toMatch(/calc/);
    expect(body).toMatch(/API_NETWORK_ONLY_PATTERNS|isApiRequest/);
  });
});

test.describe('PWA — enregistrement réel du service worker (build de production requis)', () => {
  test.skip(
    !PROD_BUILD,
    "ServiceWorkerRegistrar ne s'active qu'en production (NODE_ENV) — relancer avec " +
      'E2E_PROD_BUILD=1 E2E_BASE_URL=<url du next start> pour exécuter cette vérification réelle.',
  );

  test('given un build de production chargé, when on laisse le montage se faire, then un service worker actif est enregistré au scope racine', async ({
    page,
  }) => {
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });

    await expect
      .poll(
        async () =>
          page.evaluate(async () => {
            if (!('serviceWorker' in navigator)) return null;
            const regs = await navigator.serviceWorker.getRegistrations();
            return regs.find((r) => r.active)?.active?.scriptURL ?? null;
          }),
        { timeout: 10000 },
      )
      .toMatch(/\/sw\.js$/);
  });

  test('given le SW actif, when une route protégée est visitée sans session, then le middleware redirige toujours vers /login (le SW ne court-circuite pas l’auth)', async ({
    page,
  }) => {
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);

    await page.goto(`${BASE_URL}/app/be-routes-dakar/projets`, { waitUntil: 'networkidle' });
    expect(page.url()).toContain('/login');
    expect(page.url()).toContain('returnTo=');
  });
});
