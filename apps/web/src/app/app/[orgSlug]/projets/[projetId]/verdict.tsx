/**
 * Rendu commun du verdict de conformité — CONFORME / NON CONFORME / NON
 * APPLICABLE — partagé entre l'historique des calculs (CalculsClient) et la
 * liste des PV scellés (PvListClient).
 *
 * ADR 0008 — triple redondance obligatoire (couleur + icône + libellé), pour
 * rester lisible en impression noir & blanc et pour le daltonisme. Le
 * troisième verdict, NON APPLICABLE (moteur d'extraction/classification, sans
 * notion de conformité — cf. NormalizedCalcOutput), est NEUTRE : ni réussite
 * ni échec. Il ne doit donc emprunter NI `--status-pass-*` NI `--status-fail-*`
 * (rouge/vert = verdicts de conformité uniquement). Faute de token neutre
 * dédié dans le système de design actuel (`--status-neutral-*` reste un
 * amendement ADR 0008 proposé, pas encore tranché), le style neutre est
 * dérivé de tokens EXISTANTS (`--text-muted`) via `color-mix` — aucune
 * couleur en dur, aucune nouvelle variable introduite.
 *
 * IMPORTANT (DoD §8) : ce module ne fait AUCUN calcul — il affiche un
 * `Verdict` ('PASS'|'FAIL'|'NA') déjà résolu ailleurs. MAIS ce verdict n'a pas
 * la même provenance selon l'appelant, et l'écart mérite d'être écrit noir sur
 * blanc plutôt que de laisser croire à une seule source de vérité :
 *
 *  - `OfficialPv.verdict` (PV SCELLÉ) : copie du verdict SCELLÉ par le serveur
 *    (`apps/api/src/pv/verdict.ts` resolveVerdict, colonne `official_pvs.verdict`,
 *    ADR 0012). C'est la valeur qui fait foi — cf. `adaptOfficialPv` (adapters.ts),
 *    qui mappe CONFORME/NON_CONFORME/NON_APPLICABLE → PASS/FAIL/NA. Rien n'est
 *    recalculé côté navigateur sur ce chemin.
 *  - `extractVerdict(output)` (historique NON scellé, `CalcResult.output` via
 *    `NormalizedCalcOutput`) : une RE-DÉRIVATION côté navigateur, par
 *    duck-typing sur la sortie moteur normalisée (`normalizeOutput`,
 *    adapters.ts) — une IMPLÉMENTATION DISTINCTE de `resolveVerdict`, qui vit
 *    dans le bundle navigateur. `CalcResult` n'a pas de colonne verdict
 *    scellée (seul un PV en a une) : c'est le seul verdict disponible pour un
 *    calcul pas encore scellé, mais il PEUT diverger de ce que scellerait un
 *    PV ultérieur sur le même calcul (ex. moteur non reconnu par la whitelist
 *    → `undefined` ici, mais `NON_APPLICABLE` explicite côté serveur/scellé).
 *    DETTE assumée, pas corrigée dans ce lot : harmoniser demanderait que le
 *    serveur expose aussi un verdict pré-scellement sur `CalcResult`, ce qui
 *    n'existe pas aujourd'hui.
 */

import { Check, Minus, X } from 'lucide-react';
import type { CSSProperties } from 'react';

export type Verdict = 'PASS' | 'FAIL' | 'NA';

const LABEL_FULL: Record<Verdict, string> = {
  PASS: 'CONFORME',
  FAIL: 'NON CONFORME',
  NA: 'NON APPLICABLE',
};

// Libellé abrégé — listes denses (historique des calculs, liste des PV),
// aligné sur la maquette finale (« NON CONF. » / « NON APPLIC. »).
const LABEL_COMPACT: Record<Verdict, string> = {
  PASS: 'CONFORME',
  FAIL: 'NON CONF.',
  NA: 'NON APPLIC.',
};

function verdictColors(verdict: Verdict): CSSProperties {
  if (verdict === 'PASS') {
    return { color: 'var(--status-pass-tx)', background: 'var(--status-pass-bg)' };
  }
  if (verdict === 'FAIL') {
    return { color: 'var(--status-fail-tx)', background: 'var(--status-fail-bg)' };
  }
  // NA — neutre : ni vert ni rouge (ADR 0008). Dérivé de --text-muted existant.
  return {
    color: 'var(--text-muted)',
    background: 'color-mix(in srgb, var(--text-muted) 16%, transparent)',
  };
}

function VerdictIcon({ verdict }: { verdict: Verdict }) {
  if (verdict === 'PASS')
    return (
      <Check size={10} strokeWidth={3} aria-hidden="true" style={{ flexShrink: 0 }} />
    );
  if (verdict === 'FAIL')
    return <X size={10} strokeWidth={2.5} aria-hidden="true" style={{ flexShrink: 0 }} />;
  // Neutre : tiret plutôt qu'une croix — ni succès ni échec.
  return (
    <Minus size={10} strokeWidth={2.5} aria-hidden="true" style={{ flexShrink: 0 }} />
  );
}

interface VerdictTagProps {
  verdict: Verdict;
  /** Libellé abrégé (listes denses) — sinon libellé complet. */
  compact?: boolean;
  style?: CSSProperties;
  className?: string;
}

export function VerdictTag({ verdict, compact, style, className }: VerdictTagProps) {
  const label = compact ? LABEL_COMPACT[verdict] : LABEL_FULL[verdict];
  return (
    <span
      className={className}
      // Triple redondance ADR 0008 : couleur (background/color) + icône + texte.
      aria-label={`Verdict : ${LABEL_FULL[verdict]}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontFamily: 'var(--font-mono)',
        fontSize: 9.5,
        fontWeight: 700,
        letterSpacing: '0.02em',
        padding: '3px 7px',
        borderRadius: 'var(--radius-sm)',
        flexShrink: 0,
        whiteSpace: 'nowrap',
        ...verdictColors(verdict),
        ...style,
      }}
    >
      <VerdictIcon verdict={verdict} />
      {label}
    </span>
  );
}

/**
 * Extrait un verdict valide d'une sortie moteur normalisée (whitelist §8),
 * quelle que soit sa provenance (`CalcResult.output` / `OfficialPv.output`).
 * Défensif : toute valeur inattendue (absente, moteur pas encore terminé…)
 * retourne `undefined` plutôt que de risquer un mauvais verdict affiché.
 */
export function extractVerdict(output: unknown): Verdict | undefined {
  const v = (output as { verdict?: unknown } | null | undefined)?.verdict;
  return v === 'PASS' || v === 'FAIL' || v === 'NA' ? v : undefined;
}
