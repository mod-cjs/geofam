/**
 * Tests — ToolFrame (hôte React du bridge iframe, ADR 0015).
 *
 * DoD §9 : given/when/then, chemins négatifs testés (erreurs 402/403, source
 * non reconnue, message malformé), zéro faux-vert.
 *
 * Patron d'interaction : react-dom/client + act (pas de @testing-library/react
 * dans ce dépôt — cf. PvEmittedActions.test.tsx).
 *
 * La fixture `__fixtures__/fake-tool.html` documente le protocole côté "outil"
 * (référence pour un futur test Playwright réel, cf. rapport de mission) ;
 * ici, jsdom n'exécutant pas les scripts d'un iframe `srcdoc`, on SIMULE le
 * comportement de l'outil en dispatchant des `MessageEvent` synthétiques dont
 * `source` pointe vers `iframe.contentWindow` — exactement ce que ToolFrame
 * valide en réception (event.source, jamais event.origin — origine opaque).
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockRunCalc, mockEmitPv, mockSaveCalcSnapshot } = vi.hoisted(() => ({
  mockRunCalc: vi.fn(),
  mockEmitPv: vi.fn(),
  mockSaveCalcSnapshot: vi.fn(),
}));

vi.mock('@/lib/api/client', () => ({
  runCalc: mockRunCalc,
  emitPv: mockEmitPv,
  saveCalcSnapshot: mockSaveCalcSnapshot,
}));

import { ToolFrame, SNAPSHOT_WATCHDOG_MS } from '../ToolFrame';
import { toolStoreKey } from '../protocol';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  mockRunCalc.mockReset();
  mockEmitPv.mockReset();
  mockSaveCalcSnapshot.mockReset();
  mockSaveCalcSnapshot.mockResolvedValue(undefined);
  localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => '<!doctype html><html><body>fixture</body></html>',
    })),
  );
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container.remove();
  vi.unstubAllGlobals();
});

interface RenderOpts {
  onCalcResultId?: (id: string | null) => void;
  onSnapshotStatus?: (event: { calcResultId: string; status: string }) => void;
  onPvEmitted?: (pv: unknown) => void;
  toolId?: string;
  engineId?: string;
  engineAllowlist?: string[];
  /** Défaut 'proj_01' — passer `null` simule l'outil ouvert SANS projet sélectionné. */
  projectId?: string | null;
}

async function renderFrame(opts: RenderOpts = {}) {
  await act(async () => {
    root = createRoot(container);
    root.render(
      <ToolFrame
        toolId={opts.toolId ?? 'terzaghi'}
        engineId={opts.engineId ?? 'terzaghi'}
        engineAllowlist={opts.engineAllowlist}
        orgId="org_01"
        orgSlug="be-routes-dakar"
        projectId={opts.projectId === undefined ? 'proj_01' : opts.projectId}
        projectLabel="Fondation A12"
        accessToken="token-abc"
        onCalcResultId={opts.onCalcResultId}
        onSnapshotStatus={opts.onSnapshotStatus}
        onPvEmitted={opts.onPvEmitted}
      />,
    );
  });
  // Laisse le fetch (microtâche) et le useEffect de chargement se résoudre.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function getIframe(): HTMLIFrameElement {
  const el = container.querySelector('[data-testid="tool-frame-iframe"]');
  expect(el).not.toBeNull();
  return el as HTMLIFrameElement;
}

/** Simule un message ENVOYÉ PAR l'iframe (source = son contentWindow). */
async function sendFromIframe(iframe: HTMLIFrameElement, data: unknown) {
  await act(async () => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data,
        source: iframe.contentWindow as unknown as Window,
      }),
    );
    await Promise.resolve();
  });
}

describe('ToolFrame — chargement du clone', () => {
  it('given orgId présent, when montage, then fetch /api/tools/:toolId avec Authorization + orgId en query', async () => {
    await renderFrame();
    expect(fetch).toHaveBeenCalledWith(
      '/api/tools/terzaghi?orgId=org_01',
      expect.objectContaining({ headers: { Authorization: 'Bearer token-abc' } }),
    );
    expect(getIframe()).toBeTruthy();
  });

  it("given le route handler répond 403, when montage, then un message d'erreur explicite est affiché (pas de crash)", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 403, text: async () => '' })),
    );
    await renderFrame();
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/pas inclus/i);
    expect(container.querySelector('[data-testid="tool-frame-iframe"]')).toBeNull();
  });
});

describe('ToolFrame — handshake ready→init', () => {
  it("given ready reçu depuis l'iframe, when traité, then init est renvoyé (SANS token) avec le contexte projet", async () => {
    await renderFrame();
    const iframe = getIframe();
    const postSpy = vi.spyOn(iframe.contentWindow as Window, 'postMessage');

    await sendFromIframe(iframe, {
      v: 1,
      type: 'ready',
      payload: { toolId: 'terzaghi' },
    });

    expect(postSpy).toHaveBeenCalledTimes(1);
    const [sent, targetOrigin] = postSpy.mock.calls[0];
    expect(targetOrigin).toBe('*');
    expect(sent).toEqual({
      v: 1,
      type: 'init',
      payload: {
        engineId: 'terzaghi',
        orgSlug: 'be-routes-dakar',
        projectLabel: 'Fondation A12',
        readOnly: undefined,
      },
    });
    // Aucun champ token/JWT/Authorization ne doit apparaître dans le message envoyé à l'iframe.
    expect(JSON.stringify(sent)).not.toMatch(/token|jwt|authorization/i);
  });
});

