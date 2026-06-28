/**
 * Playwright — configuration e2e ROADSEN.
 *
 * Deux modes :
 *   - E2E_BASE_URL posé (CI/préprod) : pointe vers la cible existante,
 *     pas de webServer local.
 *   - Local sans E2E_BASE_URL : lance l'app web en dev sur localhost:3000.
 *
 * E2E_API_BASE_URL : URL de l'API pour les tests directs endpoint
 *   (défaut : http://localhost:3001).
 */
import { defineConfig, devices } from '@playwright/test';

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? [['html', { open: 'never' }], ['list']] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // Lance l'app Next.js en dev si E2E_BASE_URL n'est pas fourni (tests locaux).
  // En CI, la cible est la préprod déployée — pas de webServer local.
  ...(!process.env.E2E_BASE_URL
    ? {
        webServer: {
          command: 'pnpm --filter @roadsen/web dev',
          url: 'http://localhost:3000',
          reuseExistingServer: true,
          timeout: 60000,
        },
      }
    : {}),
});
