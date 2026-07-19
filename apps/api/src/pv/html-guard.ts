import { BadRequestException } from '@nestjs/common';

/**
 * GARDE §8 — INERTIE + CONFIDENTIALITE du HTML capture (scellement option-3).
 *
 * Le document scelle est le HTML/SVG que l'outil client produit A L'IMPRESSION :
 * du CONTENU INERTE (données rendues), jamais du code exécutable. Cette garde est
 * FAIL-CLOSED : on REFUSE de persister un HTML porteur de script, de gestionnaire
 * d'événement, d'URI `javascript:`/`data:`, d'un marqueur/symbole moteur
 * confidentiel, ou dépassant la taille admise. Elle s'applique AU MOMENT DE LA
 * CAPTURE (avant tout stockage) sur `displayHtml` ET `printHtml` — un document
 * inerte a l'entrée reste inerte au ré-affichage/à l'impression.
 *
 * PORTEE HONNÊTE — best-effort, défense en PROFONDEUR (pas une garantie absolue) :
 *   - La barrière EFFECTIVE d'inertie du document SERVI est la CSP HTTP
 *     (`Content-Security-Policy: sandbox …`) posée par le contrôleur : c'est elle
 *     qui neutralise scripts/handlers côté navigateur au ré-affichage.
 *   - Cette garde applicative est la SECONDE barrière : elle refuse d'entrée un
 *     document manifestement actif ou porteur d'un marqueur moteur, sans dépendre
 *     de la CSP. Elle N'EST PAS un tokenizer HTML complet — un parseur de navigateur
 *     et cette heuristique peuvent diverger sur des constructions tordues.
 *   - `file://` (document EXPORTÉ, ouvert hors serveur) = angle mort où la CSP HTTP
 *     ne s'applique plus ; cette garde RÉDUIT le risque résiduel sans l'annuler.
 *
 * DEUX PASSES distinctes (voir plus bas) contre les contournements de frontière :
 *   (a) balises actives + gestionnaires `on…=` : testés aussi sur une COPIE dont le
 *       CONTENU des valeurs d'attribut guillemetées est BLANCHI, pour que les vraies
 *       frontières de balise apparaissent (un `>` DANS une valeur guillemetée ne
 *       ferme PAS la balise pour le navigateur — cf. bypass `title="a>b" onerror=…`).
 *   (b) schémas dangereux `javascript:`/`data:` : cherchés dans les VALEURS
 *       D'ATTRIBUT (seul contexte où un schéma d'URI est navigable/actif), après
 *       décodage d'entités ET suppression des blancs de contrôle intra-schéma que le
 *       navigateur ignore (cf. bypass `href="java&Tab;script:…"`). Ce bornage aux
 *       attributs évite les faux positifs sur du texte courant (`(&#100;ata: 42)`).
 *
 * Fonction PURE et testable (aucune I/O, aucun état) : `assertInertHtml(html,
 * field)` LÈVE une BadRequestException (mappée en 400) au premier motif de refus,
 * avec un message BORNÉ (le champ + le motif, JAMAIS le contenu fautif — pas de
 * fuite du HTML rejeté ni d'un extrait moteur dans la réponse d'erreur).
 */

/** Taille max par champ HTML : 1 MiB. Un document d'impression légitime (HTML+SVG
 *  auto-contenu, zéro binaire) tient très en deçà ; au-delà = anomalie -> 400. */
export const MAX_HTML_BYTES = 1_048_576;

/**
 * Marqueurs/symboles CONFIDENTIELS interdits dans un document de rendu (DoD §8).
 * Alignés sur le contrôle de bundle CI (scripts/review-gate.sh) : le marqueur texte
 * stable embarqué par chaque moteur, le specifier du paquet moteur, et un symbole
 * moteur connu. Le HTML est du rendu de DONNÉES : il ne doit JAMAIS contenir de code
 * moteur. Comparaison insensible a la casse.
 */
const CONFIDENTIAL_MARKERS = [
  '__ROADSEN_ENGINE_CONFIDENTIAL_DO_NOT_SHIP__',
  '@roadsen/engines',
  'burIntegrateMLWithPSC',
];