describe('ToolFrame — calc:request → calc:response', () => {
  it('given runCalc résout, when calc:request reçu, then calc:response ok avec calcResultId+output et callback onCalcResultId', async () => {
    mockRunCalc.mockResolvedValue({
      id: 'calc_42',
      engineId: 'terzaghi',
      domain: 'FD',
      status: 'DONE',
      output: { verdict: 'PASS', rows: [] },
    });
    const onCalcResultId = vi.fn();
    await renderFrame({ onCalcResultId });
    const iframe = getIframe();
    const postSpy = vi.spyOn(iframe.contentWindow as Window, 'postMessage');

    await sendFromIframe(iframe, {
      v: 1,
      type: 'calc:request',
      id: 'req_1',
      payload: { engineId: 'terzaghi', label: 'Calcul test', params: { B: '2' } },
    });

    expect(mockRunCalc).toHaveBeenCalledWith('org_01', 'proj_01', {
      engineId: 'terzaghi',
      label: 'Calcul test',
      params: { B: '2' },
    });
    expect(onCalcResultId).toHaveBeenCalledWith('calc_42');
    expect(postSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        v: 1,
        type: 'calc:response',
        id: 'req_1',
        payload: expect.objectContaining({ ok: true, calcResultId: 'calc_42' }),
      }),
      '*',
    );
  });

  // Régression BLOQUANTE (ADR 0015 §4) : le clone (mapOutputToR) lit la sortie
  // serveur BRUTE (`output.cas` / `capaciteReference` / `contraintesBase`). Si l'hôte
  // poste la forme NORMALISÉE (`{verdict, rows}`), `output.cas` est absent → le clone
  // rend « Renseignez au moins Fz… » et 0 carte. ToolFrame DOIT poster `rawOutput`
  // (whitelist serveur brute), pas la forme normalisée.
  it('given un CalcResult réel {rawOutput:{cas…}, output:{verdict,rows}}, when calc:request, then calc:response.output porte la sortie BRUTE (cas), pas la normalisée', async () => {
    const rawOutput = {
      erreur: null,
      warnings: [],
      contraintesBase: { u: 0, q0: 90, sv0: 90 },
      capaciteReference: { ok: true, A: 60, R0: 5400, states: [] },
      cas: [
        {
          idx: 0,
          etat: 'ELS_QP',
          invalide: false,
          qref: 204,
          taux: 0.28,
          portanceOk: true,
        },
      ],
    };
    mockRunCalc.mockResolvedValue({
      id: 'calc_terz',
      engineId: 'fondation-superficielle',
      domain: 'FD',
      status: 'DONE',
      // Forme normalisée (ce que la page roadsens lit) — NE doit PAS partir au clone.
      output: { verdict: 'PASS', rows: [{ label: 'x', value: 1, unit: '' }] },
      // Sortie serveur whitelistée brute (ce que le clone consomme).
      rawOutput,
    });
    await renderFrame();
    const iframe = getIframe();
    const postSpy = vi.spyOn(iframe.contentWindow as Window, 'postMessage');

    await sendFromIframe(iframe, {
      v: 1,
      type: 'calc:request',
      id: 'req_raw',
      payload: { engineId: 'fondation-superficielle', label: 'T', params: {} },
    });

    const call = postSpy.mock.calls.find(
      (c) => (c[0] as { id?: string }).id === 'req_raw',
    );
    expect(call, 'calc:response non émis').toBeTruthy();
    const payload = (call?.[0] as { payload: { output?: Record<string, unknown> } })
      .payload;
    // Le clone reçoit la structure BRUTE (cas présent), jamais la normalisée (verdict/rows).
    expect(
      Array.isArray(payload.output?.cas),
      'output.cas absent → clone rend 0 carte',
    ).toBe(true);
    expect(payload.output?.capaciteReference, 'capaciteReference absente').toBeTruthy();
    expect(payload.output?.contraintesBase, 'contraintesBase absente').toBeTruthy();
    expect(
      payload.output?.verdict,
      'la forme NORMALISÉE a fuité au clone',
    ).toBeUndefined();
    // Frontière de confiance : l'engineId facturable est celui de l'HÔTE (slug
    // 'terzaghi' attendu par l'API tenant/le gate), jamais celui déclaré par
    // l'iframe ('fondation-superficielle' → 403 MODULE_NOT_IN_PACK en réel).
    expect(mockRunCalc).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ engineId: 'terzaghi' }),
    );
  });

  it('given un CalcResult sans rawOutput (mock/legacy), when calc:request, then calc:response.output retombe sur output normalisé', async () => {
    mockRunCalc.mockResolvedValue({
      id: 'calc_legacy',
      engineId: 'terzaghi',
      domain: 'FD',
      status: 'DONE',
      output: { verdict: 'PASS', rows: [] },
    });
    await renderFrame();
    const iframe = getIframe();
    const postSpy = vi.spyOn(iframe.contentWindow as Window, 'postMessage');

    await sendFromIframe(iframe, {
      v: 1,
      type: 'calc:request',
      id: 'req_legacy',
      payload: { engineId: 'terzaghi', label: 'T', params: {} },
    });

    const call = postSpy.mock.calls.find(
      (c) => (c[0] as { id?: string }).id === 'req_legacy',
    );
    expect(
      (call?.[0] as { payload: { output?: Record<string, unknown> } }).payload.output,
    ).toEqual({
      verdict: 'PASS',
      rows: [],
    });
  });

  it('given runCalc rejette avec 402 EXPIRED, when calc:request reçu, then calc:response transmet ok:false + error', async () => {
    mockRunCalc.mockRejectedValue({
      statusCode: 402,
      reason: 'EXPIRED',
      message: 'Abonnement expiré',
    });
    await renderFrame();
    const iframe = getIframe();
    const postSpy = vi.spyOn(iframe.contentWindow as Window, 'postMessage');

    await sendFromIframe(iframe, {
      v: 1,
      type: 'calc:request',
      id: 'req_2',
      payload: { engineId: 'terzaghi', label: 'Calcul', params: {} },
    });

    expect(postSpy).toHaveBeenCalledWith(
      {
        v: 1,
        type: 'calc:response',
        id: 'req_2',
        payload: {
          ok: false,
          error: { statusCode: 402, reason: 'EXPIRED', message: 'Abonnement expiré' },
        },
      },
      '*',
    );
  });

  it("given runCalc rejette avec 403 MODULE_NOT_IN_PACK, then l'erreur transite telle quelle", async () => {
    mockRunCalc.mockRejectedValue({
      statusCode: 403,
      reason: 'MODULE_NOT_IN_PACK',
      message: 'Module non inclus dans votre abonnement',
    });
    await renderFrame();
    const iframe = getIframe();
    const postSpy = vi.spyOn(iframe.contentWindow as Window, 'postMessage');

    await sendFromIframe(iframe, {
      v: 1,
      type: 'calc:request',
      id: 'req_3',
      payload: { engineId: 'terzaghi', label: 'Calcul', params: {} },
    });

    const call = postSpy.mock.calls.find((c) => (c[0] as { id?: string }).id === 'req_3');
    expect(call?.[0]).toMatchObject({
      payload: { ok: false, error: { statusCode: 403, reason: 'MODULE_NOT_IN_PACK' } },
    });
  });
});

