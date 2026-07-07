/**
 * Harnais d'EQUIVALENCE-PORTAGE etalonnage : HTML d'origine (jsdom) <-> module TS.
 *
 * Role : prouver que le module extrait (engine.ts, `computeEtalonnage`) produit
 * EXACTEMENT le meme resultat BRUT (l'objet `e` passe a `renderEtalResult`) que le
 * moteur du HTML d'origine, sur un jeu d'entrees. C'est l'arbitre du portage :
 *   - ecart present AUSSI dans le HTML d'origine  -> bug science (client/avenant) ;
 *   - ecart INTRODUIT par le portage              -> notre defaut d'integration.
 *
 * --- SOURCE : LE MEME HTML QUE PRESSIOMETRE-MENARD ---
 * `calcEtalonnage` vit dans pressiometre__1_.html, AUX COTES de `calcDepth`
 * (depouillement) et `calcCalibrage`. On reutilise donc l'entree de registre
 * `pressiometre-menard` (meme fichier, meme SHA-256 scelle) pour localiser la source et
 * VERIFIER son empreinte. Le SHA verifie porte sur le FICHIER ENTIER : il garantit qu'on
 * teste bien contre la version scellee au PV.
 *
 * --- PARTICULARITE (calcEtalonnage est une fonction UI, sans valeur de retour) ---
 * `calcEtalonnage()` du HTML lit ses points dans la GLOBALE `etalRows`, calcule, PUIS
 * appelle `renderEtalResult(e)` (DOM) et `drawEtalChart(e)` (Chart.js). Pour capturer le
 * resultat SANS toucher le HTML, on EVALUE un script DANS le contexte global de la
 * fenetre jsdom qui :
 *   1. RENSEIGNE `etalRows` depuis l'entree de fixture ;
 *   2. HOOKE `renderEtalResult` pour capturer son argument `e`, et neutralise
 *      `drawEtalChart` / `toast` (UI, hors science) ;
 *   3. appelle `calcEtalonnage()` et renvoie l'objet `e` capture, serialise.
 * On NE TOUCHE PAS au HTML : on le pilote comme l'UI le ferait, en interceptant le point
 * de sortie de la science (l'argument de renderEtalResult).
 *
 * On compare l'objet `e` BRUT (a/Vs/Pe/R²/RMS + intermediaires pts/residuals/V_pe/
 * Vs_reel), pas la sortie whitelistee : un harnais qui ne comparerait que les champs
 * exposes laisserait passer une derive sur un intermediaire. La whitelist protege la
 * CONFIDENTIALITE (sortie client) ; l'equivalence-portage se prouve sur le calcul ENTIER.
 *
 * IMPORTANT (confidentialite) : ce module est de l'OUTILLAGE DE TEST. Il lit le HTML
 * source via le systeme de fichiers (chemin du registre) et ne s'execute qu'en test. Il
 * n'expose aucun symbole moteur au front.
 *
 * PORTEE HONNETE : prouve l'EQUIVALENCE DU PORTAGE (module == origine), PAS la JUSTESSE
 * scientifique. La science GeoSuite est SIGNEE (STARFIRE) ; l'equivalence reste la preuve
 * de fidelite obligatoire (@science-unsigned tant que le kit cas-tests STARFIRE manque).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { JSDOM } from 'jsdom';

import { ENGINE_REGISTRY } from '../registry/registry.js';

import type { PressioEtalonnageInput } from './contract.js';

const here = dirname(fileURLToPath(import.meta.url));
// packages/engines/src/pressio-etalonnage -> racine repo 05-Plateforme (4 niveaux up).
const REPO_ROOT = resolve(here, '..', '..', '..', '..');

// calcEtalonnage vit dans le MEME HTML que le depouillement pressiometrique.
const SOURCE_ENGINE_ID = 'pressiometre-menard';

function sourceRegistryEntry() {
  const entry = ENGINE_REGISTRY.find((e) => e.id === SOURCE_ENGINE_ID);
  if (!entry) throw new Error('Entree de registre "pressiometre-menard" introuvable.');
  return entry;
}

/** Localise le HTML source (pressiometre__1_.html) via le registre (verite unique). */
export function etalonnageSourcePath(): string {
  return resolve(REPO_ROOT, sourceRegistryEntry().cheminSource);
}

