/**
 * Cartouche PV — ENROBAGE AU SERVICE du document client scelle (#pv-cartouche).
 *
 * PROBLEME : `official_pv.document_html` contient le rapport BRUT de l'outil
 * client (aucune marque de PV : ni numero, ni sceau, ni horodatage, ni emetteur,
 * ni note legale). Toutes ces donnees existent pourtant dans la ligne scellee
 * (`official_pv` + `input_canonical`).
 *
 * DECISION D'ARCHITECTURE : l'enrobage se fait AU MOMENT DE SERVIR
 * (documentForView), PAS au scellement — l'empreinte SHA-256 imprimee dans le
 * cartouche ne peut pas faire partie du contenu hache (hash circulaire). Les
 * OCTETS STOCKES restent donc inchanges ; on injecte le cartouche dans une COPIE
 * SERVIE du HTML. L'integrite (re-hash) porte toujours sur les octets bruts.
 *
 * `wrapSealedDocumentWithPvChrome` est PUR (aucun acces base) et testable :
 *  - insere un BANDEAU juste apres <body> ;
 *  - insere un PIED juste avant </body> ;
 *  - insere le CSS du cartouche (classes prefixees `pvx-`, zero collision avec le
 *    CSS de l'outil) juste avant </head> ;
 *  - remplace le <title> par « Procès-verbal PV-RDS-… ».
 *
 * §8 / CSP : le cartouche est du HTML STATIQUE — aucun <script>, aucun handler
 * `on…=`, aucune webfont (pictos en SVG inline). Il passe la CSP servie
 * (`default-src 'none'; style-src 'unsafe-inline'`). Les valeurs injectees
 * (emetteur, projet, organisation) sont ECHAPPEES.
 */

/** Metadonnees SCELLEES a afficher dans le cartouche. Toutes issues du PV scelle. */
export interface PvChromeMeta {
  /** Numero de PV (PV-RDS-{slug}-{YYYY}-{NNNNNN}). */
  pvNumber: string;
  /** Empreinte SHA-256 du contenu canonique (64 hex). */
  contentHash: string;
  /** Horodatage serveur SCELLE (Date ou chaine ISO). */
  sealedAt: Date | string;
  /** Libelle du projet (SCELLE). */
  projectName: string;
  /** Nom de l'emetteur (SCELLE ; '' si non renseigne). */
  userDisplayName: string;
  /** Nom de l'organisation (SCELLE ; '' si non renseigne). */
  orgDisplayName: string;
  /** Id de registre du moteur (ex. 'chaussee-burmister'). */
  engineId: string;
  /** Version du moteur (ex. '2.0.0'). */
  engineVersion: string;
  /** Verdict scelle : CONFORME / NON_CONFORME / NON_APPLICABLE (null = absent). */
  verdict: string | null;
}

/** Libelle « logiciel » par id de registre. Fallback : l'engineId brut. */
const SOFTWARE_LABELS: Record<string, string> = {
  'chaussee-burmister': 'ROADSENS — Chaussées',
};

/** Prefixe de version par moteur (ex. burmister -> « Burmister v2.0.0 »). */
const ENGINE_VERSION_PREFIX: Record<string, string> = {
  'chaussee-burmister': 'Burmister v',
};

/** Echappe le HTML (&, <, >, ", ') pour toute valeur injectee. */
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

/** « 19/07/2026 · 15:30 UTC » depuis une Date/ISO. Degrade si illisible. */
function formatSealedAtFr(sealedAt: Date | string): string {
  const d = sealedAt instanceof Date ? sealedAt : new Date(sealedAt);
  if (Number.isNaN(d.getTime())) return '(date non disponible)';
  const p = (n: number): string => String(n).padStart(2, '0');
  return (
    `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}` +
    ` · ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`
  );
}

/** Libelle logiciel (fallback = engineId). */
function softwareLabel(engineId: string): string {
  return SOFTWARE_LABELS[engineId] ?? engineId;
}

/** Libelle version moteur (prefixe par moteur ; degrade si vide). */
function engineVersionLabel(engineId: string, version: string): string {
  const v = version?.trim();
  if (!v) return '(version non disponible)';
  return `${ENGINE_VERSION_PREFIX[engineId] ?? ''}${v}`;
}

