/**
 * Harnais d'EQUIVALENCE-PORTAGE pieux : HTML d'origine (jsdom) <-> module TS.
 *
 * Role : prouver que le module extrait (engine.ts) produit EXACTEMENT le meme
 * resultat BRUT (l'objet `R`) que le moteur du HTML d'origine, sur un jeu d'entrees.
 * C'est l'arbitre du portage (cf. methode integrateur-moteurs) :
 *   - ecart present AUSSI dans le HTML d'origine  -> bug science (client/avenant) ;
 *   - ecart INTRODUIT par le portage              -> notre defaut d'integration.
 *
 * --- PARTICULARITE PIEUX (compute() non-pur, oriente rendu) ---
 * Le HTML pieux n'expose PAS de fonction de calcul PURE. `compute()` lit son etat
 * dans des CHAMPS DE SAISIE du DOM (`num('g_D')`, `num('c_G')`, coefficients
 * editables...), la GLOBALE `state` (section/sens/meth/da/essais/layers/cpt) et
 * `curPile()` (catalogue PILES selon `g_pieu`), puis APPELLE `renderResults(R)` +
 * des fonctions de DESSIN (drawCoupe/drawQcLog/drawBeton/drawPortance). Pour piloter
 * le calcul depuis le test, on EVALUE un script DANS le contexte global de la fenetre
 * jsdom qui :
 *   1. INTERCEPTE `renderResults` (capture l'argument `R`, l'objet de resultat brut) ;
 *   2. NEUTRALISE les fonctions de DESSIN et `betonCheck`/`drawBeton`/`drawPortance`
 *      (PRESENTATION pure, aucun effet sur `R` ; on evite ainsi tout acces SVG/DOM
 *      annexe) ;
 *   3. renseigne les CHAMPS DE SAISIE + la globale `state` (+ la selection de pieu) ;
 *   4. appelle `compute()` et renvoie `R` serialise.
 * On NE TOUCHE PAS au HTML : on le pilote comme l'UI le ferait (clic « Calculer »).
 *
 * --- PAS DE PIEGE D'UNITE (contrairement a pressiometre) ---
 * Le moteur pieux ne re-divise/re-multiplie aucun champ a la lecture (`num('id')`
 * renvoie la valeur telle quelle). Les entrees de fixtures sont donc dans les MEMES
 * unites que les champs DOM. Seul point d'attention : les coefficients EDITABLES
 * (k_*, cr_*) ont des `value=` par defaut dans le HTML ; on les renseigne
 * EXPLICITEMENT depuis `state.coeffs` pour piloter le HTML a l'identique du module.
 *
 * On compare l'objet `R` BRUT (tous champs : detail de frottement par couche `fric`,
 * facteurs de portance, courbe de tassement, qbDetail...), pas la sortie whitelistee :
 * un harnais qui ne comparerait que les champs exposes laisserait passer une derive
 * sur un intermediaire. La whitelist protege la CONFIDENTIALITE (sortie client) ;
 * l'equivalence-portage se prouve sur le calcul ENTIER, cote serveur/test.
 *
 * IMPORTANT (confidentialite) : ce module est de l'OUTILLAGE DE TEST. Il lit le HTML
 * source via le systeme de fichiers (chemin du registre) et ne s'execute qu'en test
 * (jamais bundle). Il n'expose aucun symbole moteur au front.
 *
 * PORTEE HONNETE : prouve l'EQUIVALENCE DU PORTAGE (le module == l'origine), PAS la
 * JUSTESSE scientifique (qui attend le kit cas-tests STARFIRE — #36). Tag
 * @science-unsigned.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { JSDOM } from 'jsdom';

import { ENGINE_REGISTRY } from '../registry/registry.js';

import type { PieuxInput } from './contract.js';

const here = dirname(fileURLToPath(import.meta.url));
// packages/engines/src/pieux -> racine repo 05-Plateforme (4 niveaux up).
const REPO_ROOT = resolve(here, '..', '..', '..', '..');

const PIEUX_ENGINE_ID = 'fondation-profonde-pieux';

/** Entree de registre pieux (source de verite unique : chemin + sha256 scelle). */
function pieuxRegistryEntry() {
  const entry = ENGINE_REGISTRY.find((e) => e.id === PIEUX_ENGINE_ID);
  if (!entry)
    throw new Error('Entree de registre "fondation-profonde-pieux" introuvable.');
  return entry;
}

