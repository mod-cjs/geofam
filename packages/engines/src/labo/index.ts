/**
 * Module FASTLAB — essais de labo & classification GTR (NF P 11-300) — point d'entree
 * PUR & client-safe.
 *
 * Chaine : entree validee -> moteur (computeLabo) -> PROJECTION du resultat brut
 * { D, cls } sur la sortie whitelistee (contract.ts) -> enveloppe { ok, meta, output }.
 * Aucun DOM, aucune horloge, aucun hasard.
 *
 * Importe UNIQUEMENT par apps/api (recalcul serveur, DoD §8).
 *
 * --- CONFIDENTIALITE (honnetete) ---
 * Les resultats de labo + la classe GTR sont le LIVRABLE de l'essai, PAS une methode
 * confidentielle (contrairement aux moteurs de dimensionnement). Tout est client-safe.
 * On whiteliste neanmoins la sortie (`.strict()`) + redaction fail-closed des messages
 * par COHERENCE avec les 5 autres moteurs (defense en profondeur, pas une fuite averee).
 *
 * --- ETAT SCIENTIFIQUE (#49-53) ---
 * Equivalence-PORTAGE prouvee (module == HTML d'origine). JUSTESSE scientifique NON
 * validee tant que le kit cas-tests STARFIRE manque (PR-1/#36) : @science-unsigned.
 * MJ-6 : pas de prod sans conformite.
 */
import {
  projectEngineOutput,
  type EngineResultEnvelope,
  type EngineVersion,
  type EngineSourceHash,
} from '@roadsen/shared';

import { findEngine } from '../registry/registry.js';

import {
  LABO_ENGINE_ID,
  LaboInputSchema,
  LaboOutputSchema,
  laboContract,
  type LaboInput,
  type LaboOutput,
} from './contract.js';
import { computeLaboDetail } from './engine.js';

export {
  LABO_ENGINE_ID,
  LaboInputSchema,
  LaboOutputSchema,
  laboContract,
  type LaboInput,
  type LaboOutput,
};
export { LABO_CONFIDENTIAL_MARKER } from './engine.js';
export { LABO_FIXTURES, type LaboFixture } from './test-fixtures.js';