/** Pastille de verdict (label + couleur). null/inconnu -> texte muet degrade. */
function verdictValueHtml(verdict: string | null): {
  html: string;
  empty: boolean;
} {
  switch (verdict) {
    case 'CONFORME':
      return {
        html: '<span class="pvx-pill pvx-pill--ok">CONFORME</span>',
        empty: false,
      };
    case 'NON_CONFORME':
      return {
        html: '<span class="pvx-pill pvx-pill--bad">NON CONFORME</span>',
        empty: false,
      };
    case 'NON_APPLICABLE':
      return {
        html: '<span class="pvx-pill pvx-pill--na">NON APPLICABLE</span>',
        empty: false,
      };
    default:
      return { html: '(verdict non renseigné)', empty: true };
  }
}

/** Cellule de la grille du bandeau (clef + valeur ; `empty` -> style muet). */
function cell(label: string, valueHtml: string, empty = false): string {
  const vClass = empty ? 'v pvx-empty' : 'v';
  return (
    `<div class="pvx-cell"><div class="k">${escapeHtml(label)}</div>` +
    `<div class="${vClass}">${valueHtml}</div></div>`
  );
}

/** Valeur texte scellee -> { html echappe, empty } avec degradation propre. */
function scelledText(
  value: string,
  fallback: string,
): { html: string; empty: boolean } {
  const v = value?.trim();
  if (!v) return { html: escapeHtml(fallback), empty: true };
  return { html: escapeHtml(v), empty: false };
}

/** Picto « sceau » (SVG inline, aucune ressource externe). */
const SEAL_SVG =
  '<svg width="34" height="34" viewBox="0 0 44 44" fill="none" aria-hidden="true">' +
  '<circle cx="22" cy="22" r="20" stroke="#8fd3c6" stroke-width="1.5"/>' +
  '<circle cx="22" cy="22" r="14" stroke="#8fd3c6" stroke-width="1" stroke-dasharray="1.5 2.5"/>' +
  '<path d="M15.5 22.2l4.4 4.4 8.6-9.2" stroke="#8fd3c6" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>' +
  '</svg>';

/** CSS du cartouche — classes prefixees `pvx-`, couleurs litterales (zero :root,
 * zero variable partagee) pour NE PAS collisionner avec le CSS de l'outil. */
