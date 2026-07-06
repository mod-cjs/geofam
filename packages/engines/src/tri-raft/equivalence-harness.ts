/**
 * Harnais d'EQUIVALENCE-PORTAGE radier TRIANGULAIRE : HTML d'origine (jsdom) <-> module TS.
 *
 * Role : prouver que le module extrait (engine.ts, `computeTriRaft`) produit EXACTEMENT
 * le meme resultat BRUT (l'objet `R` de `solveTriRaft`) que le moteur du HTML d'origine,
 * sur un jeu d'entrees. C'est l'arbitre du portage sur la CHAINE COMPLETE (mailleur
 * triangulaire ear-clipping + raffinement 1->4, element DKT, souplesse N×N, inv(C),
 * solveDense LU) :
 *   - ecart present AUSSI dans le HTML d'origine  -> bug science (client/avenant) ;
 *   - ecart INTRODUIT par le portage              -> notre defaut d'integration.
 *
 * --- PARTICULARITE (solveTriRaft non-pur, oriente globale + rendu) ---
 * Le HTML n'expose PAS de fonction de calcul pure : `solveTriRaft(o)` lit son etat dans
 * la GLOBALE `state` (rafts/pointLoads/lineLoads/areaLoads/layers), et le handler
 * `tri-run.onclick` lit `o` dans le DOM puis DESSINE (triMeshSvg). Pour piloter le calcul
 * depuis le test, on EVALUE un script DANS le contexte global de la fenetre jsdom qui :
 *   1. RENSEIGNE la globale `state` depuis l'entree de fixture ;
 *   2. appelle DIRECTEMENT `solveTriRaft(o)` (on COURT-CIRCUITE le handler : pas de
 *      lecture DOM, pas de dessin — presentation pure, aucun effet sur `R`) ;
 *   3. renvoie `R` serialise.
 * On NE TOUCHE PAS au HTML : on appelle sa fonction de calcul comme le bouton le ferait,
 * en passant `o` explicitement (au lieu de le laisser lire le DOM).
 *
 * --- SOURCE PARTAGEE AVEC LE RADIER ACM ---
 * `solveTriRaft` vit dans le MEME fichier que `solveModel` (GEOPLAQUE_V10.html). On
 * reutilise donc l'entree de registre `radier-plaque` (meme cheminSource + meme sha256) :
 * aucune modification du registre. Le SHA-256 lu sur disque doit correspondre EXACTEMENT
 * a la valeur scellee (echec dur sinon) — sinon on prouverait l'equivalence contre une
 * AUTRE version du HTML que celle scellee au PV.
 *
 * --- STABILITE NUMERIQUE (algebre dense) ---
 * Le module et le HTML executent LES MEMES operations dans LE MEME ordre (transcription
 * verbatim). Sur le MEME runtime V8, les flottants coincident. On compare le `R` BRUT
 * (P/tris/w/p + scalaires) a une tolerance de PORTAGE serree (rel 1e-9). Un micro-ecart
 * est a SIGNALER avant de relacher la tolerance.
 *
 * IMPORTANT (confidentialite) : ce module est de l'OUTILLAGE DE TEST. Il lit le HTML
 * source via le systeme de fichiers (chemin du registre) et ne s'execute qu'en test.
 * Il n'expose aucun symbole moteur au front.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { JSDOM } from 'jsdom';

import { ENGINE_REGISTRY } from '../registry/registry.js';

import type { TriRaftInput } from './contract.js';

const here = dirname(fileURLToPath(import.meta.url));
// packages/engines/src/tri-raft -> racine repo 05-Plateforme (4 niveaux up).
const REPO_ROOT = resolve(here, '..', '..', '..', '..');

// solveTriRaft et solveModel partagent le MEME fichier (GEOPLAQUE_V10.html) -> on
// reutilise l'entree de registre 'radier-plaque' (source de verite : cheminSource+sha256).
const SHARED_ENGINE_ID = 'radier-plaque';

function triRaftRegistryEntry() {
  const entry = ENGINE_REGISTRY.find((e) => e.id === SHARED_ENGINE_ID);
  if (!entry) throw new Error('Entree de registre "radier-plaque" introuvable.');
  return entry;
}

/** Localise le HTML source (GEOPLAQUE_V10) via le registre. */
export function triRaftSourcePath(): string {
  return resolve(REPO_ROOT, triRaftRegistryEntry().cheminSource);
}