/** Localise le HTML source pieux via le registre (source de verite unique). */
export function pieuxSourcePath(): string {
  return resolve(REPO_ROOT, pieuxRegistryEntry().cheminSource);
}

/** SHA-256 (hex) scelle au PV pour ce moteur (registre). */
export function pieuxRegistrySha256(): string {
  return pieuxRegistryEntry().sha256;
}

/**
 * SHA-256 du HTML source LU sur disque (hex minuscule). Sert a prouver qu'on teste
 * l'equivalence contre LA version exacte scellee au registre, pas un autre moteur.
 */
export function pieuxSourceSha256(): string {
  return createHash('sha256').update(readFileSync(pieuxSourcePath())).digest('hex');
}

/**
 * Charge le HTML d'origine dans jsdom et renvoie une fonction `computeHtml` qui,
 * pour un etat donne, pilote `compute()` dans le contexte global de la fenetre
 * (en interceptant `renderResults` pour capturer `R`) et renvoie l'objet `R` BRUT.
 *
 * @throws si le fichier source est absent (sources hors depot git en CI) — le test
 *   appelant doit alors SKIP BRUYAMMENT (jamais un faux-vert).
 * @throws ECHEC DUR si le SHA-256 du HTML lu != sha256 scelle au registre (MINEUR-1
 *   du challenge #48) : on prouverait sinon l'equivalence contre un AUTRE moteur que
 *   celui scelle au PV. Ce n'est PAS un skip — c'est une erreur (la version source a
 *   change sans bump du registre, ou un mauvais fichier est en place).
 */
