/**
 * Harnais d'EQUIVALENCE-PORTAGE deformations planes : HTML d'origine (jsdom) <-> module TS.
 *
 * Role : prouver que le module extrait (engine.ts, `computePlaneStrain`) produit
 * EXACTEMENT le meme resultat BRUT (l'objet `R` de `solvePlaneStrain`) que le moteur
 * du HTML d'origine, sur un jeu d'entrees. C'est l'arbitre du portage sur l'ALGEBRE
 * DENSE (poutre Euler-Bernoulli, souplesse nn×nn en bande, solveDense LU, inv) :
 *   - ecart present AUSSI dans le HTML d'origine  -> bug science (client/avenant) ;
 *   - ecart INTRODUIT par le portage              -> notre defaut d'integration.
 *
 * --- SOURCE : LE MEME HTML QUE LE RADIER ---
 * `solvePlaneStrain` vit dans GEOPLAQUE_V10.html, AUX COTES de `solveModel` (radier).
 * On reutilise donc l'entree de registre `radier-plaque` (meme fichier, meme SHA-256
 * scelle) pour localiser la source et VERIFIER son empreinte. Le SHA verifie porte sur
 * le FICHIER ENTIER : il garantit qu'on teste bien contre la version scellee au PV.
 *
 * --- PARTICULARITE (solvePlaneStrain lit la globale `state.layers`) ---
 * `solvePlaneStrain(o)` du HTML lit son sol dans la GLOBALE `state.layers` et ses
 * options dans `o`. Pour piloter le calcul depuis le test, on EVALUE un script DANS le
 * contexte global de la fenetre jsdom qui :
 *   1. RENSEIGNE `state.layers` depuis l'entree de fixture ;
 *   2. appelle DIRECTEMENT `solvePlaneStrain(opts)` (on COURT-CIRCUITE tout le DOM/dessin) ;
 *   3. renvoie `R` serialise.
 * On NE TOUCHE PAS au HTML : on appelle sa fonction de calcul en passant `opts`
 * explicitement (au lieu de le laisser lire le DOM).
 *
 * --- PAS DE PIEGE D'UNITE ---
 * Le moteur ne re-divise/re-multiplie aucun champ a la lecture : E en MPa, e/Bw/zBase
 * en m, q en kPa, P en kN/ml. Les entrees de fixtures sont dans les MEMES unites.
 *
 * --- STABILITE NUMERIQUE ---
 * Le module et le HTML executent LES MEMES operations dans LE MEME ordre (transcription
 * verbatim). Sur le MEME runtime V8, les flottants doivent coincider. On compare le `R`
 * BRUT (tous champs : X/w/p/M/V + scalaires) a une tolerance de PORTAGE serree.
 *
 * IMPORTANT (confidentialite) : ce module est de l'OUTILLAGE DE TEST. Il lit le HTML
 * source via le systeme de fichiers (chemin du registre) et ne s'execute qu'en test.
 * Il n'expose aucun symbole moteur au front.
 *
 * PORTEE HONNETE : prouve l'EQUIVALENCE DU PORTAGE (module == origine), PAS la JUSTESSE
 * scientifique (kit cas-tests STARFIRE). Tag @science-unsigned.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { JSDOM } from 'jsdom';

import { ENGINE_REGISTRY } from '../registry/registry.js';

import type { PlaneStrainInput } from './contract.js';

const here = dirname(fileURLToPath(import.meta.url));
// packages/engines/src/plane-strain -> racine repo 05-Plateforme (4 niveaux up).
const REPO_ROOT = resolve(here, '..', '..', '..', '..');

// Le solveur deformations planes vit dans le MEME HTML que le radier (GEOPLAQUE_V10).
const SOURCE_ENGINE_ID = 'radier-plaque';

function sourceRegistryEntry() {
  const entry = ENGINE_REGISTRY.find((e) => e.id === SOURCE_ENGINE_ID);
  if (!entry) throw new Error('Entree de registre "radier-plaque" introuvable.');
  return entry;
}

/** Localise le HTML source (GEOPLAQUE_V10.html) via le registre (source de verite unique). */
export function planeStrainSourcePath(): string {
  return resolve(REPO_ROOT, sourceRegistryEntry().cheminSource);
}

