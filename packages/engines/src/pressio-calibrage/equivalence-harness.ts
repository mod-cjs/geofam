/**
 * Harnais d'EQUIVALENCE-PORTAGE calibrage : HTML d'origine (jsdom) <-> module TS.
 *
 * Role : prouver que le module extrait (engine.ts, `computeCalibrage`) produit EXACTEMENT
 * le meme resultat BRUT (l'objet `e` passe a `renderCalibResult`) que le moteur du HTML
 * d'origine, sur un jeu d'entrees. C'est l'arbitre du portage :
 *   - ecart present AUSSI dans le HTML d'origine  -> bug science (client/avenant) ;
 *   - ecart INTRODUIT par le portage              -> notre defaut d'integration.
 *
 * --- SOURCE : LE MEME HTML QUE PRESSIOMETRE-MENARD ---
 * `calcCalibrage` et `solve3` vivent dans pressiometre__1_.html, AUX COTES de
 * `calcDepth` et `calcEtalonnage`. On reutilise donc l'entree de registre
 * `pressiometre-menard` (meme fichier, meme SHA-256 scelle) pour localiser la source et
 * VERIFIER son empreinte (garantie qu'on teste la version scellee au PV).
 *
 * --- PARTICULARITE (calcCalibrage est une fonction UI, sans valeur de retour) ---
 * `calcCalibrage()` du HTML lit ses points dans la GLOBALE `calibRows`, calcule, PUIS
 * appelle `renderCalibResult(e)` (DOM) et `drawCalibChart(...)` (Chart.js, via setTimeout).
 * Pour capturer le resultat SANS toucher le HTML, on EVALUE un script DANS le contexte
 * global de la fenetre jsdom qui :
 *   1. RENSEIGNE `calibRows` depuis l'entree de fixture ;
 *   2. HOOKE `renderCalibResult` pour capturer `e`, neutralise `drawCalibChart` / `toast` ;
 *   3. appelle `calcCalibrage()` et renvoie l'objet `e` capture, serialise.
 * On NE TOUCHE PAS au HTML : on intercepte le point de sortie de la science.
 *
 * On compare l'objet `e` BRUT (a_calib/R²/RMS/c0/c1/c2 + intermediaires pts/residuals),
 * pas la sortie whitelistee : un harnais qui ne comparerait que les champs exposes
 * laisserait passer une derive sur un intermediaire (notamment c0/c1/c2).
 *
 * IMPORTANT (confidentialite) : ce module est de l'OUTILLAGE DE TEST. Il lit le HTML
 * source via le systeme de fichiers et ne s'execute qu'en test. Il n'expose aucun symbole
 * moteur au front.
 *
 * PORTEE HONNETE : prouve l'EQUIVALENCE DU PORTAGE (module == origine), PAS la JUSTESSE
 * scientifique. Science GeoSuite SIGNEE (STARFIRE) ; equivalence = preuve de fidelite
 * obligatoire (@science-unsigned tant que le kit cas-tests STARFIRE manque).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { JSDOM } from 'jsdom';

import { ENGINE_REGISTRY } from '../registry/registry.js';

import type { PressioCalibrageInput } from './contract.js';

const here = dirname(fileURLToPath(import.meta.url));
// packages/engines/src/pressio-calibrage -> racine repo 05-Plateforme (4 niveaux up).
const REPO_ROOT = resolve(here, '..', '..', '..', '..');

// calcCalibrage vit dans le MEME HTML que le depouillement pressiometrique.
const SOURCE_ENGINE_ID = 'pressiometre-menard';

function sourceRegistryEntry() {
  const entry = ENGINE_REGISTRY.find((e) => e.id === SOURCE_ENGINE_ID);
  if (!entry) throw new Error('Entree de registre "pressiometre-menard" introuvable.');
  return entry;
}

/** Localise le HTML source (pressiometre__1_.html) via le registre (verite unique). */
export function calibrageSourcePath(): string {
  return resolve(REPO_ROOT, sourceRegistryEntry().cheminSource);
}