const PV_CHROME_CSS = `
.pvx-band,.pvx-foot{box-sizing:border-box;font-family:ui-sans-serif,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;font-size:14px;line-height:1.5}
.pvx-band *,.pvx-foot *{box-sizing:border-box}
.pvx-band{background:linear-gradient(180deg,#1b3a5b,#274d76);color:#fff;padding:18px 24px 16px}
.pvx-band .pvx-top{display:flex;justify-content:space-between;align-items:flex-start;gap:16px}
.pvx-kicker{font-size:.7rem;letter-spacing:.22em;text-transform:uppercase;color:#b9cbe0}
.pvx-title{font-size:1.35rem;font-weight:680;margin:2px 0 0;letter-spacing:-.01em}
.pvx-num{font-family:ui-monospace,Menlo,monospace;font-size:.9rem;color:#dbe6f1;margin-top:4px}
.pvx-seal{display:flex;align-items:center;gap:9px;background:rgba(255,255,255,.10);border:1px solid rgba(255,255,255,.22);border-radius:9px;padding:9px 12px;white-space:nowrap}
.pvx-seal svg{flex:none}
.pvx-seal .t{font-size:.72rem;color:#cfe0f0;letter-spacing:.02em}
.pvx-seal .h{font-family:ui-monospace,Menlo,monospace;font-size:.74rem;color:#fff}
.pvx-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;margin-top:16px;background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.16);border-radius:8px;overflow:hidden}
.pvx-cell{background:#1b3a5b;padding:9px 12px}
.pvx-cell .k{font-size:.6rem;letter-spacing:.12em;text-transform:uppercase;color:#9fb6cd}
.pvx-cell .v{font-size:.9rem;color:#fff;margin-top:2px;font-weight:520}
.pvx-cell .v.pvx-empty{color:#9fb6cd;font-style:italic;font-weight:400}
.pvx-pill{display:inline-block;padding:2px 9px;border-radius:20px;font-size:.72rem;font-weight:700;letter-spacing:.04em}
.pvx-pill--bad{background:#fbece8;color:#b1442f}
.pvx-pill--ok{background:#e7f4ee;color:#1c7a4d}
.pvx-pill--na{background:#e6ebf0;color:#5f7183}
.pvx-foot{border-top:2px solid #1b3a5b;padding:16px 24px 20px;background:#f6f8fa;color:#1a2733}
.pvx-foot .pvx-hashrow{display:flex;flex-wrap:wrap;gap:6px 18px;font-size:.74rem;color:#1a2733}
.pvx-foot .pvx-hashrow b{color:#5f7183;font-weight:600;letter-spacing:.03em;text-transform:uppercase;font-size:.62rem}
.pvx-mono{font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;word-break:break-all}
.pvx-foot .pvx-legal{margin-top:12px;font-size:.72rem;color:#5f7183;line-height:1.55;max-width:70ch}
.pvx-foot .pvx-sign{display:flex;justify-content:space-between;align-items:flex-end;margin-top:16px;gap:20px;flex-wrap:wrap}
.pvx-foot .pvx-who{font-size:.78rem}
.pvx-foot .pvx-who .n{font-weight:640;color:#1a2733}
.pvx-foot .pvx-ref{font-family:ui-monospace,Menlo,monospace;font-size:.68rem;color:#5f7183}
@media (max-width:640px){.pvx-grid{grid-template-columns:repeat(2,1fr)}.pvx-band .pvx-top{flex-direction:column}}
`.trim();

/** Construit le BANDEAU (injecte juste apres <body>). */
function buildBand(meta: PvChromeMeta): string {
  const pvNum = escapeHtml(meta.pvNumber);
  const hash16 = escapeHtml(meta.contentHash.slice(0, 16));
  const project = scelledText(meta.projectName, '(projet non renseigné)');
  const emitter = scelledText(
    meta.userDisplayName,
    '(identité non renseignée)',
  );
  const org = scelledText(meta.orgDisplayName, '(organisation non renseignée)');
  const sealedAt = escapeHtml(formatSealedAtFr(meta.sealedAt));
  const software = escapeHtml(softwareLabel(meta.engineId));
  const version = escapeHtml(
    engineVersionLabel(meta.engineId, meta.engineVersion),
  );
  const verdict = verdictValueHtml(meta.verdict);

  return (
    '<div class="pvx-band">' +
    '<div class="pvx-top">' +
    '<div>' +
    '<div class="pvx-kicker">Procès-verbal · dimensionnement de chaussée</div>' +
    '<div class="pvx-title">Note de calcul ROADSENS</div>' +
    `<div class="pvx-num">N° ${pvNum}</div>` +
    '</div>' +
    '<div class="pvx-seal">' +
    SEAL_SVG +
    `<div><div class="t">Document scellé · SHA-256</div><div class="h">${hash16}…</div></div>` +
    '</div>' +
    '</div>' +
    '<div class="pvx-grid">' +
    cell('Projet', project.html, project.empty) +
    cell('Émetteur', emitter.html, emitter.empty) +
    cell('Organisation', org.html, org.empty) +
    cell('Scellé le (serveur)', sealedAt) +
    cell('Logiciel', software) +
    cell('Version moteur', version) +
    cell('Verdict', verdict.html, verdict.empty) +
    '</div>' +
    '</div>'
  );
}