/** SHA-256 (hex) scelle au PV pour ce HTML (registre). */
export function planeStrainRegistrySha256(): string {
  return sourceRegistryEntry().sha256;
}

/** SHA-256 du HTML source LU sur disque (hex minuscule). */
export function planeStrainSourceSha256(): string {
  return createHash('sha256').update(readFileSync(planeStrainSourcePath())).digest('hex');
}

/**
 * Charge le HTML d'origine dans jsdom et renvoie une fonction `computeHtml` qui, pour
 * un etat + des options donnes, renseigne `state.layers`, appelle `solvePlaneStrain(opts)`
 * et renvoie l'objet `R` BRUT.
 *
 * @throws si le fichier source est absent (sources hors depot git en CI) — le test
 *   appelant doit alors SKIP BRUYAMMENT (jamais un faux-vert).
 * @throws ECHEC DUR si le SHA-256 du HTML lu != sha256 scelle au registre :
 *   on prouverait sinon l'equivalence contre un AUTRE moteur que celui scelle au PV.
 */
export function loadOriginalCompute(): {
  computeHtml: (input: PlaneStrainInput) => unknown;
  cleanup: () => void;
} {
  const buf = readFileSync(planeStrainSourcePath());
  const actualSha = createHash('sha256').update(buf).digest('hex');
  const expectedSha = planeStrainRegistrySha256();
  if (actualSha !== expectedSha) {
    throw new Error(
      `EQUIVALENCE INVALIDE : le SHA-256 du HTML source (${actualSha}) ne correspond ` +
        `PAS a la valeur scellee au registre (${expectedSha}). On testerait l'equivalence ` +
        `contre une version DIFFERENTE de celle scellee au PV. Mettre a jour le registre ` +
        `(sha256 + bump version) si l'evolution est voulue, OU restaurer la version canonique.`,
    );
  }
  const html = buf.toString('utf8');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    // pas de ressources externes (le HTML est mono-fichier) ; pas de reseau.
  });
  const win = dom.window as unknown as { eval: (code: string) => unknown };

  // Sanity : le HTML doit exposer solvePlaneStrain + la globale `state`.
  if (win.eval('typeof solvePlaneStrain') !== 'function') {
    throw new Error(
      "Le HTML d'origine n'expose pas solvePlaneStrain : structure du moteur modifiee ?",
    );
  }
  if (win.eval('typeof state') === 'undefined') {
    throw new Error("Le HTML d'origine n'expose pas la globale `state`.");
  }

  const computeHtml = (input: PlaneStrainInput): unknown => {
    // On renseigne `state.layers` (mutation du sous-tableau, pas de reassignation de
    // `state` lui-meme qui est `const`) puis on appelle solvePlaneStrain(opts) directement.
    const code = `
      (function(){
        state.layers = ${JSON.stringify(input.layers)};
        var __opts = ${JSON.stringify(input.opts)};
        var __err = null, __R = null;
        try { __R = solvePlaneStrain(__opts); } catch (e) { __err = e && e.message ? String(e.message) : 'Erreur de calcul'; }
        if (__err !== null) return JSON.stringify({ err: __err });
        return JSON.stringify(__R);
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
export function planeStrainSourceAvailable(): boolean {
  try {
    readFileSync(planeStrainSourcePath());
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
 * NB : les champs `w/p/M/V` du module sont des `Float64Array`. `JSON.stringify` les
 * serialise comme des OBJETS indexes ({"0":..}), pas comme des tableaux —
 * IDENTIQUEMENT cote HTML. `X` est un tableau simple des deux cotes. Apres jsonRoundTrip
 * + sanitize, les deux cotes ont la MEME forme. On compare a perimetre identique.
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
 * JSON) : `Infinity`/`NaN` y deviennent `null`, typed arrays -> objets indexes,
 * `undefined`/fonctions disparaissent. On impose au module la MEME transformation
 * AVANT comparaison — sinon ce serait un FAUX ecart.
 */
export function jsonRoundTrip(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}
