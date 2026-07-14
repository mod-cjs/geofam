/**
 * Indicateurs d'appréciation EC7 annexe H — radier GEOPLAQUE.
 *
 * Décision titulaire du 14/07 : reproduire À L'IDENTIQUE les indicateurs vert/
 * orange/rouge du client (mêmes seuils, mêmes libellés), appliqués à nos
 * valeurs de sortie DÉJÀ whitelistées (rows du radier, cf. adapters.ts
 * `buildRadierRows`). Logique d'AFFICHAGE côté client uniquement — aucun
 * recalcul, aucun seuil de conformité inventé : tout est repris du HTML
 * client GEOPLAQUE_V10.html (fonctions `lvlSettle`/`lvlDiff`/`lvlBeta`/`chk`,
 * ~L.2480-2568, + libellés de verdict de `printReport`, ~L.1331).
 *
 * Tolérance §9 (zéro faux-vert / jamais de NaN affiché) : une grandeur absente
 * ou non numérique ne produit PAS d'indicateur — elle est simplement omise
 * (le chantier moteur en cours peut ne pas encore exposer θx/θy, p min/max…).
 */

import type { CalcOutputRow } from '@/lib/api/types';

export type IndicatorLevel = 'ok' | 'warn' | 'bad';

/**
 * Tassement total max — GEOPLAQUE_V10.html:2480
 *   function lvlSettle(mm){ return mm<=25?'ok':mm<=50?'warn':'bad'; }
 * Repère affiché par le client (chk L.2564 / printReport L.1339) : « ≈ 50 mm ».
 */
export function levelSettlement(mm: number): IndicatorLevel {
  return mm <= 25 ? 'ok' : mm <= 50 ? 'warn' : 'bad';
}

/**
 * Tassement différentiel — GEOPLAQUE_V10.html:2481
 *   function lvlDiff(mm){ return mm<=10?'ok':mm<=20?'warn':'bad'; }
 * Repère (chk L.2565 / printReport L.1340) : « ≈ 20 mm ».
 */
export function levelDifferential(mm: number): IndicatorLevel {
  return mm <= 10 ? 'ok' : mm <= 20 ? 'warn' : 'bad';
}

/**
 * Distorsion angulaire β — GEOPLAQUE_V10.html:2482
 *   function lvlBeta(bv){ return bv<=1/500?'ok':bv<=1/150?'warn':'bad'; }
 * `bv` est un ratio sans dimension (rad) côté client. Chez nous, le solveur
 * sort la distorsion déjà en ‰ (= bv*1000 — cf. adapters.ts buildRadierRows,
 * commentaire "UNITÉS radier" L.900-907 : piège d'unité E-MPa×charges-kN×
 * géométrie-m, tranché et vérifié). Seuils convertis en ‰ :
 *   1/500 rad = 2 ‰ ; 1/150 rad = 1000/150 ‰ (≈ 6,667 ‰).
 * Repère (chk L.2566-2567 / printReport L.1341) : « ELS 1/500 · ELU 1/150 ».
 */
export function levelDistortion(perMille: number): IndicatorLevel {
  const okBound = 2; // 1/500 rad → ‰
  const warnBound = 1000 / 150; // 1/150 rad → ‰
  return perMille <= okBound ? 'ok' : perMille <= warnBound ? 'warn' : 'bad';
}

/**
 * Inclinaison d'ensemble ϖ (basculement rigide) — GEOPLAQUE_V10.html:2568 (inline,
 * même seuils que lvlBeta) :
 *   tilt<=1/500?'ok':tilt<=1/150?'warn':'bad'
 * et printReport L.1342 : `d.tiltMax<=1/500?'ok':d.tiltMax<=1/150?'warn':'bad'`.
 * Repère (chk L.2568) : « visible vers 1/500 » ; (printReport L.1342) : « visible ≈ 1/500 ».
 */
export function levelTilt(perMille: number): IndicatorLevel {
  return levelDistortion(perMille);
}

/**
 * Formatage "1/N" — GEOPLAQUE_V10.html:2479
 *   function ratio1(v){ if(!isFinite(v)||v<=0) return '—'; const N=Math.round(1/v); return '1/'+N.toLocaleString('fr-FR'); }
 * Adapté : notre grandeur d'entrée est déjà en ‰ (v = perMille/1000 en ratio),
 * donc N = round(1000/perMille) au lieu de round(1/v).
 */
export function formatDistortionRatio(perMille: number): string {
  if (!Number.isFinite(perMille) || perMille <= 0) return '—';
  const n = Math.round(1000 / perMille);
  return `1/${n.toLocaleString('fr-FR')}`;
}

