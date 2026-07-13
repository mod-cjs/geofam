/**
 * Harnais d'EQUIVALENCE-PORTAGE burmister : HTML d'origine (jsdom) <-> module TS.
 *
 * Role : prouver que le module extrait (engine.ts) produit EXACTEMENT le meme
 * resultat BRUT (objet `_D`) que le moteur du HTML d'origine, sur un jeu
 * d'entrees. C'est l'arbitre du portage (cf. methode integrateur-moteurs) :
 *   - ecart present AUSSI dans le HTML d'origine  -> bug science (client/avenant) ;
 *   - ecart INTRODUIT par le portage              -> notre defaut d'integration.
 *
 * --- PARTICULARITE BURMISTER (vs terzaghi) ---
 * Le HTML burmister n'expose PAS de fonction de calcul PURE. `doCalc()` lit son
 * etat dans des VARIABLES GLOBALES lexicales (`ly`, `pf`, `tr`, `cp`) declarees
 * en `let` (donc NON accrochees a `window`) et le referentiel `M` (`const`),
 * calcule, puis ECRIT le resultat dans la globale `_D` (`var`, accrochee a
 * window). Pour piloter le calcul depuis le test, on EVALUE un petit script DANS
 * le contexte global de la fenetre jsdom : il REASSIGNE les bindings `let`
 * (accessibles en ecriture depuis un eval global), appelle `doCalc()`, et renvoie
 * `_D` serialise. On NE TOUCHE PAS au HTML : on le pilote comme l'UI le ferait.
 *
 * On compare le `_D` BRUT (tous champs, intermediaires compris : contraintes,
 * coefficients de fatigue...), pas la sortie whitelistee : un harnais qui ne
 * comparerait que les champs exposes laisserait passer une derive sur un
 * intermediaire. La whitelist protege la CONFIDENTIALITE (sortie client) ;
 * l'equivalence-portage se prouve sur le calcul ENTIER, cote serveur/test.
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

import type { BurmisterInput } from './contract.js';

const here = dirname(fileURLToPath(import.meta.url));
// packages/engines/src/burmister -> racine repo 05-Plateforme (4 niveaux up).
const REPO_ROOT = resolve(here, '..', '..', '..', '..');

/** Localise le HTML source burmister via le registre (source de verite unique). */
export function burmisterSourcePath(): string {
  const entry = ENGINE_REGISTRY.find((e) => e.id === 'chaussee-burmister');
  if (!entry) throw new Error('Entree de registre "chaussee-burmister" introuvable.');
  return resolve(REPO_ROOT, entry.cheminSource);
}

/**
 * Charge le HTML d'origine dans jsdom et renvoie une fonction `computeHtml` qui,
 * pour un etat donne, pilote `doCalc()` dans le contexte global de la fenetre et
 * renvoie l'objet `_D` BRUT (parse depuis sa serialisation JSON).
 *
 * @throws si le fichier source est absent (sources hors depot git en CI) — le
 *   test appelant doit alors SKIP BRUYAMMENT (jamais un faux-vert).
 */
export function loadOriginalCompute(): {
  computeHtml: (state: BurmisterInput) => unknown;
  cleanup: () => void;
} {
  const html = readFileSync(burmisterSourcePath(), 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    // pas de ressources externes (le HTML est mono-fichier) ; pas de reseau.
  });
  const win = dom.window as unknown as { eval: (code: string) => unknown };

  // Sanity : le HTML doit exposer doCalc + l'etat lexical attendu.
  if (win.eval('typeof doCalc') !== 'function') {
    throw new Error(
      "Le HTML d'origine n'expose pas doCalc : structure du moteur modifiee ?",
    );
  }

  const computeHtml = (state: BurmisterInput): unknown => {
    // CALIBRATION VERROUILLEE : le referentiel n'est plus un champ d'entree (fige a
    // AGEROUTE_MATERIALS_DEFINITIVE cote module — table unique, ADR 0013). On garde
    // le `M` d'usine du HTML pilote, qui EST cette meme table definitive (le registre
    // pointe desormais la reference definitive) — les deux cotes utilisent la meme
    // table, ce qui renforce l'equivalence-portage.
    // doCalc appelle renderRes/renderDetails (DOM) : ils s'executent sur la page
    // jsdom complete (sans effet sur _D, deja calcule avant). On capture _D.
    const code = `
      ly = ${JSON.stringify(state.layers)};
      pf = ${JSON.stringify(state.subgrade)};
      tr = ${JSON.stringify(state.traffic)};
      cp = ${JSON.stringify(state.load)};
      let __err = null;
      try { doCalc(); } catch (e) { __err = e && e.message ? String(e.message) : 'Erreur de calcul'; }
      __err !== null ? JSON.stringify({ err: __err }) : JSON.stringify(_D);
    `;
    return JSON.parse(win.eval(code) as string);
  };

  return { computeHtml, cleanup: () => dom.window.close() };
}

/**
 * Verifie si le HTML source est present localement (absent en CI : 03-Moteurs-client
 * hors depot git). Permet au test d'equivalence de SKIP BRUYAMMENT sans faux-vert.
 */
export function burmisterSourceAvailable(): boolean {
  try {
    readFileSync(burmisterSourcePath());
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
 *   - SUPPRIME fonctions et `undefined` en les omettant — de FACON IDENTIQUE des
 *     deux cotes, donc neutre pour l'ecart.
 *
 * NB : l'aller-retour JSON cote HTML transforme deja `undefined`/`Infinity` en
 * absence/`null`. On applique la MEME normalisation au resultat module (via
 * JSON canonique) pour comparer a periметre identique (cf. test d'equivalence).
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

/**
 * Passe le resultat MODULE par le MEME tube de serialisation que le HTML
 * (JSON.stringify -> JSON.parse). Le HTML traverse cet aller-retour (le harnais
 * recoit du JSON) : `Infinity`/`NaN` y deviennent `null`, `undefined`/fonctions y
 * disparaissent. Pour comparer A PERIMETRE IDENTIQUE, on impose au module la meme
 * transformation AVANT comparaison — sinon un `Infinity` cote module (numerique)
 * vs `null` cote HTML serait un FAUX ecart de portage.
 */
export function jsonRoundTrip(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}
