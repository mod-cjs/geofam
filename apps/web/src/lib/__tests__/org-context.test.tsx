/**
 * Tests — org-context.ts : `useOrgIdReady` / `useOrgId` (bug F5 diagnostiqué).
 *
 * Avant correctif, `useOrgId` renvoyait `null` à la fois pendant la résolution
 * post-montage (mode réel) ET une fois résolu à « pas d'org » — les deux
 * étaient indiscernables pour les appelants. `useOrgIdReady` expose
 * explicitement `ready` pour lever l'ambiguïté.
 *
 * DoD §9 : given/when/then. `useOrgId` reste testé pour prouver la
 * rétro-compatibilité (signature historique inchangée pour les 11 appelants
 * existants — cf. grep useOrgId).
 *
 * Patron d'interaction : `renderToStaticMarkup` capture l'état de PREMIER
 * rendu (aucun effet exécuté — équivalent au rendu serveur / à l'hydratation
 * initiale, cf. patron #418) ; `react-dom/client` + act capture l'état après
 * résolution post-montage (effets flush).
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const ORG_SLUG = 'be-routes-dakar'; // -> org_01 dans MOCK_ORGS

function fakeAccessToken(
  orgs: Array<{ id: string; slug: string; role: string }>,
): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString(
    'base64',
  );
  const payload = Buffer.from(
    JSON.stringify({ sub: 'user_1', typ: 'access', orgs }),
  ).toString('base64');
  return `${header}.${payload}.sig`;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  window.sessionStorage.clear();
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  container.remove();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('useOrgIdReady / useOrgId — mode mock (résolution synchrone)', () => {
  it('given un orgSlug connu de MOCK_ORGS, when le hook est monté, then ready=true immédiatement et orgId résolu (pas de flash possible en mode mock)', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', '');
    vi.resetModules();
    const { useOrgIdReady } = await import('../org-context');

    let captured: { orgId: string | null; ready: boolean } | undefined;
    function Probe() {
      captured = useOrgIdReady(ORG_SLUG);
      return null;
    }
    await act(async () => {
      root = createRoot(container);
      root.render(<Probe />);
    });

    expect(captured).toEqual({ orgId: 'org_01', ready: true });
  });

  it("given un orgSlug inconnu, when le hook est monté, then ready=true et orgId=null (« pas d'org » réel, distinct de « en cours »)", async () => {
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', '');
    vi.resetModules();
    const { useOrgIdReady } = await import('../org-context');

    let captured: { orgId: string | null; ready: boolean } | undefined;
    function Probe() {
      captured = useOrgIdReady('slug-inconnu');
      return null;
    }
    await act(async () => {
      root = createRoot(container);
      root.render(<Probe />);
    });

    expect(captured).toEqual({ orgId: null, ready: true });
  });

  it('given le hook historique useOrgId (rétro-compatibilité), when appelé en mode mock, then renvoie directement l’orgId (comportement inchangé pour les appelants existants)', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', '');
    vi.resetModules();
    const { useOrgId } = await import('../org-context');

    let captured: string | null | undefined;
    function Probe() {
      captured = useOrgId(ORG_SLUG);
      return null;
    }
    await act(async () => {
      root = createRoot(container);
      root.render(<Probe />);
    });

    expect(captured).toBe('org_01');
  });
});

describe('useOrgIdReady — mode réel (résolution post-montage, dépend du token)', () => {
  it('given le mode réel (NEXT_PUBLIC_API_BASE_URL posée), when le composant est rendu AVANT tout effet (rendu serveur / premier rendu client), then ready=false et orgId=null — jamais un flash de mauvais contenu basé sur un orgId prématurément résolu', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'https://api.roadsen.test');
    vi.resetModules();
    const { useOrgIdReady } = await import('../org-context');

    function Probe() {
      const r = useOrgIdReady(ORG_SLUG);
      return <>{JSON.stringify(r)}</>;
    }
    // renderToStaticMarkup n'exécute AUCUN effet -> capture exactement l'état
    // de premier rendu (identique SSR / hydratation initiale, patron #418).
    const html = renderToStaticMarkup(<Probe />);
    // JSX échappe les guillemets en entités HTML (&quot;) — on décode pour
    // comparer au JSON attendu.
    const decoded = html.replace(/&quot;/g, '"');

    expect(decoded).toBe(JSON.stringify({ orgId: null, ready: false }));
  });

  it('given le mode réel avec un token contenant l’org, when la résolution post-montage a eu lieu, then ready=true et orgId correctement dérivé du token', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'https://api.roadsen.test');
    vi.resetModules();
    window.sessionStorage.setItem(
      'roadsen_access_token',
      fakeAccessToken([{ id: 'org_real_1', slug: ORG_SLUG, role: 'OWNER' }]),
    );
    const { useOrgIdReady } = await import('../org-context');

    let captured: { orgId: string | null; ready: boolean } | undefined;
    function Probe() {
      captured = useOrgIdReady(ORG_SLUG);
      return null;
    }
    await act(async () => {
      root = createRoot(container);
      root.render(<Probe />);
    });

    expect(captured).toEqual({ orgId: 'org_real_1', ready: true });
  });

  it('given le mode réel sans token disponible, when la résolution post-montage a eu lieu, then ready=true mais orgId=null (« pas de session » réel — distinct de « en cours », qui aurait ready=false)', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'https://api.roadsen.test');
    vi.resetModules();
    const { useOrgIdReady } = await import('../org-context');

    let captured: { orgId: string | null; ready: boolean } | undefined;
    function Probe() {
      captured = useOrgIdReady(ORG_SLUG);
      return null;
    }
    await act(async () => {
      root = createRoot(container);
      root.render(<Probe />);
    });

    expect(captured).toEqual({ orgId: null, ready: true });
  });
});
