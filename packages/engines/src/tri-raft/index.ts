/**
 * Module RADIER TRIANGULAIRE (DKT) sur sol multicouche elastique (variante mailleur
 * triangulaire de GEOPLAQUE, `solveTriRaft`) — point d'entree PUR & client-safe.
 *
 * Chaine : entree validee -> moteur d'origine (computeTriRaft) -> PROJECTION du resultat
 * brut `R` sur la sortie whitelistee (contract.ts : DIAGNOSTICS GLOBAUX uniquement) ->
 * enveloppe de resultat (meta + output). Aucun DOM, aucune horloge, aucun hasard.
 *
 * Importe UNIQUEMENT par apps/api (recalcul serveur). Le front ne voit que les TYPES du
 * contrat via @roadsen/shared, jamais ce module (garde-fou ESLint + controle de bundle
 * CI, DoD §8). Meme patron que radier/index.ts.
 *
 * --- ANTI-FUITE (DoD §8) ---
 * On CONSTRUIT champ a champ un objet propre ne portant QUE les diagnostics globaux
 * (tassements en mm, reaction sol max, bilans charge/reaction, nb de plaques, cote
 * d'assise) ; les CHAMPS NODAUX (`w`/`p`) et surtout la TOPOLOGIE DE MAILLAGE (`P` =
 * coordonnees des nœuds, `tris` = connectivite, `N`/`nt` = densite du maillage) sont
 * ECARTES ici, puis re-strippes par projectEngineOutput a travers le schema `.strict()`.
 *
 * --- DIVERGENCE SCIENTIFIQUE (a documenter cote UI) ---
 * Ce solveur IGNORE les charges `on:'soil'` (pas de tassement champ-libre) et les moments
 * Mx/My (effort vertical Fz seul), contrairement au radier ACM (solveModel). L'etat est
 * conserve pour fidelite de portage, mais l'UI doit signaler que ces composantes ne sont
 * PAS prises en compte par ce mode.
 */
import {
  projectEngineOutput,
  type EngineResultEnvelope,
  type EngineVersion,
  type EngineSourceHash,
} from '@roadsen/shared';

import { findEngine } from '../registry/registry.js';

import {
  TRI_RAFT_ENGINE_ID,
  TriRaftInputSchema,
  TriRaftOutputSchema,
  triRaftContract,
  type TriRaftInput,
  type TriRaftOutput,
} from './contract.js';
import { computeTriRaft } from './engine.js';

export {
  TRI_RAFT_ENGINE_ID,
  TriRaftInputSchema,
  TriRaftOutputSchema,
  triRaftContract,
  type TriRaftInput,
  type TriRaftOutput,
};
export { TRI_RAFT_CONFIDENTIAL_MARKER } from './engine.js';
export { TRI_RAFT_FIXTURES, type TriRaftFixture } from './test-fixtures.js';

/** Garde booleen : valeur numerique finie utilisable. */
function fin(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

/** Point-dans-polygone (ray casting) — masque la heatmap sur le CONTOUR SAISI (bord
 * INDEPENDANT du maillage triangulaire, cf. patron radier §8). */
function pointInAnyRaft(
  px: number,
  py: number,
  polys: ReadonlyArray<ReadonlyArray<{ x: number; y: number }>>,
): boolean {
  for (const pts of polys) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i],
        b = pts[j];
      if (!a || !b) continue;
      const intersect =
        a.y > py !== b.y > py && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x;
      if (intersect) inside = !inside;
    }
    if (inside) return true;
  }
  return false;
}

/**
 * RE-ECHANTILLONNE le champ de deflexion `R.w` (aux nœuds du maillage TRIANGULAIRE, dont
 * les coordonnees sont dans `R.P = [[x,y],…]`) en une grille FIXE ≤48×48 DECOUPLEE de ce
 * maillage (IDW lissee + masque contour) — MEME algorithme design-sur que la heatmap radier
 * ACM. On lit `R.P`/`R.w` EN INTERNE ; on n'expose QUE la grille (jamais les coordonnees des
 * nœuds, la connectivite `tris`, ni la densite `N`/`nt`). Le rendu triangule est EXCLU.
 */
