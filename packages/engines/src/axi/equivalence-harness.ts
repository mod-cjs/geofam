/**
 * Harnais d'EQUIVALENCE-PORTAGE axisymetrique : HTML d'origine (jsdom) <-> module TS.
 *
 * Role : prouver que le module extrait (engine.ts) produit EXACTEMENT le meme resultat
 * BRUT (l'objet `R` de `solveAxi`) que le moteur du HTML d'origine, sur un jeu d'entrees.
 * C'est l'arbitre du portage sur l'ALGEBRE DENSE (souplesse nn×nn par integration
 * radiale de Boussinesq, element annulaire de Kirchhoff, inv, solveDense LU) :
 *   - ecart present AUSSI dans le HTML d'origine  -> bug science (client/avenant) ;
 *   - ecart INTRODUIT par le portage              -> notre defaut d'integration.
 *
 * --- PARTICULARITE (solveAxi lit une globale + est branche a l'UI) ---
 * Le HTML n'expose PAS de fonction de calcul pure : `solveAxi(o)` lit les couches dans la
 * GLOBALE `state.layers`, et `o` (R/e/E/nu/q/Pc/ne/foundD) est lu depuis des CHAMPS DE
 * SAISIE par le handler `#ax-run`, qui DESSINE ensuite (statistiques + `axiPlot`, avec un
 * `×1000` d'affichage). Pour piloter le calcul depuis le test, on EVALUE un script DANS le
 * contexte global de la fenetre jsdom qui :
 *   1. RENSEIGNE la globale `state.layers` depuis l'entree de fixture ;
 *   2. appelle DIRECTEMENT `solveAxi(o)` (on COURT-CIRCUITE le handler `#ax-run` : pas de
 *      lecture DOM, pas de dessin, pas de `×1000` de rendu — aucun effet sur `R`) ;
 *   3. renvoie `R` serialise.
 * On NE TOUCHE PAS au HTML : on appelle sa fonction de calcul comme le bouton le ferait,
 * en passant `o` explicitement (au lieu de le laisser lire le DOM).
 *
 * --- PAS DE PIEGE D'UNITE DANS LE SOLVEUR ---
 * `solveAxi` ne re-divise/re-multiplie aucun champ : R/e en m, E/nu tels quels, q/Pc tels
 * quels, layers tels quels. Le `×1000` du HTML vit UNIQUEMENT dans l'affichage (`R.wc*1000`
 * dans le handler / `axiPlot`), JAMAIS dans `solveAxi`. On compare le `R` BRUT (w en unite
 * solveur) des deux cotes -> aucune conversion a appliquer, aucun faux ecart.
 *
 * --- SOURCE / SHA (meme fichier que le radier) ---
 * `solveAxi` vit dans le MEME HTML que `solveModel` (radier) : GEOPLAQUE_V10.html. On
 * reutilise donc l'entree de registre `radier-plaque` (cheminSource + sha256) comme source
 * de verite unique. VERIFICATION DURE du SHA-256 : on prouverait sinon l'equivalence
 * contre une version DIFFERENTE de celle scellee au PV.
 *
 * PORTEE HONNETE : prouve l'EQUIVALENCE DU PORTAGE (module == origine). La justesse
 * scientifique est validee cote STARFIRE (science signee).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { JSDOM } from 'jsdom';

import { ENGINE_REGISTRY } from '../registry/registry.js';

import type { AxiInput } from './contract.js';

const here = dirname(fileURLToPath(import.meta.url));
// packages/engines/src/axi -> racine repo 05-Plateforme (4 niveaux up).
const REPO_ROOT = resolve(here, '..', '..', '..', '..');

// solveAxi partage le HTML source du radier (meme fichier GEOPLAQUE_V10.html).
const SOURCE_ENGINE_ID = 'radier-plaque';

function sourceRegistryEntry() {
  const entry = ENGINE_REGISTRY.find((e) => e.id === SOURCE_ENGINE_ID);
  if (!entry)
    throw new Error(`Entree de registre "${SOURCE_ENGINE_ID}" introuvable (source axi).`);
  return entry;
}

/** Localise le HTML source (GEOPLAQUE_V10.html) via le registre. */
export function axiSourcePath(): string {
  return resolve(REPO_ROOT, sourceRegistryEntry().cheminSource);
}

/** SHA-256 (hex) scelle au registre pour ce HTML. */
export function axiRegistrySha256(): string {
  return sourceRegistryEntry().sha256;
}

/** SHA-256 du HTML source LU sur disque (hex minuscule). */
export function axiSourceSha256(): string {
  return createHash('sha256').update(readFileSync(axiSourcePath())).digest('hex');
}

