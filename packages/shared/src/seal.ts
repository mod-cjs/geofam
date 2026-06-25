/**
 * PRIMITIVE DE SCELLEMENT des PV (BUILD #63 — incrément A). Zone CRITIQUE.
 *
 * Le scellement d'un PV repose sur deux empreintes calculees sur une
 * sérialisation CANONIQUE et DÉTERMINISTE du contenu scellé :
 *   - `content_hash` = SHA-256 hex  -> EMPREINTE DE CONTENU (détection d'altération,
 *     vérifiable par quiconque sans secret).
 *   - `hmac`         = HMAC-SHA256 hex (clé `PV_SIGNING_SECRET`) -> PREUVE D'ORIGINE
 *     (seul le serveur détenant le secret a pu produire ce PV).
 *
 * --- CHOIX DE CANONICALISATION (RISQUE #1, intégrité) ---------------------
 * La canonicalisation est LEXICALE-STABLE sur la valeur DÉJÀ PROJETÉE (telle
 * qu'elle sera stockée), PAS une normalisation sémantique-numérique. Concrètement :
 *   - on TRIE récursivement les clés d'objet (l'ordre d'insertion devient
 *     indifférent : un PV re-sérialisé donne le MÊME sceau) ;
 *   - on PRÉSERVE l'ordre des tableaux (significatif) ;
 *   - on NE convertit PAS les nombres ni les chaines : '1,5' reste la chaine
 *     '1,5', le nombre 1.5 reste 1.5, et les deux sont DISTINCTS (types distincts
 *     -> sérialisations distinctes -> sceaux distincts).
 *
 * POURQUOI ce choix : les entrées moteur peuvent contenir des nombres OU des
 * chaines FR non pré-converties (« 1,5 »). Si la primitive « comprenait » ces
 * valeurs (parsait '1,5' en 1.5), deux contenus pourtant DIFFÉRENTS au stockage
 * auraient le même sceau -> une altération de la chaine stockée passerait
 * inaperçue, et le sceau serait irreproductible selon la locale. On scelle donc
 * la REPRÉSENTATION exacte stockée, octet pour octet. Toute normalisation
 * sémantique (conversion FR->nombre) appartient à la couche métier AVANT
 * scellement (la valeur projetée est déjà figée quand on arrive ici).
 *
 * --- DÉTERMINISME STRICT --------------------------------------------------
 * Aucune source de non-déterminisme dans ce module : pas de `Date.now()`, pas de
 * `Math.random()`, pas d'I/O. Le timestamp (`sealed_at`) et le numéro de PV font
 * partie du CONTENU passé par l'appelant (incrément B) — ils sont scellés, pas
 * générés ici. Conséquence : un même contenu -> un même sceau, indéfiniment.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Valeur scellable : sous-ensemble JSON (scalaires, null, tableaux, objets
 * « plain »). On EXCLUT `undefined`, fonctions, symboles, BigInt, Date — la
 * couche métier ne doit sceller que des données déjà projetées/sérialisables.
 * `undefined` dans un objet = clé OMISE (cohérent avec JSON) ; en racine ou dans
 * un tableau = `null` (positions de tableau significatives).
 */
export type SealableValue =
  | string
  | number
  | boolean
  | null
  | SealableValue[]
  | { [key: string]: SealableValue | undefined };

/**
 * Sérialisation CANONIQUE déterministe : clés d'objet triées récursivement,
 * ordre des tableaux préservé, scalaires rendus via leur représentation JSON
 * (qui distingue le nombre 1.5 de la chaine "1.5"). Le résultat est une chaine
 * STABLE : c'est elle (et elle seule) qui est hachée/HMACée et stockée comme
 * `input_canonical` dans `official_pvs`.
 *
 * @throws si une valeur non finie (NaN/Infinity) est rencontrée : un nombre
 *   dégénéré ne doit jamais être scellé silencieusement (JSON le rendrait `null`
 *   et masquerait l'anomalie).
 */
export function canonicalize(value: SealableValue | undefined): string {
  return serialize(value);
}