function buildTriHeatmap(
  R: Record<string, unknown>,
  polys?: ReadonlyArray<ReadonlyArray<{ x: number; y: number }>>,
): unknown {
  const P = R.P,
    wv = R.w;
  if (!Array.isArray(P) || !(Array.isArray(wv) || ArrayBuffer.isView(wv)))
    return undefined;
  const ws = wv as ArrayLike<number>;
  const N = Math.min(P.length, ws.length);
  if (N < 3) return undefined;
  // Coordonnees des nœuds extraites EN INTERNE (jamais exposees) depuis P=[[x,y],…].
  const xs: number[] = new Array(N);
  const ys: number[] = new Array(N);
  for (let i = 0; i < N; i++) {
    const p = P[i] as ArrayLike<number> | undefined;
    xs[i] = p && fin(p[0]) ? (p[0] as number) : NaN;
    ys[i] = p && fin(p[1]) ? (p[1] as number) : NaN;
  }
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (let i = 0; i < N; i++) {
    const xi = xs[i]!,
      yi = ys[i]!;
    if (!fin(xi) || !fin(yi)) continue;
    if (xi < x0) x0 = xi;
    if (xi > x1) x1 = xi;
    if (yi < y0) y0 = yi;
    if (yi > y1) y1 = yi;
  }
  if (!fin(x0) || x1 <= x0 || y1 <= y0) return undefined;
  const G = 48; // resolution FIXE, DECOUPLEE du maillage
  const cw = (x1 - x0) / (G - 1),
    ch = (y1 - y0) / (G - 1);
  // Memes garde-fous §8 que le radier : lissage plancher (cellule ET espacement nodal) +
  // masque point-dans-polygone (bord independant du maillage) sinon repli distance-au-nœud.
  const cell = Math.max(cw, ch);
  const nodeSpacing = Math.sqrt(((x1 - x0) * (y1 - y0)) / Math.max(1, N));
  const eps2 = Math.pow(Math.max(cell * 1.5, nodeSpacing * 1.2), 2);
  const maxD2 = Math.pow(cell * 3, 2);
  const hasPolys = Array.isArray(polys) && polys.length > 0;
  const vals: (number | null)[] = new Array(G * G).fill(null);
  let vMin = Infinity,
    vMax = -Infinity;
  for (let gy = 0; gy < G; gy++) {
    for (let gx = 0; gx < G; gx++) {
      const px = x0 + gx * cw,
        py = y0 + gy * ch;
      let sw = 0,
        swv = 0,
        nd = Infinity;
      for (let i = 0; i < N; i++) {
        const xi = xs[i]!,
          yi = ys[i]!,
          wi = ws[i];
        if (!fin(xi) || !fin(yi)) continue;
        const d2 = (px - xi) ** 2 + (py - yi) ** 2;
        if (d2 < nd) nd = d2;
        const wgt = 1 / (d2 + eps2);
        sw += wgt;
        swv += wgt * (wi !== undefined && fin(wi) ? wi : 0);
      }
      const dehors = hasPolys ? !pointInAnyRaft(px, py, polys) : nd > maxD2;
      if (dehors || sw === 0) continue;
      const val = swv / sw;
      vals[gy * G + gx] = val;
      if (val < vMin) vMin = val;
      if (val > vMax) vMax = val;
    }
  }
  if (!fin(vMin) || !fin(vMax)) return undefined;
  return { x0, y0, x1, y1, cols: G, rows: G, vals, vMin, vMax };
}

/**
 * ALLOWLIST des etiquettes dont la valeur `= <nombre>` est BENIGNE (jamais redactee) —
 * FAIL-CLOSED (inconnu => masque). Diagnostics exposes + libelles geometriques/de saisie.
 * Les intermediaires EF (champs nodaux, coordonnees de nœuds) ne sont PAS listes.
 * NB : le moteur ne pose AUCUN champ `warn` -> `warnings` structurellement vide ; la
 * redaction est une defense en profondeur.
 */
const BENIGN_VALUE_LABELS: ReadonlySet<string> = new Set([
  // Diagnostics exposes au PV.
  'wmax',
  'wmin',
  'diff',
  'reactionmax',
  'totalload',
  'sumreact',
  'nraft',
  'z0',
  // Geometrie / saisie legitime.
  'target',
  'e',
  'nu',
  'q',
  'x',
  'y',
  'p',
  'd',
  'foundd',
]);

/** Normalise une etiquette : minuscules + retrait des indices/apostrophes/separateurs. */
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
 * Redacte FAIL-CLOSED toute valeur `<token> = <nombre> [unite]` dont le token n'est PAS
 * dans l'ALLOWLIST benigne. Inconnu => masque.
 */
