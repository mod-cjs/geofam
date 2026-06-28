/**
 * Harnais d'EQUIVALENCE-PORTAGE FASTLAB : HTML d'origine (jsdom) <-> module TS.
 *
 * Role : prouver que le module extrait reproduit EXACTEMENT l'accumulateur `D` (tous
 * les resultats de labo) ET la classification `classify()` du HTML d'origine, sur un
 * jeu d'entrees.
 *   - ecart present AUSSI dans le HTML  -> bug science (client/avenant) ;
 *   - ecart INTRODUIT par le portage    -> notre defaut d'integration.
 *
 * --- PARTICULARITE FASTLAB (suite de calc* non purs, oriente DOM + globale D) ---
 * Le HTML lit ~100 champs via `num('id')`, ecrit dans une GLOBALE `D={}` et rend du
 * DOM/canvas. Pour piloter le calcul depuis le test, on EVALUE un script dans le
 * contexte global de la fenetre jsdom qui :
 *   1. NEUTRALISE le canvas (getContext -> proxy no-op) — les `draw*` du HTML appellent
 *      `getContext('2d').clearRect(...)` qui sinon crashe en jsdom (PRESENTATION pure,
 *      aucun effet sur `D`/`classify`) ;
 *   2. RENSEIGNE les champs `.save` (par id) depuis l'entree de fixture, et fixe les
 *      GLOBALES de mode (forcedState/prType/ciMethod/...) ;
 *   3. appelle `recalc()` (lance tous les calc* PUIS classify) ;
 *   4. renvoie `JSON.stringify({ D, cls: classify() })`.
 * On NE TOUCHE PAS au HTML : on remplit le formulaire et on clique « recalc » comme
 * l'UI le ferait.
 *
 * --- PAS DE PIEGE D'UNITE A LA LECTURE ---
 * `num('id')` lit la valeur telle quelle (parseFloat, virgule->point). Les fixtures
 * sont dans les memes unites que les champs (% pour w, mm, g, etc.).
 *
 * IMPORTANT (confidentialite) : OUTILLAGE DE TEST. Lit le HTML via le FS (registre),
 * ne s'execute qu'en test. PORTEE : equivalence du PORTAGE, PAS la justesse
 * (@science-unsigned, kit STARFIRE #36).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { JSDOM } from 'jsdom';

import { ENGINE_REGISTRY } from '../registry/registry.js';

import type { LaboInput } from './contract.js';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '..', '..', '..', '..');

const LABO_ENGINE_ID = 'labo-classification-gtr';

function laboRegistryEntry() {
  const entry = ENGINE_REGISTRY.find((e) => e.id === LABO_ENGINE_ID);
  if (!entry)
    throw new Error('Entree de registre "labo-classification-gtr" introuvable.');
  return entry;
}
export function laboSourcePath(): string {
  return resolve(REPO_ROOT, laboRegistryEntry().cheminSource);
}
export function laboRegistrySha256(): string {
  return laboRegistryEntry().sha256;
}
export function laboSourceSha256(): string {
  return createHash('sha256').update(readFileSync(laboSourcePath())).digest('hex');
}

/**
 * Charge le HTML d'origine dans jsdom et renvoie `computeHtml(input)` -> { D, cls } BRUT.
 *
 * @throws si le fichier source est absent (CI) — le test SKIP BRUYAMMENT.
 * @throws ECHEC DUR si le SHA-256 du HTML lu != registre (cf. #48/#54).
 */
