/**
 * Smoke e2e (Playwright) — harnais minimal.
 *
 * Tant que l app web n expose pas de page stable a tester, on n a pas de cible
 * reseau credible. On s auto-skippe alors PROPREMENT (skip visible) au lieu de
 * faire un faux-vert. Le test reel s active des qu une URL est fournie
 * (E2E_BASE_URL) — typiquement la preprod au merge sur main (job CI `e2e`).
 *
 * A enrichir avec les parcours reels (auth, multi-tenant, generation de PV)
 * au fil des features, en coordination avec dev-frontend.
 */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.E2E_BASE_URL;

test.describe('Smoke', () => {
  test.skip(
    !BASE_URL,
    'E2E_BASE_URL non defini : aucune cible web stable a tester (socle)',
  );

  test('la page d accueil repond', async ({ page }) => {
    const resp = await page.goto('/');
    expect(resp?.ok()).toBeTruthy();
  });
});
