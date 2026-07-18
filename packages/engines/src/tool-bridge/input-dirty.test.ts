/**
 * BRIDGE input:dirty (correctif workflow PV — BQ-1). Le clone doit signaler a
 * l'hote (ToolFrame) que l'ECRAN A CHANGE apres un calcul, sinon on pourrait
 * sceller un PV perime. Contrat (fixe par la moitie hote) :
 *   { v: 1, type: 'input:dirty', payload: { toolId: '<toolId>' } }
 * ou toolId == la valeur deja emise dans le message `ready` du runtime bridge.
 *
 * Ce test est l'ARBITRE de la moitie CLONE :
 *   1. STATIQUE (6 clones servis) : le HTML servi porte bien l'emetteur input:dirty
 *      et les listeners delegues input/change — preuve dans le fichier livre. On PROUVE
 *      aussi l'ABSENCE de listener `click` (navigation entre onglets de resultats ne doit
 *      PAS invalider le PV : le calcul affiche n'a pas change).
 *   2. COMPORTEMENTAL (jsdom) : on charge le clone, on capture window.parent.postMessage,
 *      on simule un evenement `input`, et on prouve qu'un input:dirty part
 *      IMMEDIATEMENT (synchrone, NON debounce) avec le MEME toolId que `ready`.
 *   3. THROTTLE ~1/frame : deux `input` synchrones => UN SEUL input:dirty (front de
 *      montee) ; apres une frame, un nouvel `input` => un 2e message. Aucun DELAI
 *      temporel n'est introduit sur l'emission (le bouton doit se desactiver des la
 *      1re frappe) — seul un flag booleen coalesce les rafales intra-frame.
 *
 * Skip BRUYANT (jamais silencieux) si un clone est absent : « suite absente = ABSENTE ».
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
// packages/engines/src/tool-bridge -> 05-Plateforme (4 niveaux).
const CLONES_DIR = resolve(HERE, '../../../../apps/web/src/tools-cloned');

/** toolId attendu (== TOOL_ID du runtime bridge, == payload.toolId du `ready`). */
const CLONES: Record<string, string> = {
  terzaghi: 'terzaghi',
  roadsens: 'roadsens',
  geoplaque: 'geoplaque',
  casagrande: 'casagrande',
  fastlab: 'fastlab',
  pressiopro: 'pressiopro',
};

const clonePath = (file: string) => resolve(CLONES_DIR, `${file}.html`);

type Posted = { v?: number; type?: string; payload?: { toolId?: string } };

/**
 * Charge un clone en jsdom en INTERCEPTANT window.postMessage (le runtime bridge
 * poste vers window.parent, qui vaut window en jsdom) : on enregistre chaque
 * message SYNCHRONE (au moment de l'appel), ce qui permet d'affirmer l'immediatete.
 */
function loadCloneCapturing(file: string): { dom: JSDOM; posted: Posted[] } {
  const html = readFileSync(clonePath(file), 'utf8');
  const posted: Posted[] = [];
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) {
      const orig = window.postMessage.bind(window);
      (window as unknown as { postMessage: unknown }).postMessage = (
        ...args: unknown[]
      ) => {
        posted.push(args[0] as Posted);
        return (orig as (...a: unknown[]) => unknown)(...args);
      };
    },
  });
  return { dom, posted };
}

const dirtyOf = (posted: Posted[]) =>
  posted.filter((m) => m?.type === 'input:dirty');

// -------------------------------------------------------------------------
// 1. STATIQUE — le HTML servi porte l'emetteur et les listeners (les 6 clones)
// -------------------------------------------------------------------------
describe('bridge input:dirty — emetteur present dans le clone servi (les 6 outils)', () => {
  for (const [file, toolId] of Object.entries(CLONES)) {
    const present = existsSync(clonePath(file));
    (present ? it : it.skip)(
      `${file} : le HTML servi emet input:dirty (toolId ${toolId}) sur input/change (pas click)`,
      () => {
        if (!present) {
          // eslint-disable-next-line no-console
          console.warn(`[input-dirty] SKIP : clone absent (${clonePath(file)}).`);
          return;
        }
        const html = readFileSync(clonePath(file), 'utf8');
        // Le message du contrat, avec le bon toolId (via la constante TOOL_ID du bridge).
        expect(html).toContain('type:"input:dirty"');
        expect(html).toContain('payload:{toolId:TOOL_ID}');
        // Listeners delegues au document, en CAPTURE (generique, sans DOM connu).
        expect(html).toContain('document.addEventListener("input", __geofamEmitDirty, true)');
        expect(html).toContain('document.addEventListener("change", __geofamEmitDirty, true)');
        // PAS de listener `click` : naviguer entre onglets de resultats ne doit PAS
        // invalider le PV (le calcul affiche est inchange) — regression UX ecartee.
        expect(html).not.toContain('document.addEventListener("click", __geofamEmitDirty');
        // Le TOOL_ID du bridge = le toolId attendu (celui deja emis par `ready`).
        expect(html).toContain(`TOOL_ID="${toolId}"`);
        // ANTI-DEBOUNCE : l'emission (post input:dirty) n'est PAS derriere un setTimeout.
        // On verifie que le corps de __geofamEmitDirty poste AVANT toute planification.
        const body = html.slice(
          html.indexOf('function __geofamEmitDirty()'),
          html.indexOf('function __geofamEmitDirty()') + 400,
        );
        const postIdx = body.indexOf('post({v:1,type:"input:dirty"');
        const timerIdx = body.indexOf('setTimeout');
        expect(postIdx, 'emission input:dirty introuvable').toBeGreaterThan(-1);
        // post() precede le repli setTimeout (le timer ne sert qu'a RESET le flag, pas a emettre).
        expect(postIdx).toBeLessThan(timerIdx === -1 ? Number.MAX_SAFE_INTEGER : timerIdx);
      },
    );
  }
});

