/**
 * Harnais d'EQUIVALENCE-PORTAGE radier : HTML d'origine (jsdom) <-> module TS.
 *
 * Role : prouver que le module extrait (engine.ts) produit EXACTEMENT le meme resultat
 * BRUT (l'objet `R` de `solveModel`) que le moteur du HTML d'origine, sur un jeu
 * d'entrees. C'est l'arbitre du portage sur l'ALGEBRE DENSE (ACM, souplesse N×N,
 * solveDense LU, inv) :
 *   - ecart present AUSSI dans le HTML d'origine  -> bug science (client/avenant) ;
 *   - ecart INTRODUIT par le portage              -> notre defaut d'integration.
 *
 * --- PARTICULARITE RADIER (solveModel non-pur, oriente globale + rendu) ---
 * Le HTML n'expose PAS de fonction de calcul pure : `solveModel(opts)` lit son etat
 * dans la GLOBALE `state` (rafts/pointLoads/lineLoads/areaLoads/pointSprings/
 * lineSprings/layers), et `doSolve()` lit `opts` dans le DOM puis DESSINE. Pour piloter
 * le calcul depuis le test, on EVALUE un script DANS le contexte global de la fenetre
 * jsdom qui :
 *   1. RENSEIGNE la globale `state` (rafts/loads/layers) depuis l'entree de fixture ;
 *   2. appelle DIRECTEMENT `solveModel(opts)` (on COURT-CIRCUITE `doSolve` : pas de
 *      lecture DOM, pas de dessin/timing — presentation pure, aucun effet sur `R`) ;
 *   3. renvoie `R` serialise.
 * On NE TOUCHE PAS au HTML : on appelle sa fonction de calcul comme le bouton le ferait,
 * en passant `opts` explicitement (au lieu de le laisser lire le DOM).
 *
 * --- PAS DE PIEGE D'UNITE ---
 * Le moteur radier ne re-divise/re-multiplie aucun champ a la lecture : pts en m, E en
 * MPa, e en m, zBase en m, charges en kN/kPa/(kN/ml), mesh en m. Les entrees de
 * fixtures sont dans les MEMES unites que `state`/`opts`.
 *
 * --- STABILITE NUMERIQUE (algebre dense) ---
 * Le module et le HTML executent LES MEMES operations dans LE MEME ordre (transcription
 * verbatim : ACM, assemblage, solveDense a pivot partiel, inv). Sur le MEME runtime V8,
 * les flottants doivent coincider. On compare le `R` BRUT (tous champs nodaux : w/p/
 * Mx/My/Mxy/tx/ty/slope/kr + diag) a une tolerance de PORTAGE serree. Si un micro-ecart
 * apparait, c'est a SIGNALER (effet d'ordre du pivot ?) AVANT de relacher la tolerance.
 *
 * IMPORTANT (confidentialite) : ce module est de l'OUTILLAGE DE TEST. Il lit le HTML
 * source via le systeme de fichiers (chemin du registre) et ne s'execute qu'en test.
 * Il n'expose aucun symbole moteur au front.
 *
 * PORTEE HONNETE : prouve l'EQUIVALENCE DU PORTAGE (module == origine), PAS la JUSTESSE
 * scientifique (kit cas-tests STARFIRE — #36). Tag @science-unsigned.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { JSDOM } from 'jsdom';

import { ENGINE_REGISTRY } from '../registry/registry.js';

import type { RadierInput } from './contract.js';

const here = dirname(fileURLToPath(import.meta.url));
// packages/engines/src/radier -> racine repo 05-Plateforme (4 niveaux up).
const REPO_ROOT = resolve(here, '..', '..', '..', '..');

const RADIER_ENGINE_ID = 'radier-plaque';

function radierRegistryEntry() {
  const entry = ENGINE_REGISTRY.find((e) => e.id === RADIER_ENGINE_ID);
  if (!entry) throw new Error('Entree de registre "radier-plaque" introuvable.');
  return entry;
}

/** Localise le HTML source radier via le registre (source de verite unique). */
export function radierSourcePath(): string {
  return resolve(REPO_ROOT, radierRegistryEntry().cheminSource);
}

/** SHA-256 (hex) scelle au PV pour ce moteur (registre). */
export function radierRegistrySha256(): string {
  return radierRegistryEntry().sha256;
}

/** SHA-256 du HTML source LU sur disque (hex minuscule). */
export function radierSourceSha256(): string {
  return createHash('sha256').update(readFileSync(radierSourcePath())).digest('hex');
}