/**
 * Charge le HTML d'origine dans jsdom et renvoie une fonction `computeHtml` qui, pour un
 * etat de sol + des parametres donnes, renseigne la globale `state.layers`, appelle
 * `solveAxi(o)` et renvoie l'objet `R` BRUT.
 *
 * @throws si le fichier source est absent (sources hors depot git en CI) — le test
 *   appelant doit alors SKIP BRUYAMMENT (jamais un faux-vert).
 * @throws ECHEC DUR si le SHA-256 du HTML lu != sha256 scelle au registre : on prouverait
 *   sinon l'equivalence contre un AUTRE moteur que celui scelle au PV.
 */
export function loadOriginalCompute(): {
  computeHtml: (input: AxiInput) => unknown;
  cleanup: () => void;
} {
  const buf = readFileSync(axiSourcePath());
  const actualSha = createHash('sha256').update(buf).digest('hex');
  const expectedSha = axiRegistrySha256();
  if (actualSha !== expectedSha) {
    throw new Error(
      `EQUIVALENCE INVALIDE : le SHA-256 du HTML source (${actualSha}) ne correspond PAS ` +
        `a la valeur scellee au registre (${expectedSha}). On testerait l'equivalence ` +
        `contre une version DIFFERENTE de celle scellee au PV. Mettre a jour le registre ` +
        `(sha256 + bump version) si l'evolution est voulue, OU restaurer la version ` +
        `canonique.`,
    );
  }
  const html = buf.toString('utf8');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    // pas de ressources externes (le HTML est mono-fichier) ; pas de reseau.
  });
  const win = dom.window as unknown as { eval: (code: string) => unknown };

  // Sanity : le HTML doit exposer solveAxi + la globale `state`.
  if (win.eval('typeof solveAxi') !== 'function') {
    throw new Error(
      "Le HTML d'origine n'expose pas solveAxi : structure du moteur modifiee ?",
    );
  }
  if (win.eval('typeof state') === 'undefined') {
    throw new Error("Le HTML d'origine n'expose pas la globale `state`.");
  }

  const computeHtml = (input: AxiInput): unknown => {
    // On renseigne la globale `state.layers` (mutation du sous-tableau, pas de
    // reassignation de `state` lui-meme qui est `const`) puis on appelle solveAxi(o)
    // directement — en court-circuitant le handler `#ax-run` (lecture DOM + dessin).
    const code = `
      (function(){
        state.layers = ${JSON.stringify(input.layers)};
        var __o = ${JSON.stringify(input.o)};
        var __err = null, __R = null;
        try { __R = solveAxi(__o); } catch (e) { __err = e && e.message ? String(e.message) : 'Erreur de calcul'; }
        if (__err !== null) return JSON.stringify({ err: __err });
        return JSON.stringify(__R);
      })()
    `;
    return JSON.parse(win.eval(code) as string);
  };

  return { computeHtml, cleanup: () => dom.window.close() };
}

/**
 * Verifie si le HTML source est present localement (absent en CI : 03-Moteurs-client hors
 * depot git). Permet au test d'equivalence de SKIP BRUYAMMENT sans faux-vert.
 */
export function axiSourceAvailable(): boolean {
  try {
    readFileSync(axiSourcePath());
    return true;
  } catch {
    return false;
  }
}

/**
 * Normalise un resultat moteur BRUT en structure PURE comparable (recursif) :
 *   - garde nombres (NaN/Infinity inclus), chaines, booleens, null ;
 *   - garde tableaux et objets simples ;
 *   - SUPPRIME fonctions et `undefined` de FACON IDENTIQUE des deux cotes.
 *
 * NB : les champs nodaux du module sont des `Float64Array` (typed arrays). `JSON.stringify`
 * les serialise comme des OBJETS indexes ({"0":..}), IDENTIQUEMENT cote HTML (aussi des
 * typed arrays). `r` est un `Array` des deux cotes. Apres jsonRoundTrip + sanitize, les
 * deux cotes ont la MEME forme -> on compare a perimetre identique.
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
 * Passe le resultat MODULE par le MEME tube de serialisation que le HTML (JSON.stringify ->
 * JSON.parse). Le HTML traverse cet aller-retour (l'eval renvoie du JSON) : `Infinity`/`NaN`
 * -> `null`, typed arrays -> objets indexes. On impose au module la MEME transformation
 * AVANT comparaison — sinon ce serait un FAUX ecart.
 */
export function jsonRoundTrip(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}