// -------------------------------------------------------------------------
// 2 & 3. COMPORTEMENTAL — emission immediate, bon toolId, throttle ~1/frame
// -------------------------------------------------------------------------
// Deux clones a UI differente (terzaghi = fondation, roadsens = chaussee) pour
// couvrir le runtime bridge generique sur au moins deux structures d'outil.
for (const file of ['terzaghi', 'roadsens'] as const) {
  const present = existsSync(clonePath(file));
  const d = present ? describe : describe.skip;
  d(`bridge input:dirty — comportement runtime (${file})`, () => {
    it('emet input:dirty IMMEDIATEMENT sur un evenement input, avec le toolId de `ready`', () => {
      const { dom, posted } = loadCloneCapturing(file);
      const win = dom.window as unknown as { document: Document; Event: typeof Event };

      // Le runtime bridge a emis `ready` au chargement : on en lit le toolId de reference.
      const ready = posted.find((m) => m?.type === 'ready');
      expect(ready, '`ready` non emis par le runtime bridge').toBeDefined();
      const toolId = ready?.payload?.toolId;
      expect(toolId, 'toolId absent du `ready`').toBe(CLONES[file]);

      // Aucun input:dirty au simple chargement (pas d'interaction utilisateur).
      expect(dirtyOf(posted), 'input:dirty a fuite au chargement').toHaveLength(0);

      // Simule une saisie : evenement `input` (bubbling) -> listener delegue (capture).
      const before = dirtyOf(posted).length;
      win.document.dispatchEvent(new win.Event('input', { bubbles: true }));
      // IMMEDIAT : le message est deja enregistre (postMessage est appele de facon
      // SYNCHRONE dans __geofamEmitDirty) — pas d'attente de timer.
      const after = dirtyOf(posted);
      expect(after.length, 'aucun input:dirty apres saisie (emission non cablee ?)').toBe(
        before + 1,
      );
      // Contrat exact : v/type/payload.toolId == toolId de `ready`.
      const msg = after[after.length - 1];
      expect(msg, 'message input:dirty absent').toBeDefined();
      expect(msg!.v).toBe(1);
      expect(msg!.type).toBe('input:dirty');
      expect(msg!.payload?.toolId).toBe(toolId);

      dom.window.close();
    });

    it('throttle ~1/frame : rafale intra-frame coalescee, nouvelle frame => nouveau message', async () => {
      const { dom, posted } = loadCloneCapturing(file);
      const win = dom.window as unknown as {
        document: Document;
        Event: typeof Event;
      };

      // Rafale de 3 evenements SYNCHRONES dans la meme frame -> un SEUL input:dirty.
      win.document.dispatchEvent(new win.Event('input', { bubbles: true }));
      win.document.dispatchEvent(new win.Event('change', { bubbles: true }));
      win.document.dispatchEvent(new win.Event('input', { bubbles: true }));
      expect(dirtyOf(posted).length, 'rafale intra-frame non coalescee').toBe(1);

      // Franchit une frame (requestAnimationFrame ~ timer en jsdom) : le flag est remis a false.
      await new Promise((r) => setTimeout(r, 40));

      // Nouvelle saisie -> un 2e message (le throttle ne BLOQUE pas les frappes suivantes).
      win.document.dispatchEvent(new win.Event('input', { bubbles: true }));
      expect(dirtyOf(posted).length, 'aucune emission apres la frame (throttle bloquant ?)').toBe(2);

      dom.window.close();
    });
  });
}