// Correction UX/fidélité (17/07) : l'outil s'affiche désormais AVANT toute
// sélection de projet (le placeholder du shell a disparu, cf. les 5 pages
// logiciels) — `projectId` devient donc `null` tant qu'aucun projet n'est
// choisi. Le calcul et l'émission de PV, eux, restent bloqués : c'est
// `ToolFrame` qui porte cette frontière (le clone ne le sait pas).
describe('ToolFrame — aucun projet sélectionné (projectId=null)', () => {
  it('given projectId=null, when calc:request reçu, then calc:response.error invite explicitement à sélectionner un projet dans le bandeau', async () => {
    await renderFrame({ projectId: null });
    const iframe = getIframe();
    const postSpy = vi.spyOn(iframe.contentWindow as Window, 'postMessage');

    await sendFromIframe(iframe, {
      v: 1,
      type: 'calc:request',
      id: 'req_no_project',
      payload: { engineId: 'terzaghi', label: 'Calcul', params: {} },
    });

    expect(mockRunCalc).not.toHaveBeenCalled();
    const call = postSpy.mock.calls.find(
      (c) => (c[0] as { id?: string }).id === 'req_no_project',
    );
    expect(call?.[0]).toMatchObject({
      payload: {
        ok: false,
        error: {
          message:
            "Sélectionnez un projet (bandeau au-dessus de l'outil) avant de lancer le calcul.",
        },
      },
    });
  });

  it("given projectId=null, when pv:request reçu, then un message d'erreur de protocole invite à sélectionner un projet (aucun appel à emitPv)", async () => {
    await renderFrame({ projectId: null });
    const iframe = getIframe();
    const postSpy = vi.spyOn(iframe.contentWindow as Window, 'postMessage');

    await sendFromIframe(iframe, {
      v: 1,
      type: 'pv:request',
      payload: { calcResultId: 'calc_42' },
    });

    expect(mockEmitPv).not.toHaveBeenCalled();
    expect(postSpy).toHaveBeenCalledWith(
      {
        v: 1,
        type: 'error',
        payload: {
          message:
            "Sélectionnez un projet (bandeau au-dessus de l'outil) avant d'émettre le PV.",
        },
      },
      '*',
    );
  });
});

