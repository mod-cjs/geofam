/**
 * Harnais d'EQUIVALENCE-PORTAGE terzaghi : HTML d'origine (jsdom) <-> module TS.
 *
 * Role : prouver que le module extrait (engine.ts) produit EXACTEMENT le meme
 * resultat BRUT que le moteur du HTML d'origine, sur un jeu d'entrees. C'est
 * l'arbitre du portage (cf. methode integrateur-moteurs) :
 *   - ecart present AUSSI dans le HTML d'origine  -> bug science (client/avenant) ;
 *   - ecart INTRODUIT par le portage              -> notre defaut d'integration.
 *
 * On compare le resultat BRUT (objet `R` complet : verdicts MAIS AUSSI tous les
 * intermediaires kp/ple/De/coefficients...), pas seulement la sortie whitelistee :
 * un harnais qui ne comparerait que les champs exposes laisserait passer une
 * derive sur un intermediaire. La whitelist protege la CONFIDENTIALITE (sortie
 * client) ; l'equivalence-portage se prouve sur le calcul ENTIER, cote serveur/test.
 *
 * IMPORTANT (confidentialite) : ce module est de l'OUTILLAGE DE TEST. Il lit le
 * HTML source via le systeme de fichiers (chemin du registre) et ne s'execute
 * qu'en test (jamais bundle). Il n'expose aucun symbole moteur au front.
 *
 * PORTEE HONNETE : prouve l'EQUIVALENCE DU PORTAGE (le module == l'origine), PAS
 * la JUSTESSE scientifique (qui attend le kit cas-tests STARFIRE — #36). Tag
 * @science-unsigned.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { JSDOM } from 'jsdom';

import { ENGINE_REGISTRY } from '../registry/registry.js';

const here = dirname(fileURLToPath(import.meta.url));
// packages/engines/src/terzaghi -> racine repo 05-Plateforme (4 niveaux up).
const REPO_ROOT = resolve(here, '..', '..', '..', '..');

/** Signature de la fonction moteur exposee par le HTML (computeAll). */
type ComputeAllFn = (state: unknown) => unknown;

/** Localise le HTML source terzaghi via le registre (source de verite unique). */
export function terzaghiSourcePath(): string {
  const entry = ENGINE_REGISTRY.find((e) => e.id === 'fondation-superficielle');
  if (!entry)
    throw new Error('Entree de registre "fondation-superficielle" introuvable.');
  return resolve(REPO_ROOT, entry.cheminSource);
}

/**
 * Charge le HTML d'origine dans jsdom, execute son script, et renvoie la fonction
 * `computeAll` de l'ORIGINE (window.computeAll). Le HTML separe le calcul du DOM ;
 * le bloc UI (`if(typeof document!=='undefined')`) s'execute au chargement mais
 * n'affecte pas la fonction pure `computeAll`.
 *
 * @throws si le fichier source est absent (sources hors depot git en CI) — le
 *   test appelant doit alors SKIP BRUYAMMENT (jamais un faux-vert).
 */
export function loadOriginalComputeAll(): {
  computeAll: ComputeAllFn;
  cleanup: () => void;
} {
  const html = readFileSync(terzaghiSourcePath(), 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    // pas de ressources externes (le HTML est mono-fichier) ; pas de reseau.
  });
  const win = dom.window as unknown as { computeAll?: unknown };
  const computeAll = win.computeAll;
  if (typeof computeAll !== 'function') {
    throw new Error(
      "Le HTML d'origine n'expose pas window.computeAll : structure du moteur modifiee ?",
    );
  }
  return {
    computeAll: computeAll as ComputeAllFn,
    cleanup: () => dom.window.close(),
  };
}

/**
 * Verifie si le HTML source est present localement (absent en CI : 03-Moteurs-client
 * hors depot git). Permet au test d'equivalence de SKIP BRUYAMMENT sans faux-vert.
 */
export function terzaghiSourceAvailable(): boolean {
  try {
    readFileSync(terzaghiSourcePath());
    return true;
  } catch {
    return false;
  }
}

/**
 * Normalise un resultat moteur BRUT en structure PURE comparable :
 *   - garde nombres (NaN/Infinity inclus : valeurs comparables legitimes),
 *     chaines, booleens, null ;
 *   - garde tableaux et objets simples (recursif) ;
 *   - SUPPRIME fonctions et `undefined` (non comparables / non sérialisables) en
 *     les omettant — de FACON IDENTIQUE des deux cotes, donc neutre pour l'ecart.
 *
 * On applique EXACTEMENT la meme normalisation a l'origine et au module : toute
 * difference subsistante est donc un vrai ecart de calcul, pas un artefact.
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
    return undefined; // omis par les conteneurs ci-dessous
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