/** SHA-256 (hex) scelle au PV pour ce HTML (registre). */
export function etalonnageRegistrySha256(): string {
  return sourceRegistryEntry().sha256;
}

/** SHA-256 du HTML source LU sur disque (hex minuscule). */
export function etalonnageSourceSha256(): string {
  return createHash('sha256').update(readFileSync(etalonnageSourcePath())).digest('hex');
}

/**
 * Charge le HTML d'origine dans jsdom et renvoie une fonction `computeHtml` qui, pour
 * un jeu de points, renseigne `etalRows`, hooke `renderEtalResult`, appelle
 * `calcEtalonnage()` et renvoie l'objet `e` BRUT capture.
 *
 * @throws si le fichier source est absent (sources hors depot git en CI) — le test
 *   appelant doit alors SKIP BRUYAMMENT (jamais un faux-vert).
 * @throws ECHEC DUR si le SHA-256 du HTML lu != sha256 scelle au registre :
 *   on prouverait sinon l'equivalence contre un AUTRE moteur que celui scelle au PV.
 */
export function loadOriginalCompute(): {
  computeHtml: (input: PressioEtalonnageInput) => unknown;
  cleanup: () => void;
} {
  const buf = readFileSync(etalonnageSourcePath());
  const actualSha = createHash('sha256').update(buf).digest('hex');
  const expectedSha = etalonnageRegistrySha256();
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

  // Sanity : le HTML doit exposer calcEtalonnage + la globale `etalRows`.
  if (win.eval('typeof calcEtalonnage') !== 'function') {
    throw new Error(
      "Le HTML d'origine n'expose pas calcEtalonnage : structure du moteur modifiee ?",
    );
  }
  if (win.eval('typeof etalRows') === 'undefined') {
    throw new Error("Le HTML d'origine n'expose pas la globale `etalRows`.");
  }

  const computeHtml = (input: PressioEtalonnageInput): unknown => {
    const code = `
      (function(){
        // Neutralise l'UI (hors science) et intercepte le point de sortie du calcul.
        var __cap = null;
        renderEtalResult = function(e){ __cap = e; };
        drawEtalChart = function(){};
        toast = function(){};
        etalRows = ${JSON.stringify(input.rows)};
        var __err = null;
        try { calcEtalonnage(); } catch (e) { __err = e && e.message ? String(e.message) : 'Erreur de calcul'; }
        if (__err !== null) return JSON.stringify({ err: __err });
        // < 3 points valides : calcEtalonnage toast + return sans appeler renderEtalResult.
        if (__cap === null) return JSON.stringify({ err: 'Saisissez au moins 3 points.' });
        return JSON.stringify(__cap);
      })()
    `;
    return JSON.parse(win.eval(code) as string);
  };

  return { computeHtml, cleanup: () => dom.window.close() };
}

/**
 * Verifie si le HTML source est present localement (absent en CI : 03-Moteurs-client
 * hors depot git). Permet au test d'equivalence de SKIP BRUYAMMENT sans faux-vert.
 */
export function etalonnageSourceAvailable(): boolean {
  try {
    readFileSync(etalonnageSourcePath());
    return true;
  } catch {
    return false;
  }
}

/**
 * Normalise un resultat moteur BRUT en structure PURE comparable :
 *   - garde nombres (NaN/Infinity inclus), chaines, booleens, null ;
 *   - garde tableaux et objets simples (recursif) ;
 *   - SUPPRIME fonctions et `undefined` de FACON IDENTIQUE des deux cotes.
 *
 * L'aller-retour JSON cote HTML transforme deja `undefined`/`Infinity` en absence/`null`.
 * On applique la MEME normalisation au module (via jsonRoundTrip) pour comparer a
 * perimetre identique.
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

/**
 * Passe le resultat MODULE par le MEME tube de serialisation que le HTML
 * (JSON.stringify -> JSON.parse). Le HTML traverse cet aller-retour (l'eval renvoie du
 * JSON) : `Infinity`/`NaN` y deviennent `null`, `undefined`/fonctions disparaissent. On
 * impose au module la MEME transformation AVANT comparaison — sinon ce serait un FAUX ecart.
 */
export function jsonRoundTrip(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}