/** Libellés de verdict — GEOPLAQUE_V10.html:1331 (printReport, fonction `verdict`). */
const VERDICT_LABEL: Record<IndicatorLevel, string> = {
  ok: 'CONFORME',
  warn: 'ATTENTION',
  bad: 'DÉPASSEMENT',
};

export interface Ec7Indicator {
  /** Clé stable (rendu React / tests) — pas affichée. */
  key: string;
  label: string;
  /** Valeur formatée pour affichage (déjà en unité + suffixe). */
  valueLabel: string;
  /** Repère normatif affiché à côté du libellé (texte du client, non recalculé). */
  repere: string;
  level: IndicatorLevel;
  verdictLabel: string;
}

/** Lit une row par libellé exact ; renvoie undefined si absente ou non numérique (tolérant, jamais de NaN). */
function findRowNumber(rows: CalcOutputRow[], label: string): number | undefined {
  const found = rows.find((r) => r.label === label);
  if (!found) return undefined;
  return typeof found.value === 'number' && Number.isFinite(found.value)
    ? found.value
    : undefined;
}

/**
 * Construit les indicateurs EC7 annexe H à partir des rows DÉJÀ whitelistées du
 * radier (adapters.ts `buildRadierRows`). Ordre = celui du tableau « Vérifications
 * EC7 » du client (GEOPLAQUE_V10.html L.2563-2575) : tassement max → différentiel
 * → distorsion gouvernante → inclinaison d'ensemble → [entre plaques] → [entre
 * charges voisines]. Les deux derniers sont conditionnels, comme chez le client
 * (`if(d.nRafts>1)` / `if(lp&&lp.worst)`).
 *
 * Tolérance : une grandeur absente (chantier moteur pas encore complet, ex.
 * θx/θy, p min/max) ou non numérique => l'indicateur correspondant est omis,
 * jamais rendu avec une valeur NaN.
 */
export function computeGeoplaqueEc7Indicators(rows: CalcOutputRow[]): Ec7Indicator[] {
  const out: Ec7Indicator[] = [];

  const wMax = findRowNumber(rows, 'Tassement maximal w_max');
  if (wMax !== undefined) {
    const level = levelSettlement(wMax);
    out.push({
      key: 'settlement',
      label: 'Tassement total max',
      valueLabel: `${wMax.toFixed(1)} mm`,
      repere: '≈ 50 mm',
      level,
      verdictLabel: VERDICT_LABEL[level],
    });
  }

  const diff = findRowNumber(rows, 'Tassement différentiel');
  if (diff !== undefined) {
    const level = levelDifferential(diff);
    out.push({
      key: 'differential',
      label: 'Tassement différentiel',
      valueLabel: `${diff.toFixed(1)} mm`,
      repere: '≈ 20 mm',
      level,
      verdictLabel: VERDICT_LABEL[level],
    });
  }

  const betaGov = findRowNumber(rows, 'Distorsion angulaire gouvernante β');
  if (betaGov !== undefined) {
    const level = levelDistortion(betaGov);
    out.push({
      key: 'beta',
      label: 'Distorsion angulaire β',
      valueLabel: formatDistortionRatio(betaGov),
      repere: 'ELS 1/500 · ELU 1/150',
      level,
      verdictLabel: VERDICT_LABEL[level],
    });
  }

  const tilt = findRowNumber(rows, "Inclinaison d'ensemble ϖ");
  if (tilt !== undefined) {
    const level = levelTilt(tilt);
    out.push({
      key: 'tilt',
      label: "Inclinaison d'ensemble ϖ",
      valueLabel: formatDistortionRatio(tilt),
      repere: 'visible ≈ 1/500',
      level,
      verdictLabel: VERDICT_LABEL[level],
    });
  }

  const betaInter = findRowNumber(rows, 'Distorsion entre plaques');
  if (betaInter !== undefined) {
    const level = levelDistortion(betaInter);
    out.push({
      key: 'beta-inter',
      label: 'Distorsion entre plaques',
      valueLabel: formatDistortionRatio(betaInter),
      repere: 'ELS 1/500',
      level,
      verdictLabel: VERDICT_LABEL[level],
    });
  }

  const betaLoads = findRowNumber(rows, 'Distorsion max entre charges voisines');
  if (betaLoads !== undefined) {
    const level = levelDistortion(betaLoads);
    out.push({
      key: 'beta-loads',
      label: 'Distorsion max entre charges voisines',
      valueLabel: formatDistortionRatio(betaLoads),
      repere: 'ELS 1/500 · ELU 1/150',
      level,
      verdictLabel: VERDICT_LABEL[level],
    });
  }

  return out;
}