/** SHA-256 (hex) scelle au registre pour ce moteur (partage avec le radier ACM). */
export function triRaftRegistrySha256(): string {
  return triRaftRegistryEntry().sha256;
}

/** SHA-256 du HTML source LU sur disque (hex minuscule). */
export function triRaftSourceSha256(): string {
  return createHash('sha256').update(readFileSync(triRaftSourcePath())).digest('hex');
}

/**
 * Charge le HTML d'origine dans jsdom et renvoie une fonction `computeHtml` qui, pour
 * un etat + des options donnes, renseigne la globale `state`, appelle `solveTriRaft(o)`
 * et renvoie l'objet `R` BRUT.
 *
 * @throws si le fichier source est absent (sources hors depot git en CI) — le test
 *   appelant doit alors SKIP BRUYAMMENT (jamais un faux-vert).
 * @throws ECHEC DUR si le SHA-256 du HTML lu != sha256 scelle au registre : on
 *   prouverait sinon l'equivalence contre un AUTRE moteur que celui scelle au PV.
 */
export function loadOriginalCompute(): {
  computeHtml: (input: TriRaftInput) => unknown;
  cleanup: () => void;
} {
  const buf = readFileSync(triRaftSourcePath());
  const actualSha = createHash('sha256').update(buf).digest('hex');
  const expectedSha = triRaftRegistrySha256();
  if (actualSha !== expectedSha) {
    throw new Error(
      `EQUIVALENCE INVALIDE : le SHA-256 du HTML source (${actualSha}) ne correspond ` +
        `PAS a la valeur scellee au registre (${expectedSha}). On testerait ` +
        `l'equivalence contre une version DIFFERENTE de celle scellee au PV. Mettre a ` +
        `jour le registre (sha256 + bump version) si l'evolution est voulue, OU ` +
        `restaurer la version canonique.`,
    );
  }
  const html = buf.toString('utf8');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    // pas de ressources externes (le HTML est mono-fichier) ; pas de reseau.
  });
  const win = dom.window as unknown as { eval: (code: string) => unknown };

  // Sanity : le HTML doit exposer solveTriRaft + la globale `state`.
  if (win.eval('typeof solveTriRaft') !== 'function') {
    throw new Error(
      "Le HTML d'origine n'expose pas solveTriRaft : structure du moteur modifiee ?",
    );
  }
  if (win.eval('typeof state') === 'undefined') {
    throw new Error("Le HTML d'origine n'expose pas la globale `state`.");
  }

  const computeHtml = (input: TriRaftInput): unknown => {
    // On renseigne la globale `state` (mutation des sous-tableaux) puis on appelle
    // solveTriRaft(o) directement. Ce solveur ne lit que rafts/pointLoads/lineLoads/
    // areaLoads/layers ; on renseigne aussi pointSprings/lineSprings vides par prudence.
    const code = `
      (function(){
        state.rafts        = ${JSON.stringify(input.rafts)};
        state.pointLoads   = ${JSON.stringify(input.pointLoads ?? [])};
        state.lineLoads    = ${JSON.stringify(input.lineLoads ?? [])};
        state.areaLoads    = ${JSON.stringify(input.areaLoads ?? [])};
        state.pointSprings = [];
        state.lineSprings  = [];
        state.layers       = ${JSON.stringify(input.layers)};
        var __o = ${JSON.stringify(input.opts)};
        var __err = null, __R = null;
        try { __R = solveTriRaft(__o); } catch (e) { __err = e && e.message ? String(e.message) : 'Erreur de calcul'; }
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
export function triRaftSourceAvailable(): boolean {
  try {
    readFileSync(triRaftSourcePath());
    return true;
  } catch {
    return false;
  }
}

/**
 * Normalise un resultat moteur BRUT en structure PURE comparable (identique cote HTML
 * et module) : garde nombres/chaines/booleens/null, tableaux et objets simples ;
 * SUPPRIME fonctions et `undefined`. Les typed arrays (w/p) sont serialises par
 * JSON.stringify en objets indexes des DEUX cotes -> perimetre identique.
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
 * JSON) : `Infinity`/`NaN` -> `null`, typed arrays -> objets indexes, `undefined`/
 * fonctions disparaissent. On impose au module la MEME transformation AVANT comparaison.
 */
export function jsonRoundTrip(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}