describe('ToolFrame — engineAllowlist (multi-engine, GEOPLAQUE)', () => {
  const GEOPLAQUE_MODES = ['radier', 'plane-strain', 'axi', 'tri-raft'];

  it.each(GEOPLAQUE_MODES)(
    'given engineAllowlist des 4 modes GEOPLAQUE, when calc:request.engineId=%s, then runCalc est appelé avec cet engineId TEL QUEL',
    async (mode) => {
      mockRunCalc.mockResolvedValue({
        id: `calc_${mode}`,
        engineId: mode,
        domain: 'FD',
        status: 'DONE',
        output: {},
      });
      await renderFrame({
        toolId: 'geoplaque',
        engineId: 'radier',
        engineAllowlist: GEOPLAQUE_MODES,
      });
      const iframe = getIframe();
      const postSpy = vi.spyOn(iframe.contentWindow as Window, 'postMessage');

      await sendFromIframe(iframe, {
        v: 1,
        type: 'calc:request',
        id: `req_${mode}`,
        payload: { engineId: mode, label: 'Calcul', params: {} },
      });

      expect(mockRunCalc).toHaveBeenCalledWith(
        'org_01',
        'proj_01',
        expect.objectContaining({ engineId: mode }),
      );
      const call = postSpy.mock.calls.find(
        (c) => (c[0] as { id?: string }).id === `req_${mode}`,
      );
      expect(call?.[0]).toMatchObject({ payload: { ok: true } });
    },
  );

  it('given engineAllowlist des 4 modes GEOPLAQUE, when calc:request.engineId est un slug inconnu, then rejeté sans appeler runCalc', async () => {
    await renderFrame({
      toolId: 'geoplaque',
      engineId: 'radier',
      engineAllowlist: GEOPLAQUE_MODES,
    });
    const iframe = getIframe();
    const postSpy = vi.spyOn(iframe.contentWindow as Window, 'postMessage');

    await sendFromIframe(iframe, {
      v: 1,
      type: 'calc:request',
      id: 'req_unknown',
      payload: { engineId: 'mode-inconnu', label: 'Calcul', params: {} },
    });

    expect(mockRunCalc).not.toHaveBeenCalled();
    expect(postSpy).toHaveBeenCalledWith(
      {
        v: 1,
        type: 'calc:response',
        id: 'req_unknown',
        payload: {
          ok: false,
          error: {
            statusCode: 400,
            reason: 'ENGINE_NOT_ALLOWED',
            message: expect.stringMatching(/mode-inconnu/),
          },
        },
      },
      '*',
    );
  });

  it("given engineAllowlist des 4 modes GEOPLAQUE, when calc:request.engineId='chaussee-burmister' (moteur réel mais hors liste), then rejeté sans appeler runCalc", async () => {
    await renderFrame({
      toolId: 'geoplaque',
      engineId: 'radier',
      engineAllowlist: GEOPLAQUE_MODES,
    });
    const iframe = getIframe();
    const postSpy = vi.spyOn(iframe.contentWindow as Window, 'postMessage');

    await sendFromIframe(iframe, {
      v: 1,
      type: 'calc:request',
      id: 'req_burmister',
      payload: { engineId: 'chaussee-burmister', label: 'Calcul', params: {} },
    });

    expect(mockRunCalc).not.toHaveBeenCalled();
    const call = postSpy.mock.calls.find(
      (c) => (c[0] as { id?: string }).id === 'req_burmister',
    );
    expect(call?.[0]).toMatchObject({
      payload: { ok: false, error: { statusCode: 400, reason: 'ENGINE_NOT_ALLOWED' } },
    });
  });

  it("given AUCUN engineAllowlist (terzaghi/roadsens, rétrocompatibilité), when calc:request déclare un engineId différent, then l'engineId de l'HÔTE prime (comportement historique inchangé)", async () => {
    mockRunCalc.mockResolvedValue({
      id: 'calc_1',
      engineId: 'terzaghi',
      domain: 'FD',
      status: 'DONE',
      output: {},
    });
    await renderFrame(); // pas d'engineAllowlist — patron terzaghi
    const iframe = getIframe();

    await sendFromIframe(iframe, {
      v: 1,
      type: 'calc:request',
      id: 'req_legacy',
      payload: { engineId: 'fondation-superficielle', label: 'Calcul', params: {} },
    });

    expect(mockRunCalc).toHaveBeenCalledWith(
      'org_01',
      'proj_01',
      expect.objectContaining({ engineId: 'terzaghi' }),
    );
  });
});