// Balises ACTIVES interdites (chargement/execution) : <script>, mais aussi les
// conteneurs qui reintroduisent un contexte HTML/JS actif dans du SVG ou une page :
// iframe/object/embed/foreignObject. Insensible a la casse.
const ACTIVE_TAG_RE = /<\s*(?:script|iframe|object|embed|foreignobject)\b/i;
// Gestionnaire d'événement inline DANS une balise : `<tag … onload=`, `onclick=`…
// SEPARATEUR [\s/] (et pas seulement \s) : les navigateurs acceptent « / » comme
// separateur d'attribut, donc `<svg/onload=…>` DOIT etre attrape. `on[a-z][a-z-]*`
// couvre les handlers a tiret. [^>]*? borne au contenu de la balise. ⚠️ `[^>]`
// s'arrete au PREMIER `>` — y compris un `>` DANS une valeur guillemetée que le
// navigateur, lui, IGNORE (bypass `<img title="a>b" onerror=…>`). D'où le test sur
// la copie BLANCHIE (blankQuotedAttrValues) EN PLUS du brut : union fail-closed.
const EVENT_HANDLER_RE = /<[a-z][^>]*?[\s/]on[a-z][a-z-]*\s*=/i;
// URI javascript: — insensible a la casse. Cherchée dans les VALEURS D'ATTRIBUT
// normalisées (entites décodées + blancs de contrôle intra-schéma retirés).
const JAVASCRIPT_URI_RE = /javascript:/i;
// URI data: — vecteur d'execution (data:text/html). Lookbehind : le caractere qui
// precede `data:` ne doit PAS etre une lettre -> `metadata:` reste tolere, mais
// `data:` en tête de valeur d'attribut est rejeté. Idem, sur valeur normalisée.
const DATA_URI_RE = /(?<![a-z])data:/i;
// Blancs de CONTRÔLE que le navigateur retire À L'INTÉRIEUR d'un schéma d'URL
// (tab/CR/LF, + form-feed/vertical-tab par marge fail-closed) : `java\tscript:` doit
// redevenir `javascript:` AVANT le test de schéma (bypass `href="java&Tab;script:…"`).
const SCHEME_CTRL_WS_RE = /[\t\n\r\f\v]/g;

/**
 * Vérifie qu'un HTML capturé est INERTE et sans marqueur confidentiel. LÈVE une
 * BadRequestException (400) au premier refus. Ne renvoie rien en cas de succès.
 *
 * @param html  le HTML a valider (display ou print).
 * @param field nom du champ pour le message d'erreur borné ('displayHtml' | 'printHtml').
 */
export function assertInertHtml(html: string, field: string): void {
  if (typeof html !== 'string' || html.length === 0) {
    throw new BadRequestException(`Champ ${field} manquant ou vide.`);
  }
  // Taille en OCTETS UTF-8 (une chaine JS .length compte les unités UTF-16, pas
  // les octets) : c'est la charge réelle stockée qu'on borne.
  if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) {
    throw new BadRequestException(
      `Champ ${field} trop volumineux (> ${MAX_HTML_BYTES} octets).`,
    );
  }
  if (ACTIVE_TAG_RE.test(html)) {
    throw new BadRequestException(
      `Champ ${field} rejeté : balise active interdite (script/iframe/object/embed/foreignObject).`,
    );
  }
  // PASSE (a) — gestionnaire `on…=` : testé sur le BRUT ET sur la copie BLANCHIE.
  // Blanchir le CONTENU des valeurs guillemetées fait disparaître les `>` factices
  // qui masquaient un handler derrière une fausse fin de balise (`title="a>b"
  // onerror=…`). Union fail-closed : un match sur l'un OU l'autre -> refus.
  const blanked = blankQuotedAttrValues(html);
  if (EVENT_HANDLER_RE.test(html) || EVENT_HANDLER_RE.test(blanked)) {
    throw new BadRequestException(
      `Champ ${field} rejeté : gestionnaire d'événement inline interdit (on…=).`,
    );
  }
  // PASSE (b) — schémas `javascript:`/`data:` dans les VALEURS D'ATTRIBUT (seul
  // contexte navigable/actif). Chaque valeur est NORMALISÉE : entités décodées PUIS
  // blancs de contrôle intra-schéma retirés, de sorte que `java&Tab;script:` et une
  // tabulation littérale redeviennent `javascript:`. Bornage aux attributs = pas de
  // faux positif sur du texte courant (`(&#100;ata: 42)`).
  for (const raw of extractAttributeValues(html)) {
    const value = decodeHtmlEntities(raw).replace(SCHEME_CTRL_WS_RE, '');
    if (JAVASCRIPT_URI_RE.test(value)) {
      throw new BadRequestException(
        `Champ ${field} rejeté : URI « javascript: » interdite.`,
      );
    }
    if (DATA_URI_RE.test(value)) {
      throw new BadRequestException(
        `Champ ${field} rejeté : URI « data: » interdite.`,
      );
    }
  }
  const lower = html.toLowerCase();
  for (const marker of CONFIDENTIAL_MARKERS) {
    if (lower.includes(marker.toLowerCase())) {
      // Message BORNÉ : on ne renvoie NI le marqueur trouvé NI le contexte
      // (aucune fuite d'un extrait moteur dans la réponse d'erreur).
      throw new BadRequestException(
        `Champ ${field} rejeté : marqueur/symbole confidentiel détecté (DoD §8).`,
      );
    }
  }
}