export function loadOriginalCompute(): {
  computeHtml: (input: LaboInput) => unknown;
  cleanup: () => void;
} {
  const buf = readFileSync(laboSourcePath());
  const actualSha = createHash('sha256').update(buf).digest('hex');
  const expectedSha = laboRegistrySha256();
  if (actualSha !== expectedSha) {
    throw new Error(
      `EQUIVALENCE INVALIDE : SHA-256 du HTML source labo (${actualSha}) != valeur scellee ` +
        `au registre (${expectedSha}). On testerait l'equivalence contre une version DIFFERENTE ` +
        `de celle scellee au PV. Mettre a jour le registre (sha256 + bump) si voulu. (#49-53)`,
    );
  }
  const html = buf.toString('utf8');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    // POLYFILL structuredClone : le HTML l'appelle DES le chargement (l.942 :
    // `CFG = structuredClone(DEFAULTS)`). jsdom (selon la version) ne le fournit pas ;
    // sans lui, le script de page AVORTE en cours d'init (apres hoisting des fonctions
    // mais AVANT `const D={}`), laissant `D` en zone morte temporelle (TDZ) ->
    // "Cannot access 'D' before initialization". On le polyfille AVANT le parse pour que
    // le script s'execute en ENTIER, a l'identique d'un navigateur. C'est de l'OUTILLAGE
    // (parite d'environnement), pas une modification de la science.
    beforeParse(window: { structuredClone?: unknown }) {
      if (typeof window.structuredClone !== 'function') {
        window.structuredClone = (v: unknown) => JSON.parse(JSON.stringify(v));
      }
    },
  });
  const win = dom.window as unknown as { eval: (code: string) => unknown };

  if (win.eval('typeof recalc') !== 'function') {
    throw new Error(
      "Le HTML d'origine n'expose pas recalc : structure du moteur modifiee ?",
    );
  }
  if (win.eval('typeof classify') !== 'function') {
    throw new Error("Le HTML d'origine n'expose pas classify.");
  }

  const computeHtml = (input: LaboInput): unknown => {
    // On pilote via `writeForm(input)` — le CHEMIN UI CANONIQUE : il RESET tous les
    // champs .save (value = DEF[id] || ''), pose les toggles avec leurs defauts
    // (cbType||'cbr'…), gere les checkboxes, et appelle recalc(). C'est ce qui garantit
    // qu'AUCUN etat ne fuit d'une fixture a la suivante (la fenetre jsdom est reutilisee)
    // et que les DEFAUTS effectifs sont ceux du HTML. On capture ensuite D + classify().
    const code = `
      (function(){
        // 1. NEUTRALISER le canvas (draw* PRESENTATION) — getContext -> proxy no-op.
        try {
          var __noop = new Proxy({}, { get: function(){ return function(){ return __noop; }; },
                                       set: function(){ return true; } });
          HTMLCanvasElement.prototype.getContext = function(){ return __noop; };
        } catch(e){}
        // 1b. RENDU SUR : certains calc/render du HTML ecrivent .textContent/.innerHTML
        // sur des elements de PRESENTATION potentiellement absents selon l'onglet. On rend
        // getElementById TOLERANT : un id absent renvoie un proxy NO-OP dont value est ''.
        // NEUTRE pour le calcul : num fait parseFloat((e.value||'')) -> NaN -> null
        // (IDENTIQUE a if(!e)return null), et les ecritures de rendu sont avalees.
        (function(){
          var __realGet = document.getElementById.bind(document);
          var __stub = new Proxy({ value:'', checked:false, textContent:'', innerHTML:'',
                                   style:{}, dataset:{}, classList:{ add:function(){},
                                   remove:function(){}, toggle:function(){} } },
            { get:function(t,p){ if(p in t) return t[p];
                                 return function(){ return __stub; }; },
              set:function(){ return true; } });
          document.getElementById = function(id){ var e=__realGet(id); return e?e:__stub; };
        })();
        // 2. RESET + APPLICATION via writeForm (chemin UI canonique : reset + defauts +
        //    toggles + recalc). m_geo est un champ .save -> ecrit par writeForm.
        var __in = ${JSON.stringify(input)};
        var __err = null, __out = null;
        try {
          writeForm(__in);                       // reset + set + toggles + recalc()
          ${input.cfg ? 'Object.assign(CFG, __in.cfg); recalc();' : ''}
          __out = { D: D, cls: classify() };
        } catch (e) { __err = e && e.message ? String(e.message) : 'Erreur de calcul'; }
        if (__err !== null) return JSON.stringify({ err: __err });
        return JSON.stringify(__out);
      })()
    `;
    return JSON.parse(win.eval(code) as string);
  };

  return { computeHtml, cleanup: () => dom.window.close() };
}

export function laboSourceAvailable(): boolean {
  try {
    readFileSync(laboSourcePath());
    return true;
  } catch {
    return false;
  }
}

/**
 * Normalise un resultat BRUT en structure PURE comparable (omet fonctions/undefined de
 * facon identique des deux cotes). Le `D` du HTML contient `granPts` (tableau de
 * tableaux) — conserve, comparable.
 */
export function sanitizeResult(value: unknown): unknown {
  if (
    value === null ||
    typeof value === 'number' ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (typeof value === 'function' || typeof value === 'undefined') return undefined;
  if (Array.isArray(value)) return value.map((v) => sanitizeResult(v));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const sv = sanitizeResult(v);
      if (sv !== undefined) out[k] = sv;
    }
    return out;
  }
  return undefined;
}

/** Aller-retour JSON (meme tube que le HTML : Infinity/NaN -> null, fonctions omises). */
export function jsonRoundTrip(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}