describe('ToolFrame — calc:request résolues DANS LE DÉSORDRE (BQ-2, audit adverse #9)', () => {
  it('given deux calc:request rapprochées dont la PLUS ANCIENNE résout APRÈS la plus récente, when les deux résolvent, then seule la réponse la PLUS RÉCENTE est remontée au shell et renvoyée au clone (la périmée est ignorée)', async () => {
    let resolveOld!: (v: unknown) => void;
    let resolveNew!: (v: unknown) => void;
    const oldPromise = new Promise((res) => {
      resolveOld = res;
    });
    const newPromise = new Promise((res) => {
      resolveNew = res;
    });
    mockRunCalc.mockImplementationOnce(() => oldPromise);
    mockRunCalc.mockImplementationOnce(() => newPromise);

    const onCalcResultId = vi.fn();
    await renderFrame({ onCalcResultId });
    const iframe = getIframe();
    const postSpy = vi.spyOn(iframe.contentWindow as Window, 'postMessage');

    await sendFromIframe(iframe, {
      v: 1,
      type: 'calc:request',
      id: 'req_old',
      payload: { engineId: 'terzaghi', label: 'Ancien', params: {} },
    });
    await sendFromIframe(iframe, {
      v: 1,
      type: 'calc:request',
      id: 'req_new',
      payload: { engineId: 'terzaghi', label: 'Nouveau', params: {} },
    });

    // Résolution HORS ORDRE : la requête la plus RÉCENTE (req_new) finit
    // D'ABORD, l'ANCIENNE (req_old) finit ensuite — exactement le scénario
    // d'une rafale débouncée (fastlab/pressio) ou de clics rapides.
    await act(async () => {
      resolveNew({
        id: 'calc_new',
        engineId: 'terzaghi',
        domain: 'FD',
        status: 'DONE',
        output: {},
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      resolveOld({
        id: 'calc_old',
        engineId: 'terzaghi',
        domain: 'FD',
        status: 'DONE',
        output: {},
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    // Le shell ne doit JAMAIS se retrouver sur le calcResultId de la requête
    // périmée, même si sa promesse résout en dernier.
    expect(onCalcResultId).toHaveBeenCalledTimes(1);
    expect(onCalcResultId).toHaveBeenCalledWith('calc_new');
    expect(onCalcResultId).not.toHaveBeenCalledWith('calc_old');

    const staleResponse = postSpy.mock.calls.find(
      (c) => (c[0] as { id?: string }).id === 'req_old',
    );
    expect(
      staleResponse,
      'la réponse PÉRIMÉE ne doit jamais être renvoyée au clone (il ne doit pas non plus ré-afficher un résultat obsolète)',
    ).toBeUndefined();

    const freshResponse = postSpy.mock.calls.find(
      (c) => (c[0] as { id?: string }).id === 'req_new',
    );
    expect(freshResponse).toBeTruthy();
    expect(
      (freshResponse?.[0] as { payload: { ok: boolean; calcResultId?: string } }).payload,
    ).toMatchObject({ ok: true, calcResultId: 'calc_new' });
  });

  it("given une requête PLUS RÉCENTE rejetée (erreur serveur) APRÈS qu'une requête plus ancienne a réussi, when l'ancienne résout ensuite, then l'erreur périmée n'écrase rien et la réussite périmée n'est pas non plus remontée", async () => {
    let resolveOld!: (v: unknown) => void;
    let rejectNew!: (e: unknown) => void;
    const oldPromise = new Promise((res) => {
      resolveOld = res;
    });
    const newPromise = new Promise((_res, rej) => {
      rejectNew = rej;
    });
    mockRunCalc.mockImplementationOnce(() => oldPromise);
    mockRunCalc.mockImplementationOnce(() => newPromise);

    const onCalcResultId = vi.fn();
    await renderFrame({ onCalcResultId });
    const iframe = getIframe();
    const postSpy = vi.spyOn(iframe.contentWindow as Window, 'postMessage');

    await sendFromIframe(iframe, {
      v: 1,
      type: 'calc:request',
      id: 'req_old',
      payload: { engineId: 'terzaghi', label: 'Ancien', params: {} },
    });
    await sendFromIframe(iframe, {
      v: 1,
      type: 'calc:request',
      id: 'req_new',
      payload: { engineId: 'terzaghi', label: 'Nouveau', params: {} },
    });

    await act(async () => {
      rejectNew({ statusCode: 500, reason: 'SERVER_ERROR', message: 'Erreur' });
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      resolveOld({
        id: 'calc_old',
        engineId: 'terzaghi',
        domain: 'FD',
        status: 'DONE',
        output: {},
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    // La réussite PÉRIMÉE (req_old) ne doit jamais réactiver le bouton PV.
    expect(onCalcResultId).not.toHaveBeenCalled();
    const staleSuccess = postSpy.mock.calls.find(
      (c) => (c[0] as { id?: string }).id === 'req_old',
    );
    expect(
      staleSuccess,
      'le succès périmé ne doit pas être renvoyé au clone',
    ).toBeUndefined();
    const freshError = postSpy.mock.calls.find(
      (c) => (c[0] as { id?: string }).id === 'req_new',
    );
    expect(freshError).toBeTruthy();
    expect((freshError?.[0] as { payload: { ok: boolean } }).payload.ok).toBe(false);
  });
});

describe('ToolFrame — input:dirty invalide le calcul périmé (BQ-1, audit adverse #9)', () => {
  it('given un calc:response ok déjà remonté au shell, when input:dirty arrive ensuite depuis le clone, then onCalcResultId est rappelé avec null (le bouton « Émettre le PV » doit se désactiver)', async () => {
    mockRunCalc.mockResolvedValue({
      id: 'calc_42',
      engineId: 'terzaghi',
      domain: 'FD',
      status: 'DONE',
      output: {},
    });
    const onCalcResultId = vi.fn();
    await renderFrame({ onCalcResultId });
    const iframe = getIframe();

    await sendFromIframe(iframe, {
      v: 1,
      type: 'calc:request',
      id: 'req_1',
      payload: { engineId: 'terzaghi', label: 'Calcul', params: {} },
    });
    expect(onCalcResultId).toHaveBeenCalledWith('calc_42');

    await sendFromIframe(iframe, {
      v: 1,
      type: 'input:dirty',
      payload: { toolId: 'terzaghi' },
    });

    expect(onCalcResultId).toHaveBeenLastCalledWith(null);
  });

  it('given aucun calcul en cours (calcResultId déjà null), when input:dirty arrive, then onCalcResultId(null) est quand même appelé, sans exception (idempotent)', async () => {
    const onCalcResultId = vi.fn();
    await renderFrame({ onCalcResultId });
    const iframe = getIframe();

    await expect(
      sendFromIframe(iframe, {
        v: 1,
        type: 'input:dirty',
        payload: { toolId: 'terzaghi' },
      }),
    ).resolves.not.toThrow();
    expect(onCalcResultId).toHaveBeenCalledWith(null);
  });

  it("given un clone qui n'émet JAMAIS input:dirty (comportement actuel avant portage du contrat par clone-tool.mjs), when un calcul réussit, then le shell reste sur son calcResultId (aucune régression rétrocompatible)", async () => {
    mockRunCalc.mockResolvedValue({
      id: 'calc_99',
      engineId: 'terzaghi',
      domain: 'FD',
      status: 'DONE',
      output: {},
    });
    const onCalcResultId = vi.fn();
    await renderFrame({ onCalcResultId });
    const iframe = getIframe();

    await sendFromIframe(iframe, {
      v: 1,
      type: 'calc:request',
      id: 'req_1',
      payload: { engineId: 'terzaghi', label: 'Calcul', params: {} },
    });

    expect(onCalcResultId).toHaveBeenCalledTimes(1);
    expect(onCalcResultId).toHaveBeenCalledWith('calc_99');
    expect(onCalcResultId).not.toHaveBeenCalledWith(null);
  });
});

describe('ToolFrame — store:get / store:set namespacés', () => {
  it('given store:set reçu, when traité, then localStorage namespacé écrit + store:value renvoyé en écho', async () => {
    await renderFrame();
    const iframe = getIframe();
    const postSpy = vi.spyOn(iframe.contentWindow as Window, 'postMessage');

    await sendFromIframe(iframe, {
      v: 1,
      type: 'store:set',
      payload: { key: 'brouillon', value: { B: '2', D: '1' } },
    });

    const stored = localStorage.getItem(
      toolStoreKey('org_01', 'proj_01', 'terzaghi', 'brouillon'),
    );
    expect(stored).toBe(JSON.stringify({ B: '2', D: '1' }));
    expect(postSpy).toHaveBeenCalledWith(
      {
        v: 1,
        type: 'store:value',
        payload: { key: 'brouillon', value: { B: '2', D: '1' } },
      },
      '*',
    );
  });

  it('given une valeur déjà stockée, when store:get reçu, then store:value la restitue', async () => {
    localStorage.setItem(
      toolStoreKey('org_01', 'proj_01', 'terzaghi', 'brouillon'),
      JSON.stringify({ B: '3' }),
    );
    await renderFrame();
    const iframe = getIframe();
    const postSpy = vi.spyOn(iframe.contentWindow as Window, 'postMessage');

    await sendFromIframe(iframe, {
      v: 1,
      type: 'store:get',
      payload: { key: 'brouillon' },
    });

    expect(postSpy).toHaveBeenCalledWith(
      { v: 1, type: 'store:value', payload: { key: 'brouillon', value: { B: '3' } } },
      '*',
    );
  });

  it("given aucune valeur stockée, when store:get reçu, then store:value renvoie null (pas d'exception)", async () => {
    await renderFrame();
    const iframe = getIframe();
    const postSpy = vi.spyOn(iframe.contentWindow as Window, 'postMessage');

    await sendFromIframe(iframe, {
      v: 1,
      type: 'store:get',
      payload: { key: 'inexistant' },
    });

    expect(postSpy).toHaveBeenCalledWith(
      { v: 1, type: 'store:value', payload: { key: 'inexistant', value: null } },
      '*',
    );
  });

  it("given projectId=null (aucun projet choisi), when store:set reçu, then la clé est namespacée sous le repli '_noproject' (brouillon non perdu)", async () => {
    await renderFrame({ projectId: null });
    const iframe = getIframe();

    await sendFromIframe(iframe, {
      v: 1,
      type: 'store:set',
      payload: { key: 'brouillon', value: { B: '2' } },
    });

    // Assertion sur la clé LITTÉRALE (pas via toolStoreKey des deux côtés :
    // ça vérifierait juste que production et test s'accordent entre eux,
    // pas que le repli '_noproject' existe réellement — faux-vert DoD §9).
    const stored = localStorage.getItem(
      'tool-store:org_01:_noproject:terzaghi:brouillon',
    );
    expect(stored).toBe(JSON.stringify({ B: '2' }));
    // Contre-épreuve : toolStoreKey(orgId, null, …) produit bien cette même clé.
    expect(toolStoreKey('org_01', null, 'terzaghi', 'brouillon')).toBe(
      'tool-store:org_01:_noproject:terzaghi:brouillon',
    );
  });

  it("given un brouillon déjà écrit sous le repli '_noproject', when store:get reçu AVEC un vrai projet sélectionné, then il n'est PAS visible (espaces de noms distincts, pas de fuite)", async () => {
    // Écrit directement sous la clé LITTÉRALE de repli — équivalent d'une
    // saisie faite AVANT toute sélection de projet dans une session précédente.
    localStorage.setItem(
      'tool-store:org_01:_noproject:terzaghi:brouillon',
      JSON.stringify({ B: '2' }),
    );
    await renderFrame({ projectId: 'proj_01' });
    const iframe = getIframe();
    const postSpy = vi.spyOn(iframe.contentWindow as Window, 'postMessage');

    await sendFromIframe(iframe, {
      v: 1,
      type: 'store:get',
      payload: { key: 'brouillon' },
    });

    expect(postSpy).toHaveBeenCalledWith(
      { v: 1, type: 'store:value', payload: { key: 'brouillon', value: null } },
      '*',
    );
  });
});

describe('ToolFrame — onSnapshotStatus (M3, revue adverse — ferme la course capture/scellement)', () => {
  it("given un calcul qui réussit, when calc:response arrive, then onSnapshotStatus('awaiting') est émis pour ce calcResultId AVANT toute capture", async () => {
    mockRunCalc.mockResolvedValue({
      id: 'calc_42',
      engineId: 'terzaghi',
      domain: 'FD',
      status: 'DONE',
      output: { verdict: 'PASS', rows: [] },
    });
    const onSnapshotStatus = vi.fn();
    await renderFrame({ onSnapshotStatus });
    const iframe = getIframe();

    await sendFromIframe(iframe, {
      v: 1,
      type: 'calc:request',
      id: 'req_1',
      payload: { engineId: 'terzaghi', label: 'Calcul test', params: {} },
    });

    expect(onSnapshotStatus).toHaveBeenCalledWith({
      calcResultId: 'calc_42',
      status: 'awaiting',
    });
    // Aucun snapshot:capture envoyé → le statut reste 'awaiting' (pas de faux 'confirmed').
    expect(mockSaveCalcSnapshot).not.toHaveBeenCalled();
  });

  it("given snapshot:capture reçu et saveCalcSnapshot qui résout, when la persistance aboutit, then onSnapshotStatus transite awaiting→capturing→confirmed dans l'ordre", async () => {
    mockRunCalc.mockResolvedValue({
      id: 'calc_42',
      engineId: 'terzaghi',
      domain: 'FD',
      status: 'DONE',
      output: { verdict: 'PASS', rows: [] },
    });
    mockSaveCalcSnapshot.mockResolvedValue(undefined);
    const onSnapshotStatus = vi.fn();
    await renderFrame({ onSnapshotStatus });
    const iframe = getIframe();

    await sendFromIframe(iframe, {
      v: 1,
      type: 'calc:request',
      id: 'req_1',
      payload: { engineId: 'terzaghi', label: 'Calcul test', params: {} },
    });
    await sendFromIframe(iframe, {
      v: 1,
      type: 'snapshot:capture',
      payload: { displayHtml: '<p>affiché</p>', printHtml: '<html>imprimable</html>' },
    });

    expect(mockSaveCalcSnapshot).toHaveBeenCalledWith('org_01', 'proj_01', 'calc_42', {
      displayHtml: '<p>affiché</p>',
      printHtml: '<html>imprimable</html>',
    });
    const statuses = onSnapshotStatus.mock.calls.map((c) => c[0]);
    expect(statuses).toEqual([
      { calcResultId: 'calc_42', status: 'awaiting' },
      { calcResultId: 'calc_42', status: 'capturing' },
      { calcResultId: 'calc_42', status: 'confirmed' },
    ]);
  });

  it("given snapshot:capture reçu et saveCalcSnapshot qui échoue, when la persistance échoue, then onSnapshotStatus transite jusqu'à 'failed' (jamais 'confirmed' à tort)", async () => {
    mockRunCalc.mockResolvedValue({
      id: 'calc_42',
      engineId: 'terzaghi',
      domain: 'FD',
      status: 'DONE',
      output: { verdict: 'PASS', rows: [] },
    });
    mockSaveCalcSnapshot.mockRejectedValue({ statusCode: 400, message: 'HTML rejeté' });
    const onSnapshotStatus = vi.fn();
    await renderFrame({ onSnapshotStatus });
    const iframe = getIframe();

    await sendFromIframe(iframe, {
      v: 1,
      type: 'calc:request',
      id: 'req_1',
      payload: { engineId: 'terzaghi', label: 'Calcul test', params: {} },
    });
    await sendFromIframe(iframe, {
      v: 1,
      type: 'snapshot:capture',
      payload: { displayHtml: '<p>affiché</p>', printHtml: '<html>imprimable</html>' },
    });

    const statuses = onSnapshotStatus.mock.calls.map((c) => c[0]);
    expect(statuses).toEqual([
      { calcResultId: 'calc_42', status: 'awaiting' },
      { calcResultId: 'calc_42', status: 'capturing' },
      { calcResultId: 'calc_42', status: 'failed' },
    ]);
  });
});

describe('ToolFrame — watchdog anti soft-lock (finition avant merge, revue adverse)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("given un calcul réussi mais snapshot:capture n'arrive JAMAIS (clone qui lève au rendu), when le délai watchdog s'écoule, then le statut bascule lui-même en 'failed' (jamais bloqué en dur)", async () => {
    mockRunCalc.mockResolvedValue({
      id: 'calc_42',
      engineId: 'terzaghi',
      domain: 'FD',
      status: 'DONE',
      output: { verdict: 'PASS', rows: [] },
    });
    const onSnapshotStatus = vi.fn();
    await renderFrame({ onSnapshotStatus });
    const iframe = getIframe();

    await sendFromIframe(iframe, {
      v: 1,
      type: 'calc:request',
      id: 'req_1',
      payload: { engineId: 'terzaghi', label: 'Calcul test', params: {} },
    });

    // 'awaiting' émis, AUCUN snapshot:capture n'arrivera jamais dans ce test.
    expect(onSnapshotStatus).toHaveBeenCalledWith({
      calcResultId: 'calc_42',
      status: 'awaiting',
    });
    expect(mockSaveCalcSnapshot).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(SNAPSHOT_WATCHDOG_MS);
      await Promise.resolve();
    });

    const statuses = onSnapshotStatus.mock.calls.map((c) => c[0]);
    expect(statuses).toEqual([
      { calcResultId: 'calc_42', status: 'awaiting' },
      { calcResultId: 'calc_42', status: 'failed' },
    ]);
  });

  it("given snapshot:capture confirmé AVANT l'échéance du watchdog, when le délai s'écoule ensuite, then AUCUN 'failed' n'est émis (watchdog annulé, pas de double-transition)", async () => {
    mockRunCalc.mockResolvedValue({
      id: 'calc_42',
      engineId: 'terzaghi',
      domain: 'FD',
      status: 'DONE',
      output: { verdict: 'PASS', rows: [] },
    });
    mockSaveCalcSnapshot.mockResolvedValue(undefined);
    const onSnapshotStatus = vi.fn();
    await renderFrame({ onSnapshotStatus });
    const iframe = getIframe();

    await sendFromIframe(iframe, {
      v: 1,
      type: 'calc:request',
      id: 'req_1',
      payload: { engineId: 'terzaghi', label: 'Calcul test', params: {} },
    });
    await sendFromIframe(iframe, {
      v: 1,
      type: 'snapshot:capture',
      payload: { displayHtml: '<p>affiché</p>', printHtml: '<html>imprimable</html>' },
    });

    const statusesBeforeTimeout = onSnapshotStatus.mock.calls.map((c) => c[0]);
    expect(statusesBeforeTimeout).toEqual([
      { calcResultId: 'calc_42', status: 'awaiting' },
      { calcResultId: 'calc_42', status: 'capturing' },
      { calcResultId: 'calc_42', status: 'confirmed' },
    ]);

    await act(async () => {
      vi.advanceTimersByTime(SNAPSHOT_WATCHDOG_MS);
      await Promise.resolve();
    });

    // Aucun appel supplémentaire — le watchdog a bien été annulé à la confirmation.
    expect(onSnapshotStatus).toHaveBeenCalledTimes(3);
  });

  it('given le composant est démonté AVANT résolution, when le délai watchdog se serait écoulé, then aucun callback ne se déclenche après démontage (pas de fuite/état sur un composant retiré)', async () => {
    mockRunCalc.mockResolvedValue({
      id: 'calc_42',
      engineId: 'terzaghi',
      domain: 'FD',
      status: 'DONE',
      output: { verdict: 'PASS', rows: [] },
    });
    const onSnapshotStatus = vi.fn();
    await renderFrame({ onSnapshotStatus });
    const iframe = getIframe();

    await sendFromIframe(iframe, {
      v: 1,
      type: 'calc:request',
      id: 'req_1',
      payload: { engineId: 'terzaghi', label: 'Calcul test', params: {} },
    });
    expect(onSnapshotStatus).toHaveBeenCalledTimes(1);

    act(() => {
      root.unmount();
    });

    await act(async () => {
      vi.advanceTimersByTime(SNAPSHOT_WATCHDOG_MS);
      await Promise.resolve();
    });

    // Toujours un seul appel ('awaiting') — le watchdog a été nettoyé au démontage.
    expect(onSnapshotStatus).toHaveBeenCalledTimes(1);
  });
});

describe('ToolFrame — pv:request', () => {
  it('given emitPv résout, when pv:request reçu, then onPvEmitted est appelé avec le PV', async () => {
    const pv = { id: 'pv_01', number: 'PV-2026-0001' };
    mockEmitPv.mockResolvedValue(pv);
    const onPvEmitted = vi.fn();
    await renderFrame({ onPvEmitted });
    const iframe = getIframe();

    await sendFromIframe(iframe, {
      v: 1,
      type: 'pv:request',
      payload: { calcResultId: 'calc_42' },
    });

    expect(mockEmitPv).toHaveBeenCalledWith('org_01', 'proj_01', {
      calcResultId: 'calc_42',
    });
    expect(onPvEmitted).toHaveBeenCalledWith(pv);
  });
});

describe('ToolFrame — sécurité de la boucle postMessage', () => {
  it("given un message dont la source n'est PAS l'iframe, when reçu, then ignoré (aucune réponse, aucun appel API)", async () => {
    await renderFrame();
    const iframe = getIframe();
    const postSpy = vi.spyOn(iframe.contentWindow as Window, 'postMessage');
    const rogueWindow = {} as Window;

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { v: 1, type: 'ready', payload: { toolId: 'terzaghi' } },
          source: rogueWindow,
        }),
      );
      await Promise.resolve();
    });

    expect(postSpy).not.toHaveBeenCalled();
    expect(mockRunCalc).not.toHaveBeenCalled();
  });

  it("given un message malformé (hors protocole) depuis l'iframe, when reçu, then ignoré sans exception", async () => {
    await renderFrame();
    const iframe = getIframe();
    const postSpy = vi.spyOn(iframe.contentWindow as Window, 'postMessage');

    await expect(
      sendFromIframe(iframe, { not: 'a bridge message' }),
    ).resolves.not.toThrow();
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('given un message avec une version de protocole inconnue, when reçu, then ignoré', async () => {
    await renderFrame();
    const iframe = getIframe();
    const postSpy = vi.spyOn(iframe.contentWindow as Window, 'postMessage');

    await sendFromIframe(iframe, {
      v: 2,
      type: 'ready',
      payload: { toolId: 'terzaghi' },
    });

    expect(postSpy).not.toHaveBeenCalled();
  });
});
