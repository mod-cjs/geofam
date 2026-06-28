/**
 * Harnais d'EQUIVALENCE-PORTAGE pressiometre : HTML d'origine (jsdom) <-> module TS.
 *
 * Role : prouver que le module extrait (engine.ts) produit EXACTEMENT le meme
 * resultat BRUT (`_res`) que le moteur du HTML d'origine, sur un jeu d'entrees.
 * C'est l'arbitre du portage (cf. methode integrateur-moteurs) :
 *   - ecart present AUSSI dans le HTML d'origine  -> bug science (client/avenant) ;
 *   - ecart INTRODUIT par le portage              -> notre defaut d'integration.
 *
 * --- PARTICULARITE PRESSIOMETRE (vs terzaghi/burmister) ---
 * Le HTML pressiometre n'expose PAS de fonction de calcul PURE. `calcDepth(idx)`
 * lit son etat dans la GLOBALE `depths[idx]` (declaree `let depths = []`, donc
 * REASSIGNABLE depuis un eval global) ET dans des CHAMPS DE SAISIE du DOM lus par
 * `getParams()` (p_a/p_ph/p_pe/p_v0/p_k0), `document.getElementById('p_gamma')` et
 * `nappeVal()` (p_nappe) ; la profondeur z vient de `parseFloat(d.label)`. Le
 * resultat est ECRIT dans `depths[idx]._res`. Pour piloter le calcul depuis le
 * test, on EVALUE un petit script DANS le contexte global de la fenetre jsdom : il
 * renseigne les CHAMPS DE SAISIE, REASSIGNE `depths`, appelle `calcDepth(0)`, et
 * renvoie `depths[0]._res` serialise. On NE TOUCHE PAS au HTML : on le pilote comme
 * l'UI le ferait.
 *
 * --- PIEGE D'UNITE (a) ---
 * `getParams()` du HTML fait `a = num('p_a', 0) / 10` (saisie cm³/MPa -> cm³/bar
 * interne). Nos fixtures portent `params.a` DEJA en cm³/bar (cf. contrat). Pour
 * piloter le HTML a l'identique, on renseigne donc le champ `p_a` avec
 * `params.a * 10` (sinon le HTML re-diviserait et l'equivalence echouerait : c'est
 * un FAUX ecart de portage qu'on previent ici, pas une correction de science).
 *
 * On compare le `_res` BRUT (tous champs : courbe corrigee, coefficients, pressions
 * de calage...), pas la sortie whitelistee : un harnais qui ne comparerait que les
 * champs exposes laisserait passer une derive sur un intermediaire. La whitelist
 * protege la CONFIDENTIALITE (sortie client) ; l'equivalence-portage se prouve sur
 * le calcul ENTIER, cote serveur/test.
 *
 * IMPORTANT (confidentialite) : ce module est de l'OUTILLAGE DE TEST. Il lit le
 * HTML source via le systeme de fichiers (chemin du registre) et ne s'execute qu'en
 * test (jamais bundle). Il n'expose aucun symbole moteur au front.
 *
 * PORTEE HONNETE : prouve l'EQUIVALENCE DU PORTAGE (le module == l'origine), PAS la
 * JUSTESSE scientifique (qui attend le kit cas-tests STARFIRE — #36). Tag
 * @science-unsigned.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { JSDOM } from 'jsdom';

import { ENGINE_REGISTRY } from '../registry/registry.js';

import type { PressiometreInput } from './contract.js';

const here = dirname(fileURLToPath(import.meta.url));
// packages/engines/src/pressiometre -> racine repo 05-Plateforme (4 niveaux up).
const REPO_ROOT = resolve(here, '..', '..', '..', '..');

/** Localise le HTML source pressiometre via le registre (source de verite unique). */
export function pressiometreSourcePath(): string {
  const entry = ENGINE_REGISTRY.find((e) => e.id === 'pressiometre-menard');
  if (!entry) throw new Error('Entree de registre "pressiometre-menard" introuvable.');
  return resolve(REPO_ROOT, entry.cheminSource);
}

/**
 * Charge le HTML d'origine dans jsdom et renvoie une fonction `computeHtml` qui,
 * pour un etat donne, pilote `calcDepth(0)` dans le contexte global de la fenetre
 * et renvoie l'objet `_res` BRUT (parse depuis sa serialisation JSON).
 *
 * @throws si le fichier source est absent (sources hors depot git en CI) — le test
 *   appelant doit alors SKIP BRUYAMMENT (jamais un faux-vert).
 */
export function loadOriginalCompute(): {
  computeHtml: (state: PressiometreInput) => unknown;
  cleanup: () => void;
} {
  const html = readFileSync(pressiometreSourcePath(), 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    // pas de ressources externes (le HTML est mono-fichier) ; pas de reseau.
  });
  const win = dom.window as unknown as { eval: (code: string) => unknown };

  // Sanity : le HTML doit exposer calcDepth + la globale `depths`.
  if (win.eval('typeof calcDepth') !== 'function') {
    throw new Error(
      "Le HTML d'origine n'expose pas calcDepth : structure du moteur modifiee ?",
    );
  }
  if (win.eval('typeof depths') === 'undefined') {
    throw new Error("Le HTML d'origine n'expose pas la globale `depths`.");
  }

  const computeHtml = (state: PressiometreInput): unknown => {
    const p = state.params;
    // Une seule profondeur pilotee a l'index 0. Selection manuelle des seuils via
    // pf_idx/plm_idx (parite : calcDepth lit d.pf_idx/d.plm_idx ; absents -> auto).
    const depthObj: Record<string, unknown> = {
      label: state.label,
      rows: state.rows,
    };
    if (state.pf_idx !== undefined) depthObj.pf_idx = state.pf_idx;
    if (state.plm_idx !== undefined) depthObj.plm_idx = state.plm_idx;

    // Champ p_a : on renseigne params.a * 10 car getParams() RE-DIVISE par 10
    // (saisie cm³/MPa -> cm³/bar). Les autres champs sont en unite interne directe.
    const code = `
      (function(){
        function setV(id, v){ var el = document.getElementById(id); if(el) el.value = String(v); }
        setV('p_a', ${p.a * 10});
        setV('p_ph', ${p.Ph});
        setV('p_pe', ${p.Pe});
        setV('p_v0', ${p.V0});
        setV('p_k0', ${p.k0});
        setV('p_gamma', ${state.gamma});
        setV('p_nappe', ${state.nappe});
        depths = ${JSON.stringify([depthObj])};
        var __err = null;
        try { calcDepth(0); } catch (e) { __err = e && e.message ? String(e.message) : 'Erreur de calcul'; }
        if (__err !== null) return JSON.stringify({ err: __err });
        // calcDepth ne pose _res que si >= 4 paliers valides ; sinon _res absent.
        if (depths[0] && depths[0]._res !== undefined) return JSON.stringify(depths[0]._res);
        return JSON.stringify({ err: 'Données insuffisantes : au moins 4 paliers de mesure requis.' });
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
export function pressiometreSourceAvailable(): boolean {
  try {
    readFileSync(pressiometreSourcePath());
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
 *     deux cotes (ex. `ext.recip.gen` est une fonction), donc neutre pour l'ecart.
 *
 * NB : l'aller-retour JSON cote HTML transforme deja `undefined`/`Infinity` en
 * absence/`null`. On applique la MEME normalisation au resultat module (via JSON
 * canonique) pour comparer a perimetre identique (cf. test d'equivalence).
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