/** SHA-256 (hex) scelle au PV pour ce HTML (registre). */
export function calibrageRegistrySha256(): string {
  return sourceRegistryEntry().sha256;
}

/** SHA-256 du HTML source LU sur disque (hex minuscule). */
export function calibrageSourceSha256(): string {
  return createHash('sha256').update(readFileSync(calibrageSourcePath())).digest('hex');
}

/**
 * Charge le HTML d'origine dans jsdom et renvoie une fonction `computeHtml` qui, pour un
 * jeu de points, renseigne `calibRows`, hooke `renderCalibResult`, appelle
 * `calcCalibrage()` et renvoie l'objet `e` BRUT capture.
 *
 * @throws si le fichier source est absent (sources hors depot git en CI) — SKIP BRUYANT.
 * @throws ECHEC DUR si le SHA-256 du HTML lu != sha256 scelle au registre.
 */
export function loadOriginalCompute(): {
  computeHtml: (input: PressioCalibrageInput) => unknown;
  cleanup: () => void;
} {
  const buf = readFileSync(calibrageSourcePath());
  const actualSha = createHash('sha256').update(buf).digest('hex');
  const expectedSha = calibrageRegistrySha256();
  if (actualSha !== expectedSha) {
    throw new Error(
      `EQUIVALENCE INVALIDE : le SHA-256 du HTML source (${actualSha}) ne correspond ` +
        `PAS a la valeur scellee au registre (${expectedSha}). On testerait l'equivalence ` +
        `contre une version DIFFERENTE de celle scellee au PV. Mettre a jour le registre ` +
        `(sha256 + bump version) si l'evolution est voulue, OU restaurer la version canonique.`,
    );
  }
  const html = buf.toString('utf8');
  const dom = new JSDOM(html, { runScripts: 'dangerously' });
  const win = dom.window as unknown as { eval: (code: string) => unknown };

  // Sanity : le HTML doit exposer calcCalibrage + la globale `calibRows`.
  if (win.eval('typeof calcCalibrage') !== 'function') {
    throw new Error(
      "Le HTML d'origine n'expose pas calcCalibrage : structure du moteur modifiee ?",
    );
  }
  if (win.eval('typeof calibRows') === 'undefined') {
    throw new Error("Le HTML d'origine n'expose pas la globale `calibRows`.");
  }

  const computeHtml = (input: PressioCalibrageInput): unknown => {
    const code = `
      (function(){
        var __cap = null;
        renderCalibResult = function(e){ __cap = e; };
        drawCalibChart = function(){};
        toast = function(){};
        calibRows = ${JSON.stringify(input.rows)};
        var __err = null;
        try { calcCalibrage(); } catch (e) { __err = e && e.message ? String(e.message) : 'Erreur de calcul'; }
        if (__err !== null) return JSON.stringify({ err: __err });
        // < 3 points valides : calcCalibrage toast + return sans appeler renderCalibResult.
        if (__cap === null) return JSON.stringify({ err: 'Saisissez au moins 3 points.' });
        return JSON.stringify(__cap);
      })()
    `;
    return JSON.parse(win.eval(code) as string);
  };

  return { computeHtml, cleanup: () => dom.window.close() };
}

/** HTML source present localement ? (absent en CI). Permet un SKIP BRUYANT sans faux-vert. */
export function calibrageSourceAvailable(): boolean {
  try {
    readFileSync(calibrageSourcePath());
    return true;
  } catch {
    return false;
  }
}

/**
 * Normalise un resultat moteur BRUT en structure PURE comparable (memes regles que le
 * harnais du depouillement) : garde nombres/chaines/booleens/null/tableaux/objets,
 * SUPPRIME fonctions et `undefined` de facon identique des deux cotes.
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
  if (typeof value === 'function' || typeof value === 'undefined') {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value.map((v) => sanitizeResult(v));
  }
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

/** Meme tube de serialisation que le HTML (JSON aller-retour) — comparaison a perimetre egal. */
export function jsonRoundTrip(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}