/**
 * Charge le HTML d'origine dans jsdom et renvoie une fonction `computeHtml` qui, pour
 * un etat + des options donnes, renseigne la globale `state`, appelle `solveModel(opts)`
 * et renvoie l'objet `R` BRUT.
 *
 * @throws si le fichier source est absent (sources hors depot git en CI) — le test
 *   appelant doit alors SKIP BRUYAMMENT (jamais un faux-vert).
 * @throws ECHEC DUR si le SHA-256 du HTML lu != sha256 scelle au registre (cf. #48) :
 *   on prouverait sinon l'equivalence contre un AUTRE moteur que celui scelle au PV.
 */
export function loadOriginalCompute(): {
  computeHtml: (input: RadierInput) => unknown;
  cleanup: () => void;
} {
  const buf = readFileSync(radierSourcePath());
  const actualSha = createHash('sha256').update(buf).digest('hex');
  const expectedSha = radierRegistrySha256();
  if (actualSha !== expectedSha) {
    throw new Error(
      `EQUIVALENCE INVALIDE : le SHA-256 du HTML source radier (${actualSha}) ne ` +
        `correspond PAS a la valeur scellee au registre (${expectedSha}). On testerait ` +
        `l'equivalence contre une version DIFFERENTE de celle scellee au PV. Mettre a ` +
        `jour le registre (sha256 + bump version) si l'evolution est voulue, OU restaurer ` +
        `la version canonique. (#54)`,
    );
  }
  const html = buf.toString('utf8');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    // pas de ressources externes (le HTML est mono-fichier) ; pas de reseau.
  });
  const win = dom.window as unknown as { eval: (code: string) => unknown };

  // Sanity : le HTML doit exposer solveModel + la globale `state`.
  if (win.eval('typeof solveModel') !== 'function') {
    throw new Error(
      "Le HTML d'origine n'expose pas solveModel : structure du moteur modifiee ?",
    );
  }
  if (win.eval('typeof state') === 'undefined') {
    throw new Error("Le HTML d'origine n'expose pas la globale `state`.");
  }

  const computeHtml = (input: RadierInput): unknown => {
    // On renseigne la globale `state` (mutation des sous-tableaux, pas de reassignation
    // de `state` lui-meme qui est `const`) puis on appelle solveModel(opts) directement.
    const code = `
      (function(){
        state.rafts        = ${JSON.stringify(input.rafts)};
        state.pointLoads   = ${JSON.stringify(input.pointLoads ?? [])};
        state.lineLoads    = ${JSON.stringify(input.lineLoads ?? [])};
        state.areaLoads    = ${JSON.stringify(input.areaLoads ?? [])};
        state.pointSprings = ${JSON.stringify(input.pointSprings ?? [])};
        state.lineSprings  = ${JSON.stringify(input.lineSprings ?? [])};
        state.layers       = ${JSON.stringify(input.layers)};
        var __opts = ${JSON.stringify(input.opts)};
        var __err = null, __R = null;
        try { __R = solveModel(__opts); } catch (e) { __err = e && e.message ? String(e.message) : 'Erreur de calcul'; }
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
export function radierSourceAvailable(): boolean {
  try {
    readFileSync(radierSourcePath());
    return true;
  } catch {
    return false;
  }
}

/**
 * Normalise un resultat moteur BRUT en structure PURE comparable :
 *   - garde nombres (NaN/Infinity inclus), chaines, booleens, null ;
 *   - garde tableaux et objets simples (recursif) ;
 *   - SUPPRIME fonctions et `undefined` en les omettant — de FACON IDENTIQUE des deux
 *     cotes, donc neutre pour l'ecart.
 *
 * NB : les champs nodaux du module sont des `Float64Array`/`Int32Array` (typed arrays).
 * `JSON.stringify` les serialise comme des OBJETS indexes ({"0":..,"1":..}), pas comme
 * des tableaux — IDENTIQUEMENT cote HTML (qui produit aussi des typed arrays). Apres
 * jsonRoundTrip + sanitize, les deux cotes ont la MEME forme. On compare donc a
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
 * JSON) : `Infinity`/`NaN` y deviennent `null`, typed arrays -> objets indexes,
 * `undefined`/fonctions disparaissent. On impose au module la MEME transformation
 * AVANT comparaison — sinon ce serait un FAUX ecart.
 */
export function jsonRoundTrip(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}