function serialize(value: SealableValue | undefined): string {
  // En racine / position de tableau, `undefined` -> `null` (parité JSON).
  if (value === undefined || value === null) return 'null';

  const t = typeof value;

  if (t === 'number') {
    const n = value as number;
    if (!Number.isFinite(n)) {
      throw new Error(
        'canonicalize : nombre non fini (NaN/Infinity) interdit dans un contenu scellé.',
      );
    }
    // JSON.stringify rend la forme canonique d'un nombre fini (ex. 1.5, -0 -> 0).
    return JSON.stringify(n);
  }

  if (t === 'string' || t === 'boolean') {
    // JSON.stringify échappe correctement les chaines (guillemets, unicode) ;
    // la chaine FR '1,5' est rendue littéralement "1,5" (jamais convertie).
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    // Ordre PRÉSERVÉ : un tableau est une séquence, pas un ensemble.
    return '[' + value.map((item) => serialize(item)).join(',') + ']';
  }

  if (t === 'object') {
    // FAIL-CLOSED sur les objets NON-PLAIN (Date, Map, Set, instances de classe…) :
    // sans cette garde, `Object.keys(new Date())` = [] -> deux dates differentes se
    // canonicalisent en `{}` (MÊME sceau = collision silencieuse). On REFUSE plutot
    // que de perdre l'information : tout contenu doit etre projete en scalaire/objet
    // plain (ex. une date en chaine ISO) AVANT scellement. (Revue secu #63-A.)
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      const name = (value as { constructor?: { name?: string } }).constructor?.name;
      throw new Error(
        `canonicalize : objet non-plain « ${name ?? 'inconnu'} » interdit — projeter en scalaire/objet plain (ex. date -> chaine ISO) avant scellement.`,
      );
    }
    const obj = value as { [key: string]: SealableValue | undefined };
    // Clés TRIÉES : l'ordre d'insertion devient indifférent. Une clé dont la
    // valeur est `undefined` est OMISE (parité JSON : elle ne fait pas partie
    // du contenu). Tri par ordre de point de code (localeCompare exclu : il est
    // dépendant de la locale, donc non déterministe entre environnements).
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort();
    const parts = keys.map(
      (k) => JSON.stringify(k) + ':' + serialize(obj[k] as SealableValue),
    );
    return '{' + parts.join(',') + '}';
  }

  // BigInt, symbol, function : non sérialisables -> rejet explicite (fail-closed).
  throw new Error(
    `canonicalize : type non scellable « ${t} » (seuls JSON scalaires/objets/tableaux sont admis).`,
  );
}

/** SHA-256 hex de la chaine canonique = empreinte de contenu (sans secret). */
export function sealContentHash(canonical: string): string {
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/** HMAC-SHA256 hex de la chaine canonique avec `secret` = preuve d'origine. */
export function sealHmac(canonical: string, secret: string): string {
  if (!secret || secret.length === 0) {
    throw new Error('sealHmac : secret de scellement absent (PV_SIGNING_SECRET).');
  }
  return createHmac('sha256', secret).update(canonical, 'utf8').digest('hex');
}

/**
 * Vérifie un sceau : recalcule hash + hmac sur `canonical` et les confronte aux
 * valeurs attendues (stockées dans le PV). Renvoie `true` SEULEMENT si les deux
 * concordent. Toute divergence (contenu altéré, mauvais secret, sceau falsifié)
 * -> `false`.
 *
 * COMPARAISON TEMPS CONSTANT sur le HMAC (timingSafeEqual) : on ne divulgue pas,
 * par le temps de réponse, à quel point un HMAC fourni approche le vrai. Une
 * longueur incohérente NE LÈVE PAS (timingSafeEqual exigerait des buffers de même
 * taille) : on borne en amont -> `false`. Le hash de contenu peut se comparer en
 * clair (il ne dépend d'aucun secret), mais on traite tout en temps constant par
 * uniformité et prudence.
 */
export function verifySeal(
  canonical: string,
  expectedHash: string,
  expectedHmac: string,
  secret: string,
): boolean {
  const actualHash = sealContentHash(canonical);
  const actualHmac = sealHmac(canonical, secret);
  return (
    constantTimeEquals(actualHash, expectedHash) &&
    constantTimeEquals(actualHmac, expectedHmac)
  );
}

/**
 * Égalité de chaines hex en temps constant. Longueurs différentes -> `false`
 * sans lever (timingSafeEqual jette si tailles !=). On compare des empreintes
 * hex de longueur fixe (64) en temps nominal ; une entrée mal formée tombe sur
 * le garde-fou de longueur.
 */
function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
