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

const { mockRunCalc, mockEmitPv } = vi.hoisted(() => ({
  mockRunCalc: vi.fn(),
  mockEmitPv: vi.fn(),
}));

vi.mock('@/lib/api/client', () => ({
  runCalc: mockRunCalc,
  emitPv: mockEmitPv,
}));

import { ToolFrame } from '../ToolFrame';
import { toolStoreKey } from '../protocol';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  mockRunCalc.mockReset();
  mockEmitPv.mockReset();
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
  onPvEmitted?: (pv: unknown) => void;
}

async function renderFrame(opts: RenderOpts = {}) {
  await act(async () => {
    root = createRoot(container);
    root.render(
      <ToolFrame
        toolId="terzaghi"
        engineId="terzaghi"
        orgId="org_01"
        orgSlug="be-routes-dakar"
        projectId="proj_01"
        projectLabel="Fondation A12"
        accessToken="token-abc"
        onCalcResultId={opts.onCalcResultId}
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