/** Construit le PIED (injecte juste avant </body>). */
function buildFoot(meta: PvChromeMeta): string {
  const pvNum = escapeHtml(meta.pvNumber);
  const fullHash = escapeHtml(meta.contentHash);
  const emitter = scelledText(
    meta.userDisplayName,
    '(identité non renseignée)',
  );
  const org = scelledText(meta.orgDisplayName, '(organisation non renseignée)');

  return (
    '<div class="pvx-foot">' +
    '<div class="pvx-hashrow">' +
    `<span><b>Empreinte SHA-256</b> <span class="pvx-mono">${fullHash}</span></span>` +
    '<span><b>Sceau</b> HMAC-SHA256 · horodatage serveur</span>' +
    `<span><b>N°</b> <span class="pvx-mono">${pvNum}</span></span>` +
    '</div>' +
    '<p class="pvx-legal">' +
    "Document scellé pour contrôle d'intégrité (SHA-256 / HMAC, horodatage serveur). " +
    '<b>Ne constitue pas une signature électronique qualifiée</b> au sens de la loi 2008-08. ' +
    "Aide au calcul — la responsabilité de l'étude reste à l'ingénieur signataire. " +
    'Toute modification du document rompt le sceau et se détecte.' +
    '</p>' +
    '<div class="pvx-sign">' +
    `<div class="pvx-who">Émis par <span class="n">${emitter.html}</span> · ${org.html}</div>` +
    '<div class="pvx-ref">Vérification d\'intégrité en ligne — Phase 2</div>' +
    '</div>' +
    '</div>'
  );
}

/** Insere un fragment juste avant </head> (fallback : avant <body>, sinon en tete). */
function injectBeforeHeadClose(html: string, fragment: string): string {
  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, () => fragment + '</head>');
  }
  if (/<body[^>]*>/i.test(html)) {
    return html.replace(/<body[^>]*>/i, (m) => fragment + m);
  }
  return fragment + html;
}

/**
 * Enrobe une COPIE du document scelle avec le cartouche PV (bandeau + pied + CSS
 * + titre). PUR : n'altere jamais les octets stockes (l'appelant lui passe une
 * chaine, recoit une nouvelle chaine). Ne LEVE jamais : si une ancre manque, on
 * degrade en injectant a une position de repli, le document reste bien forme.
 */
export function wrapSealedDocumentWithPvChrome(
  html: string,
  meta: PvChromeMeta,
): string {
  const band = buildBand(meta);
  const foot = buildFoot(meta);
  const style = `<style>${PV_CHROME_CSS}</style>`;
  const title = `<title>Procès-verbal ${escapeHtml(meta.pvNumber)}</title>`;

  let out = html;

  // 1) <head> : remplace le <title> existant (sinon injecte le notre) + CSS.
  if (/<title[^>]*>[\s\S]*?<\/title>/i.test(out)) {
    out = out.replace(/<title[^>]*>[\s\S]*?<\/title>/i, () => title);
    out = injectBeforeHeadClose(out, style);
  } else {
    out = injectBeforeHeadClose(out, title + style);
  }

  // 2) BANDEAU juste apres <body ...> (fallback : en tete du corps servi).
  if (/<body[^>]*>/i.test(out)) {
    out = out.replace(/<body[^>]*>/i, (m) => m + band);
  } else {
    out = band + out;
  }

  // 3) PIED juste avant </body> (fallback : en fin de document).
  if (/<\/body>/i.test(out)) {
    out = out.replace(/<\/body>/i, () => foot + '</body>');
  } else {
    out = out + foot;
  }

  return out;
}

/**
 * Extrait { userDisplayName, orgDisplayName } de la chaine canonique scellee
 * (`input_canonical`). Les libelles projet/pvNumber/hash/verdict/version viennent
 * des COLONNES de l'official_pv ; seuls les noms d'emetteur/organisation vivent
 * dans identity{}. Degrade en '' (jamais de throw) si la canonique est illisible.
 */
export function extractSealedIdentity(canonical: string): {
  userDisplayName: string;
  orgDisplayName: string;
} {
  try {
    const parsed = JSON.parse(canonical) as {
      identity?: { userDisplayName?: unknown; orgDisplayName?: unknown };
    };
    const id = parsed.identity ?? {};
    return {
      userDisplayName:
        typeof id.userDisplayName === 'string' ? id.userDisplayName : '',
      orgDisplayName:
        typeof id.orgDisplayName === 'string' ? id.orgDisplayName : '',
    };
  } catch {
    return { userDisplayName: '', orgDisplayName: '' };
  }
}