/** Un `<` ouvre une balise seulement s'il est suivi d'une lettre, `/`, `!` ou `?`
 *  (comportement du tokenizer HTML) ; sinon c'est du texte littéral (`a < b`). */
const TAG_OPEN_NEXT_RE = /[a-zA-Z/!?]/;
const HTML_WS_RE = /\s/;

/**
 * PASSE (a) — rend une COPIE du HTML où le CONTENU des chaînes guillemetées
 * (simples ou doubles) EN CONTEXTE DE BALISE est remplacé par des espaces, en
 * PRÉSERVANT la structure (`<`, nom de balise, noms d'attributs, `=`, guillemets,
 * `>`) et la longueur. But : faire disparaître les `>` FACTICES cachés dans une
 * valeur guillemetée, pour que `EVENT_HANDLER_RE` voie les vraies frontières de
 * balise. Un nom de handler (`onerror=`) n'est JAMAIS entre guillemets : le
 * blanchiment ne peut donc pas masquer un handler, seulement révéler celui qui se
 * cachait derrière un faux `>`. Mini-tokenizer aligné sur le navigateur (on n'entre
 * en balise que sur `<` + [lettre/`/`/`!`/`?`]).
 */
function blankQuotedAttrValues(html: string): string {
  const out: string[] = [];
  const n = html.length;
  let inTag = false;
  let quote = '';
  for (let i = 0; i < n; i++) {
    const c = html[i];
    if (!inTag) {
      out.push(c);
      if (c === '<' && i + 1 < n && TAG_OPEN_NEXT_RE.test(html[i + 1])) {
        inTag = true;
      }
      continue;
    }
    if (quote) {
      if (c === quote) {
        quote = '';
        out.push(c);
      } else {
        out.push(' '); // contenu de la valeur blanchi (y compris un `>` factice)
      }
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      out.push(c);
    } else if (c === '>') {
      inTag = false;
      out.push(c);
    } else {
      out.push(c);
    }
  }
  return out.join('');
}

/**
 * PASSE (b) — extrait les VALEURS D'ATTRIBUT (guillemetées ou non) en contexte de
 * balise, sans décodage. Seul contexte où un schéma `javascript:`/`data:` est
 * navigable/actif ; scanner d'abord évite les faux positifs sur du texte courant.
 * Mini-tokenizer fail-closed : une valeur guillemetée non fermée est capturée
 * jusqu'à la fin (on préfère sur-capturer -> tester -> éventuellement refuser).
 */
function extractAttributeValues(html: string): string[] {
  const values: string[] = [];
  const n = html.length;
  let i = 0;
  while (i < n) {
    if (html[i] === '<' && i + 1 < n && TAG_OPEN_NEXT_RE.test(html[i + 1])) {
      i++; // on entre dans la balise
      while (i < n && html[i] !== '>') {
        const c = html[i];
        if (c === '"' || c === "'") {
          const q = c;
          i++;
          const start = i;
          while (i < n && html[i] !== q) i++;
          values.push(html.slice(start, i));
          if (i < n) i++; // saute le guillemet fermant
        } else if (c === '=') {
          i++;
          while (i < n && HTML_WS_RE.test(html[i])) i++;
          if (i < n && (html[i] === '"' || html[i] === "'")) {
            continue; // valeur guillemetée -> traitée au tour suivant
          }
          const start = i; // valeur NON guillemetée : jusqu'à un blanc ou `>`
          while (i < n && !HTML_WS_RE.test(html[i]) && html[i] !== '>') i++;
          values.push(html.slice(start, i));
        } else {
          i++;
        }
      }
      if (i < n) i++; // saute le `>`
    } else {
      i++;
    }
  }
  return values;
}

/**
 * Décode les entités HTML numériques (décimales `&#NN;`, hexadécimales `&#xNN;`)
 * et un petit jeu d'entités NOMMÉES pertinentes pour l'obfuscation d'URI (`&colon;`,
 * `&Tab;`, `&NewLine;`). But UNIQUE : détecter `javascript:`/`data:` masqués par des
 * entités — PAS un décodeur HTML complet. Les entités inconnues sont laissées
 * telles quelles (elles ne peuvent pas fabriquer un schéma d'URI actif ici).
 */
function decodeHtmlEntities(html: string): string {
  return html
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) =>
      safeFromCodePoint(parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_m, dec: string) =>
      safeFromCodePoint(parseInt(dec, 10)),
    )
    .replace(/&colon;/gi, ':')
    .replace(/&Tab;/g, '\t')
    .replace(/&NewLine;/g, '\n');
}

/** Convertit un code point en caractère ; renvoie '' si hors plage (jamais de throw). */
function safeFromCodePoint(cp: number): string {
  if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff) return '';
  try {
    return String.fromCodePoint(cp);
  } catch {
    return '';
  }
}
