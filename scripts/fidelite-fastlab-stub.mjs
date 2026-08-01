/**
 * Stub backend MINIMAL pour le spec de FIDÉLITÉ FASTLAB (qa-test).
 *
 * Raison d'être (identique aux stubs terzaghi/pressiopro) : en mode réel
 * (NEXT_PUBLIC_API_BASE_URL posée), le route handler `GET /api/tools/:toolId`
 * (SERVEUR Next) résout l'entitlement du module en appelant
 * `${API_BASE}/me/entitlements` — un appel SERVEUR→SERVEUR que `page.route`
 * (navigateur) ne peut PAS intercepter. Sans backend joignable, le handler
 * renvoie 401 et le clone n'est jamais servi. Ce stub répond donc à ce SEUL
 * besoin serveur (entitlements « actif », modules FASTLAB inclus).
 *
 * Tous les appels CLIENT (getEntitlements, listProjects, runCalc) sont, eux,
 * interceptés par `page.route` dans le spec — le stub n'a pas à les servir.
 * Il refuse d'ailleurs le calcul (405) pour garantir que la sortie comparée
 * vient bien de l'interception, jamais du stub (zéro faux-vert).
 *
 * Port dédié via env STUB_PORT (défaut 3194), distinct du next dev (3106) et des
 * autres pilotes (terzaghi 3199/3101, pressiopro 3196/3104, casagrande 3195/3105).
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.STUB_PORT ?? 3194);

const ENTITLEMENTS = (orgId) => ({
  orgId: orgId ?? 'org_flf',
  pack: 'COMPLETE',
  // FASTLAB : le clone porte TOOL_ID='fastlab' et poste sur l'engineId 'labo' ; le
  // contrat interne du module s'appelle 'labo-classification-gtr'. On accorde les
  // trois libellés + les autres modules pour un stub généreux (aucun impact : le
  // calcul vient de l'interception page.route, pas du stub).
  modules: [
    'fastlab',
    'labo',
    'labo-classification-gtr',
    'terzaghi',
    'fondation-superficielle',
    'burmister',
    'casagrande',
    'geoplaque',
    'pressiometre',
  ],
  expiresAt: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
  expired: false,
  quota: { limit: 1000, used: 1, remaining: 999 },
  serverTime: new Date().toISOString(),
});

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  res.setHeader('Content-Type', 'application/json');

  if (url.pathname === '/health') {
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (url.pathname === '/me/entitlements') {
    const orgId = req.headers['x-org-id'] ?? url.searchParams.get('orgId');
    res.statusCode = 200;
    res.end(JSON.stringify(ENTITLEMENTS(typeof orgId === 'string' ? orgId : undefined)));
    return;
  }
  // Le calcul NE DOIT PAS venir du stub : il est intercepté côté navigateur.
  if (/\/calc\//.test(url.pathname)) {
    res.statusCode = 405;
    res.end(
      JSON.stringify({
        reason: 'STUB_REFUSES_CALC',
        message: 'calc must be intercepted client-side',
      }),
    );
    return;
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ reason: 'NOT_FOUND', path: url.pathname }));
});

server.listen(PORT, '127.0.0.1', () => {
  // eslint-disable-next-line no-console
  console.log(`[fidelite-fastlab-stub] écoute http://127.0.0.1:${PORT}`);
});