export function loadOriginalCompute(): {
  computeHtml: (state: PieuxInput) => unknown;
  cleanup: () => void;
} {
  const buf = readFileSync(pieuxSourcePath());
  const actualSha = createHash('sha256').update(buf).digest('hex');
  const expectedSha = pieuxRegistrySha256();
  if (actualSha !== expectedSha) {
    throw new Error(
      `EQUIVALENCE INVALIDE : le SHA-256 du HTML source pieux (${actualSha}) ne ` +
        `correspond PAS a la valeur scellee au registre (${expectedSha}). On testerait ` +
        `l'equivalence contre une version DIFFERENTE de celle scellee au PV. ` +
        `Mettre a jour le registre (sha256 + bump version) si l'evolution est voulue, ` +
        `OU restaurer la version canonique. (MINEUR-1 #48)`,
    );
  }
  const html = buf.toString('utf8');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    // pas de ressources externes (le HTML est mono-fichier) ; pas de reseau.
  });
  const win = dom.window as unknown as { eval: (code: string) => unknown };

  // Sanity : le HTML doit exposer compute + renderResults + la globale `state`.
  if (win.eval('typeof compute') !== 'function') {
    throw new Error(
      "Le HTML d'origine n'expose pas compute : structure du moteur modifiee ?",
    );
  }
  if (win.eval('typeof renderResults') !== 'function') {
    throw new Error("Le HTML d'origine n'expose pas renderResults.");
  }
  if (win.eval('typeof state') === 'undefined') {
    throw new Error("Le HTML d'origine n'expose pas la globale `state`.");
  }

  const computeHtml = (s: PieuxInput): unknown => {
    const g = s.geom;
    const c = s.coeffs;
    // Selection du pieu : le HTML lit `parseInt($('g_pieu').value)` dans curPile().
    // Les fixtures ne dependent que de `cat` ; on s'assure que l'<option> existe
    // (initPiles l'a peuplee) puis on pose la valeur.
    const code = `
      (function(){
        function setV(id, v){ var el = document.getElementById(id); if(el){ el.value = String(v); } }
        // 1. INTERCEPTION : capturer R, neutraliser le rendu/dessin (presentation).
        var __captured = null;
        renderResults = function(R){ __captured = R; };
        drawCoupe = function(){};
        if (typeof drawQcLog === 'function') drawQcLog = function(){};
        if (typeof drawBeton === 'function') drawBeton = function(){};
        if (typeof drawPortance === 'function') drawPortance = function(){};
        if (typeof betonCheck === 'function') betonCheck = function(){ return { na:true }; };

        // 2. CHAMPS DE SAISIE (geometrie, charges, options, coefficients editables).
        setV('g_pieu', ${s.cat});
        setV('g_B', ${g.g_B ?? ''});
        setV('g_b2', ${g.g_b2 ?? ''});
        setV('g_Ap', ${g.g_Ap ?? ''});
        setV('g_P', ${g.g_P ?? ''});
        setV('g_z0', ${s.g_z0});
        setV('g_D', ${s.g_D});
        setV('c_G', ${s.c_G});
        setV('c_Q', ${s.c_Q});
        setV('o_nappe', ${s.o_nappe});
        setV('o_nprofil', ${s.o_nprofil});
        setV('o_surf', ${s.o_surf});
        setV('o_redis', ${JSON.stringify(s.o_redis)});
        setV('grp_n', ${s.grp.grp_n});
        setV('grp_m', ${s.grp.grp_m});
        setV('grp_s', ${s.grp.grp_s});
        // NB (MINEUR-4 #48) : b_fck (resistance beton) n'est lu QUE par betonCheck(),
        // une verification de PRESENTATION (resistance structurale du fut) — qu'on a
        // NEUTRALISEE ci-dessus (betonCheck -> {na:true}). Il n'entre PAS dans l'objet
        // R (le calcul de portance). On ne le renseigne donc PAS : sa valeur est sans
        // effet sur l'equivalence (prouve par le test « b_fck neutre » cote module,
        // qui n'expose meme pas ce champ).
        setV('k_gb', ${c.k_gb}); setV('k_gs', ${c.k_gs}); setV('k_gst', ${c.k_gst});
        setV('k_psi2', ${c.k_psi2});
        setV('cr_b_b', ${c.cr_b_b}); setV('cr_b_s', ${c.cr_b_s});
        setV('cr_f_b', ${c.cr_f_b}); setV('cr_f_s', ${c.cr_f_s});
        setV('cr_car', ${c.cr_car}); setV('cr_qp', ${c.cr_qp});
        setV('cr_car_t', ${c.cr_car_t}); setV('cr_qp_t', ${c.cr_qp_t});

        // 3. GLOBALE state (section/sens/meth/da/essais/layers/cpt).
        state.section = ${JSON.stringify(g.section)};
        state.sens = ${JSON.stringify(s.sens)};
        state.meth = ${JSON.stringify(s.meth)};
        state.da = ${JSON.stringify(s.da)};
        state.essais = ${JSON.stringify(s.essais)};
        state.layers = ${JSON.stringify(s.layers)};
        state.cpt = ${JSON.stringify(s.cpt)};

        // 4. CALCUL (R capture par renderResults intercepte).
        var __err = null;
        try { compute(); } catch (e) { __err = e && e.message ? String(e.message) : 'Erreur de calcul'; }
        if (__err !== null) return JSON.stringify({ err: __err });
        return JSON.stringify(__captured);
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
export function pieuxSourceAvailable(): boolean {
  try {
    readFileSync(pieuxSourcePath());
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
 * (JSON.stringify -> JSON.parse). Le HTML traverse cet aller-retour (l'eval renvoie
 * du JSON) : `Infinity`/`NaN` y deviennent `null`, `undefined`/fonctions y
 * disparaissent. Pour comparer A PERIMETRE IDENTIQUE, on impose au module la meme
 * transformation AVANT comparaison.
 */
export function jsonRoundTrip(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}