export function redactConfidentialWarning(text: string): string {
  const TOKEN = "([A-Za-z0-9\\u2090-\\u209c'\\u2019,/*_\\[\\]]+)";
  const valued = new RegExp(
    TOKEN + '\\s*=\\s*(-?[0-9][0-9.,e \\u202f\\s+-]*(?:MPa|kPa|kN|MN|mm|cm|m|rad)?)',
    'g',
  );
  return text.replace(valued, (whole, token: string) => {
    const norm = normalizeLabel(token);
    if (norm !== '' && BENIGN_VALUE_LABELS.has(norm)) {
      return whole;
    }
    return `${token} (valeur confidentielle masquee)`;
  });
}

/** Applique la redaction a TOUS les warnings (point de passage oblige). */
export function redactConfidentialWarnings(warnings: readonly string[]): string[] {
  return warnings.map((w) => redactConfidentialWarning(w));
}

/** Sortie vide (tous diagnostics a zero) — cas d'erreur de garde du moteur. */
const EMPTY_OUTPUT = {
  wMax: 0,
  wMin: 0,
  diff: 0,
  reactionMax: 0,
  totalLoad: 0,
  sumReact: 0,
  nRaft: 0,
  z0: 0,
} as const;

/**
 * Re-FORME le resultat brut `R` en la SORTIE whitelistee : VALEURS de DIAGNOSTIC GLOBAL
 * uniquement. On CONSTRUIT un objet propre champ a champ (jamais de copie brute) : les
 * champs NODAUX (`w`/`p`) et la TOPOLOGIE (`P`/`tris`/`N`/`nt`) sont ECARTES ici (non
 * lus). `diff` est recalcule (wMax - wMin) ; `reactionMax` = `pMax` (renomme).
 */
function shapeOutput(
  R: Record<string, unknown>,
  polys?: ReadonlyArray<ReadonlyArray<{ x: number; y: number }>>,
): unknown {
  if (typeof R.err === 'string') {
    return { erreur: redactConfidentialWarning(R.err), warnings: [], ...EMPTY_OUTPUT };
  }
  const warnings = redactConfidentialWarnings(
    Array.isArray(R.warn) ? R.warn.filter((w): w is string => typeof w === 'string') : [],
  );
  const wMax = fin(R.wMax) ? R.wMax : 0;
  const wMin = fin(R.wMin) ? R.wMin : 0;
  const hm = buildTriHeatmap(R, polys);
  return {
    erreur: null,
    warnings,
    wMax,
    wMin,
    diff: wMax - wMin,
    reactionMax: fin(R.pMax) ? R.pMax : 0,
    totalLoad: fin(R.totalLoad) ? R.totalLoad : 0,
    sumReact: fin(R.sumReact) ? R.sumReact : 0,
    nRaft: fin(R.nRaft) ? R.nRaft : 0,
    z0: fin(R.z0) ? R.z0 : 0,
    // Heatmap RE-ECHANTILLONNEE (decouplee du maillage triangulaire) — le motif, pas la methode.
    ...(hm ? { champDeflexion: hm } : {}),
  };
}

/** Resolution de la meta de version (depuis le registre). */
function resolveMeta(): {
  engineId: typeof TRI_RAFT_ENGINE_ID;
  engineVersion: EngineVersion;
  engineSourceHash?: EngineSourceHash;
} {
  const entry = findEngine(TRI_RAFT_ENGINE_ID);
  if (!entry) {
    throw new Error(`Moteur "${TRI_RAFT_ENGINE_ID}" absent du registre des versions.`);
  }
  return {
    engineId: TRI_RAFT_ENGINE_ID,
    engineVersion: entry.version as EngineVersion,
    engineSourceHash: entry.sha256 as EngineSourceHash,
  };
}

/**
 * Calcul radier triangulaire client-safe : valide l'entree, recalcule cote serveur,
 * projette la sortie sur la whitelist (diagnostics globaux), renvoie l'enveloppe
 * { ok, meta, output }.
 */
export function runTriRaft(rawInput: unknown): EngineResultEnvelope<TriRaftOutput> {
  const input: TriRaftInput = TriRaftInputSchema.parse(rawInput);
  const rawResult = computeTriRaft(input, input.opts) as Record<string, unknown>;
  // Contour SAISI des plaques -> masque heatmap point-dans-polygone (bord independant du
  // maillage triangulaire). Meme patron que le radier ACM.
  const polys = input.rafts.map((r) => r.pts.map((p) => ({ x: p.x, y: p.y })));
  const shaped = shapeOutput(rawResult, polys);
  const output = projectEngineOutput(TriRaftOutputSchema, shaped);
  return { ok: true, meta: resolveMeta(), output };
}

void triRaftContract; // garde l'import du contrat (verifie anti-passthrough au chargement)