/** Garde booleen : valeur numerique finie utilisable. */
function fin(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

/**
 * REDACTION FAIL-CLOSED des messages (`warnings`/`erreur`) — patron #48/#54 (allowlist
 * fail-closed, jamais une blacklist). Defense en profondeur : ici les valeurs de labo
 * sont client-safe (livrable), donc l'allowlist benigne est LARGE (tous les resultats
 * de labo exposes + grandeurs geometriques) ; cette barriere ne sert qu'a fermer une
 * fuite future d'un intermediaire NON expose (par coherence avec les autres moteurs).
 */
const BENIGN_VALUE_LABELS: ReadonlySet<string> = new Set([
  // Resultats de labo exposes (tous client-safe).
  'wn',
  'dmax',
  'p80',
  'p2',
  'cu',
  'cc',
  'mf',
  'wl',
  'wp',
  'ip',
  'ic',
  'vbs',
  'rhos',
  'wopn',
  'rdmax',
  'cbr',
  'gonfl',
  'rhoapp',
  'rhodapp',
  'es',
  'la',
  'sz',
  'mde',
  'wa',
  'so3',
  'so4',
  'qu',
  'cu',
  'c',
  'phi',
  'phir',
  'e0',
  'cs',
  'k',
  'larb',
  'mds',
  // Grandeurs geometriques / d'essai legitimes.
  'n',
  'w',
  'v',
  'm',
  'd',
  'h',
  'l',
  'a',
  't',
  'e',
  'r',
  'mt',
  'sr',
]);

function normalizeLabel(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/ₐ|ₑ|ₒ|ₓ|ₕ|ₖ|ₗ|ₘ|ₙ|ₚ|ₛ|ₜ/g, (m) => {
      const map: Record<string, string> = {
        ['ₐ']: 'a',
        ['ₑ']: 'e',
        ['ₒ']: 'o',
        ['ₓ']: 'x',
        ['ₕ']: 'h',
        ['ₖ']: 'k',
        ['ₗ']: 'l',
        ['ₘ']: 'm',
        ['ₙ']: 'n',
        ['ₚ']: 'p',
        ['ₛ']: 's',
        ['ₜ']: 't',
      };
      return map[m] ?? '';
    })
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Redacte FAIL-CLOSED toute valeur `<token> = <nombre> [unite]` dont le `<token>` n'est
 * PAS dans l'ALLOWLIST benigne. Remplace par `<token> (valeur confidentielle masquee)`.
 * Inconnu => masque. Espace fin insecable FR gere via escape (no-irregular-whitespace).
 */
export function redactConfidentialWarning(text: string): string {
  const TOKEN = "([A-Za-z0-9\\u2090-\\u209c'\\u2019,/*_\\[\\]]+)";
  const valued = new RegExp(
    TOKEN + '\\s*=\\s*(-?[0-9][0-9.,e \\u202f\\s+-]*(?:MPa|kPa|kN|MN|mm|cm|m|%|t|Mg)?)',
    'g',
  );
  return text.replace(valued, (whole, token: string) => {
    const norm = normalizeLabel(token);
    if (norm !== '' && BENIGN_VALUE_LABELS.has(norm)) return whole;
    return `${token} (valeur confidentielle masquee)`;
  });
}

/** Applique la redaction a TOUS les messages (point de passage oblige). */
export function redactConfidentialWarnings(warnings: readonly string[]): string[] {
  return warnings.map((w) => redactConfidentialWarning(w));
}

// Signatures d'EXCEPTION JS interne. Defense en profondeur (parite avec pressiometre,
// ou la meme classe de fuite etait CONFIRMEE) : on n'expose jamais un message
// d'exception technique brut au client. Les messages de DOMAINE (FR) ne matchent pas
// et restent visibles (redactes des valeurs sensibles).
const INTERNAL_JS_ERROR =
  /cannot read|cannot access|is not a function|is not defined|is not iterable|reading '|of undefined|of null|type\s?error|reference\s?error|undefined is|null is/i;

/**
 * Nettoie le message d'erreur expose au client : une exception JS interne devient un
 * message generique ; une erreur de domaine passe (redactee des valeurs confidentielles).
 */
export function sanitizeEngineError(text: string): string {
  if (INTERNAL_JS_ERROR.test(text)) {
    return 'Donnees d essai non exploitables : mesures incoherentes ou insuffisantes.';
  }
  return redactConfidentialWarning(text);
}

/** Nombre fini ou null (la plupart des resultats sont null si l'essai n'est pas saisi). */
function nn(x: unknown): number | null {
  return fin(x) ? x : null;
}
/** Chaine ou null. */
function sn(x: unknown): string | null {
  return typeof x === 'string' ? x : null;
}
/** Booleen strict (defaut false). */
function bo(x: unknown): boolean {
  return x === true;
}
/** Entier fini borne (defaut 0) — pour les compteurs de lignes du detail. */
function iv(x: unknown): number {
  return fin(x) ? Math.trunc(x) : 0;
}
/** Tableau de chaines (filtre). */
function strs(a: unknown): string[] {
  return Array.isArray(a) ? a.filter((s): s is string => typeof s === 'string') : [];
}
/** Serie de couples (x, y) FINIS (les non-finis sont ecartes — parite courbe). */
function points2(a: unknown): [number, number][] {
  if (!Array.isArray(a)) return [];
  const out: [number, number][] = [];
  for (const p of a) {
    if (Array.isArray(p) && p.length >= 2 && fin(p[0]) && fin(p[1])) {
      out.push([p[0], p[1]]);
    }
  }
  return out;
}
function rec(x: unknown): Record<string, unknown> {
  return x && typeof x === 'object' ? (x as Record<string, unknown>) : {};
}

/**
 * PROJETTE le detail d'affichage BRUT (`R.det`, miroir DOM des kernels) sur la whitelist
 * `DetailSchema` — champ a champ, NaN/Infinity -> null (parite JSON), aucune cle non
 * declaree. Tout est client-safe (livrable), la whitelist borne la FORME. `null` si le
 * moteur n'a pas produit de detail (ne devrait pas arriver hors erreur).
 */
function shapeDetail(det: unknown): unknown {
  if (!det || typeof det !== 'object') return null;
  const d = det as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (d.w) {
    const w = rec(d.w);
    out.w = {
      rows: (Array.isArray(w.rows) ? w.rows : []).map(nn),
      moy: nn(w.moy),
      n: iv(w.n),
    };
  }
  if (d.gran) {
    const g = rec(d.gran);
    out.gran = {
      rows: (Array.isArray(g.rows) ? g.rows : []).map((r) => {
        const rr = rec(r);
        return { s: fin(rr.s) ? rr.s : 0, cum: nn(rr.cum), pass: nn(rr.pass) };
      }),
      pts: points2(g.pts),
    };
  }
  if (d.att) {
    const a = rec(d.att);
    out.att = {
      llw: (Array.isArray(a.llw) ? a.llw : []).map(nn),
      plw: (Array.isArray(a.plw) ? a.plw : []).map(nn),
      pente: nn(a.pente),
      wLraw: nn(a.wLraw),
      points: iv(a.points),
      valide: bo(a.valide),
      warns: strs(a.warns),
      nature: sn(a.nature),
      raw: points2(a.raw),
    };
  }
  if (d.vbs) {
    const v = rec(d.vbs);
    out.vbs = {
      rows: (Array.isArray(v.rows) ? v.rows : []).map((r) => {
        const rr = rec(r);
        return { M1: nn(rr.M1), Mb: nn(rr.Mb), v05: nn(rr.v05), vs: nn(rr.vs) };
      }),
      moy: nn(v.moy),
      retenue: nn(v.retenue),
      essais: iv(v.essais),
      manual: nn(v.manual),
      lowV: bo(v.lowV),
    };
  }
  if (d.proctor) {
    const p = rec(d.proctor);
    const fitR = p.fit ? rec(p.fit) : null;
    const enR = p.energy ? rec(p.energy) : null;
    out.proctor = {
      V: nn(p.V),
      rows: (Array.isArray(p.rows) ? p.rows : []).map((r) => {
        const rr = rec(r);
        return { w: nn(rr.w), rd: nn(rr.rd) };
      }),
      fit:
        fitR && fin(fitR.a) && fin(fitR.b) && fin(fitR.c)
          ? { a: fitR.a, b: fitR.b, c: fitR.c }
          : null,
      wopn: nn(p.wopn),
      rdmax: nn(p.rdmax),
      points: iv(p.points),
      energy:
        enR && fin(enR.E) && fin(enR.cible)
          ? { E: enR.E, cible: enR.cible, ok: bo(enR.ok) }
          : null,
      horsTableau: bo(p.horsTableau),
    };
  }
  if (d.rhos) {
    const r = rec(d.rhos);
    out.rhos = {
      rows: (Array.isArray(r.rows) ? r.rows : []).map((x) => {
        const rr = rec(x);
        return { md: nn(rr.md), rs: nn(rr.rs) };
      }),
      rwT: nn(r.rwT),
      rLeff: nn(r.rLeff),
      mean: nn(r.mean),
      spread: nn(r.spread),
      ok: typeof r.ok === 'boolean' ? r.ok : null,
      essais: iv(r.essais),
    };
  }
  if (d.cbr) {
    const c = rec(d.cbr);
    out.cbr = {
      rows: (Array.isArray(c.rows) ? c.rows : []).map((x) => {
        const rr = rec(x);
        return {
          coups: nn(rr.coups),
          net: nn(rr.net),
          dh: nn(rr.dh),
          ds: nn(rr.ds),
          comp: nn(rr.comp),
          gp: nn(rr.gp),
          c25: nn(rr.c25),
          c5: nn(rr.c5),
          maxi: nn(rr.maxi),
        };
      }),
      ydCBR: nn(c.ydCBR),
      icbr: nn(c.icbr),
      cible: nn(c.cible),
      cbType: sn(c.cbType),
      gonfl: nn(c.gonfl),
      moules: iv(c.moules),
      varPts: points2(c.varPts),
      reg: reg2(c.reg),
      pen: (Array.isArray(c.pen) ? c.pen : []).map((s) => points2(s)),
    };
  }
  if (d.cisail) {
    const c = rec(d.cisail);
    out.cisail = {
      rows: (Array.isArray(c.rows) ? c.rows : []).map((x) => {
        const rr = rec(x);
        return {
          sv: nn(rr.sv),
          tp: nn(rr.tp),
          tr: nn(rr.tr),
          rd: nn(rr.rd),
          e: nn(rr.e),
          sr: nn(rr.sr),
        };
      }),
      c: nn(c.c),
      phi: nn(c.phi),
      phiR: nn(c.phiR),
      cR: nn(c.cR),
      r2: nn(c.r2),
      eprouvettes: iv(c.eprouvettes),
      A_cm2: nn(c.A_cm2),
      ptsP: points2(c.ptsP),
      ptsR: points2(c.ptsR),
      regP: reg2(c.regP),
      regR: reg2(c.regR),
    };
  }
  if (d.dens) {
    const x = rec(d.dens);
    out.dens = {
      Vcm3: nn(x.Vcm3),
      rho: nn(x.rho),
      rhod: nn(x.rhod),
      w: nn(x.w),
      petitV: bo(x.petitV),
    };
  }
  if (d.oedo) {
    const o = rec(d.oedo);
    out.oedo = {
      paliers: (Array.isArray(o.paliers) ? o.paliers : []).map((x) => {
        const rr = rec(x);
        return { Hf: nn(rr.Hf), ev: nn(rr.ev), e: nn(rr.e) };
      }),
      e0: nn(o.e0),
      rd: nn(o.rd),
      Hs: nn(o.Hs),
      A: nn(o.A),
      Cc: nn(o.Cc),
      Cs: nn(o.Cs),
      points: iv(o.points),
      curvePts: points2(o.curvePts),
    };
  }
  if (d.ucs) {
    const x = rec(d.ucs);
    out.ucs = { qu: nn(x.qu), cu: nn(x.cu) };
  }
  if (d.triuu) {
    const t = rec(d.triuu);
    out.triuu = {
      rows: (Array.isArray(t.rows) ? t.rows : []).map((x) => {
        const rr = rec(x);
        return { s1: nn(rr.s1), cu: nn(rr.cu) };
      }),
      cu_uu: nn(t.cu_uu),
      eprouvettes: iv(t.eprouvettes),
    };
  }
  if (d.tricu) {
    const t = rec(d.tricu);
    out.tricu = {
      rows: (Array.isArray(t.rows) ? t.rows : []).map((x) => {
        const rr = rec(x);
        return { s: nn(rr.s), t: nn(rr.t) };
      }),
      c: nn(t.c),
      phi: nn(t.phi),
      eprouvettes: iv(t.eprouvettes),
    };
  }
  if (d.es) {
    const e = rec(d.es);
    out.es = {
      rows: (Array.isArray(e.rows) ? e.rows : []).map((x) => ({ se: nn(rec(x).se) })),
      es: nn(e.es),
      essais: iv(e.essais),
    };
  }
  if (d.la) {
    const l = rec(d.la);
    out.la = {
      la: nn(l.la),
      M: nn(l.M),
      label: sn(l.label),
      conformite: sn(l.conformite),
    };
  }
  if (d.sz) {
    const s = rec(d.sz);
    out.sz = {
      rows: (Array.isArray(s.rows) ? s.rows : []).map((x) => {
        const rr = rec(x);
        return { s: fin(rr.s) ? rr.s : 0, ref: nn(rr.ref), pas: nn(rr.pas) };
      }),
      sumPass: nn(s.sumPass),
      sz: nn(s.sz),
    };
  }
  if (d.mde) {
    const m = rec(d.mde);
    const mode = m.mode === 'camp' ? 'camp' : 'norme';
    if (mode === 'camp') {
      out.mde = {
        mode: 'camp',
        pertes: (Array.isArray(m.pertes) ? m.pertes : []).map(nn),
        cmds: nn(m.cmds),
        cmde: nn(m.cmde),
        cmd: nn(m.cmd),
        mde: nn(m.mde),
      };
    } else {
      out.mde = {
        mode: 'norme',
        rows: (Array.isArray(m.rows) ? m.rows : []).map((x) => ({ cc: nn(rec(x).cc) })),
        mde: nn(m.mde),
        essais: iv(m.essais),
        label: sn(m.label),
        conformite: sn(m.conformite),
      };
    }
  }
  if (d.rho) {
    const r = rec(d.rho);
    out.rho = { ra: nn(r.ra), rrd: nn(r.rrd), rssd: nn(r.rssd), wa: nn(r.wa) };
  }
  if (d.sulf) {
    const s = rec(d.sulf);
    out.sulf = { so3: nn(s.so3), so4: nn(s.so4) };
  }
  return out;
}

/** Projette une droite de regression { a, b } (NaN/∞ ecarte -> null). */
function reg2(x: unknown): { a: number; b: number } | null {
  const r = rec(x);
  return fin(r.a) && fin(r.b) ? { a: r.a, b: r.b } : null;
}

/**
 * Collecte les ALERTES normatives par feuille (ce que l'outil client AFFICHE dans ses
 * encarts « Controles… ») a partir du detail, pour alimenter le `warnings` de tete
 * (auparavant FIGE a []). Textes normatifs client-safe (aucune valeur secrete) ; passes
 * ensuite dans la redaction fail-closed par coherence. Prefixes par feuille.
 */
function collectWarnings(det: unknown): string[] {
  if (!det || typeof det !== 'object') return [];
  const d = det as Record<string, unknown>;
  const w: string[] = [];
  const att = rec(d.att);
  for (const s of strs(att.warns)) w.push(`Atterberg — ${s}`);
  const vbs = rec(d.vbs);
  if (vbs.lowV === true)
    w.push(
      'VBS — Volume de bleu V ≤ 10 cm³ (NF P 94-068 art. 7) : recommencer avec une prise de masse superieure.',
    );
  const pr = rec(d.proctor);
  const en = pr.energy ? rec(pr.energy) : null;
  if (en && en.ok === false)
    w.push(
      'Proctor — energie de compactage hors tolerance ± 8 % (EN 13286-2 Tableau 5).',
    );
  if (pr.horsTableau === true)
    w.push(
      'Proctor — combinaison moule + dame hors Tableau 5 (EN 13286-2) : la dame 15 kg s emploie avec le moule C.',
    );
  // ρs (pycnometre) — concordance des determinations (NF P 94-054, ≤ 0,03 Mg/m³).
  const rhos = rec(d.rhos);
  if (rhos.ok === false)
    w.push(
      'ρs — ecart entre determinations > 0,03 Mg/m³ (concordance NF P 94-054) : repeter l essai.',
    );
  // CBR — interpolation CBR/compacite (≥ 2 moules requis).
  const cbr = rec(d.cbr);
  if (iv(cbr.moules) > 0 && iv(cbr.moules) < 2)
    w.push('CBR — moins de 2 moules valides : interpolation CBR/compacite impossible.');
  // Cisaillement — regression c′/φ′ (min. 3 eprouvettes, Annexe B).
  const ci = rec(d.cisail);
  if (iv(ci.eprouvettes) > 0 && iv(ci.eprouvettes) < 3)
    w.push('Cisaillement — moins de 3 eprouvettes (Annexe B) : droite c′/φ′ peu fiable.');
  // Masse volumique apparente — representativite (V ≥ 50 cm³).
  const dens = rec(d.dens);
  if (dens.petitV === true)
    w.push('Masse volumique — V < 50 cm³ : eprouvette moins representative.');
  // Œdometre — nombre de paliers (min. 7 conseilles).
  const oedo = rec(d.oedo);
  if (iv(oedo.points) > 0 && iv(oedo.points) < 7)
    w.push('Œdometre — moins de 7 paliers : Cc/Cs calcules sur peu de points.');
  // Los Angeles — conformite granulaire de la prise (hors plage).
  const la = rec(d.la);
  if (typeof la.conformite === 'string' && la.conformite.startsWith('✗'))
    w.push(`Los Angeles — prise d essai hors plage granulaire : ${la.conformite}`);
  // Micro-Deval — conformite granulaire + nombre d eprouvettes (Art. 6).
  const mde = rec(d.mde);
  if (typeof mde.conformite === 'string' && mde.conformite.startsWith('✗'))
    w.push(`Micro-Deval — prise d essai hors plage granulaire : ${mde.conformite}`);
  if (mde.mode === 'norme' && iv(mde.essais) === 1)
    w.push('Micro-Deval — 2 eprouvettes requises (Art. 6).');
  return w;
}

/**
 * Re-FORME le resultat brut { D, cls } en la SORTIE whitelistee. On CONSTRUIT un objet
 * propre champ a champ : les grandeurs de labo (D) + la classe GTR. Les libelles de la
 * classe (path/warn) sont REDACTES (defense en profondeur — ici sans cible reelle, les
 * valeurs etant client-safe).
 */
function shapeOutput(R: Record<string, unknown>): unknown {
  const D = (R.D ?? {}) as Record<string, unknown>;
  const cls = (R.cls ?? null) as Record<string, unknown> | null;

  const emptyClasse = {
    fam: null,
    code: null,
    full: null,
    desc: '',
    path: [] as string[],
    caveats: [] as string[],
    etat: null,
    stApplies: false,
    rNote: null,
  };

  // Cas d'erreur de calcul (science levee).
  if (typeof R.err === 'string') {
    return {
      erreur: sanitizeEngineError(R.err),
      warnings: [],
      wn: null,
      dmax: null,
      p80: null,
      p2: null,
      Cu: null,
      Cc: null,
      mf: null,
      mfq: null,
      wl: null,
      wp: null,
      ip: null,
      ic: null,
      vbs: null,
      rhos: null,
      wopn: null,
      rdmax: null,
      cbr: null,
      cbrType: null,
      gonfl: null,
      rho_app: null,
      rhod_app: null,
      es: null,
      la: null,
      sz: null,
      mde: null,
      wa: null,
      so3: null,
      qu: null,
      c_cis: null,
      phi_cis: null,
      phiR_cis: null,
      c: null,
      phi: null,
      cu_uu: null,
      e0_oedo: null,
      Cc_oedo: null,
      Cs_oedo: null,
      k: null,
      natureLigneA: null,
      classe: emptyClasse,
      detail: null,
    };
  }

  // NB : `classe.path`/`rNote`/`caveats` sont des LIBELLES NORMATIFS d'explication du
  // classement GTR — le LIVRABLE meme de l'outil (ex. « Passant 80µm = 52 % > 35 % →
  // famille A »), CLIENT-SAFE (les etiquettes portent des valeurs deja exposees).
  // `caveats` (= classify().warn) est l'encart « Points a verifier » du client, VERBATIM
  // (y compris la ligne C1/C2) : decision titulaire 14/07 « reprendre comme le client »
  // (« zero ecart ») — auparavant masque, desormais expose (aucune valeur confidentielle).
  const strArr = (a: unknown): string[] =>
    Array.isArray(a) ? a.filter((s): s is string => typeof s === 'string') : [];
  const classe = cls
    ? {
        fam: sn(cls.fam),
        code: sn(cls.code),
        full: sn(cls.full),
        desc: typeof cls.desc === 'string' ? cls.desc : '',
        path: strArr(cls.path),
        caveats: strArr(cls.warn),
        etat: sn(cls.etat),
        stApplies: cls.stApplies === true,
        rNote: Array.isArray(cls.rNote) ? strArr(cls.rNote) : null,
      }
    : emptyClasse;

  const det = R.det;
  return {
    erreur: null,
    // ALERTES normatives par feuille (encart « Controles… » du client) — auparavant FIGE
    // a [] ; alimente depuis le detail, redacte fail-closed par coherence (§8).
    warnings: redactConfidentialWarnings(collectWarnings(det)),
    wn: nn(D.wn),
    dmax: nn(D.dmax),
    p80: nn(D.p80),
    p2: nn(D.p2),
    Cu: nn(D.Cu),
    Cc: nn(D.Cc),
    mf: nn(D.mf),
    mfq: sn(D.mfq),
    wl: nn(D.wl),
    wp: nn(D.wp),
    ip: nn(D.ip),
    ic: nn(D.ic),
    vbs: nn(D.vbs),
    rhos: nn(D.rhos),
    wopn: nn(D.wopn),
    rdmax: nn(D.rdmax),
    cbr: nn(D.cbr),
    cbrType: sn(D.cbrType),
    gonfl: nn(D.gonfl),
    rho_app: nn(D.rho_app),
    rhod_app: nn(D.rhod_app),
    es: nn(D.es),
    la: nn(D.la),
    sz: nn(D.sz),
    mde: nn(D.mde),
    wa: nn(D.wa),
    so3: nn(D.so3),
    qu: nn(D.qu),
    c_cis: nn(D.c_cis),
    phi_cis: nn(D.phi_cis),
    phiR_cis: nn(D.phiR_cis),
    c: nn(D.c),
    phi: nn(D.phi),
    cu_uu: nn(D.cu_uu),
    e0_oedo: nn(D.e0_oedo),
    Cc_oedo: nn(D.Cc_oedo),
    Cs_oedo: nn(D.Cs_oedo),
    k: nn(D.k),
    natureLigneA: natureLigneA(D.wl, D.ip),
    classe,
    detail: shapeDetail(det),
  };
}

/**
 * Nature vis-a-vis de la LIGNE A du diagramme de plasticite — readout « Nature » de
 * l'onglet Atterberg, DERIVE VERBATIM de wL et Ip (calcAtt L.1058) :
 *   aline = 0,73·(wL−20) ; Ip > aline -> « Argile (au-dessus ligne A) », sinon
 *   « Limon / sol organique (sous ligne A) ». null si wL/Ip absent (parite HTML
 *   `if(ip!=null&&wL!=null)`). Ce n'est PAS une correction du moteur : la meme regle
 *   d'affichage que le client, appliquee a des resultats DEJA exposes (wL, Ip).
 */
function natureLigneA(wl: unknown, ip: unknown): string | null {
  if (!fin(wl) || !fin(ip)) return null;
  const aline = 0.73 * (wl - 20);
  return ip > aline
    ? 'Argile (au-dessus ligne A)'
    : 'Limon / sol organique (sous ligne A)';
}

/** Resolution une fois pour toutes de la meta de version (depuis le registre). */
function resolveMeta(): {
  engineId: typeof LABO_ENGINE_ID;
  engineVersion: EngineVersion;
  engineSourceHash?: EngineSourceHash;
} {
  const entry = findEngine(LABO_ENGINE_ID);
  if (!entry) {
    throw new Error(`Moteur "${LABO_ENGINE_ID}" absent du registre des versions.`);
  }
  return {
    engineId: LABO_ENGINE_ID,
    engineVersion: entry.version as EngineVersion,
    engineSourceHash: entry.sha256 as EngineSourceHash,
  };
}

/**
 * Calcul FASTLAB client-safe : valide l'entree, recalcule cote serveur, projette la
 * sortie sur la whitelist, renvoie l'enveloppe { ok, meta, output }.
 *
 * @param rawInput entree NON fiable (issue HTTP) ; validee par le contrat.
 */
export function runLabo(rawInput: unknown): EngineResultEnvelope<LaboOutput> {
  const input: LaboInput = LaboInputSchema.parse(rawInput);
  const rawResult = computeLaboDetail(input) as Record<string, unknown>;
  const shaped = shapeOutput(rawResult);
  const output = projectEngineOutput(LaboOutputSchema, shaped);
  return { ok: true, meta: resolveMeta(), output };
}

void laboContract; // garde l'import du contrat (verifie anti-passthrough au chargement)
