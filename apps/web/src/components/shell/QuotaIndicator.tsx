'use client';

/**
 * Item PRODUIT #2 — indicateur de quota compact et permanent (Topbar).
 *
 * Le quota d'abonnement (ADR 0011) se consomme par CALCUL exécuté (pas par PV
 * émis — un calcul peut ne jamais être scellé) : cf. `calc-results.service.ts`
 * côté backend (décompte à la création du calc-result). Le libellé reprend
 * donc « calculs », cohérent avec le texte déjà utilisé par la galerie
 * logiciels (« X calcul(s) restant(s) sur Y ») plutôt que « PV ».
 *
 * Fail-quiet : tant que les entitlements ne sont pas chargés (ou en erreur),
 * l'indicateur ne s'affiche pas plutôt que d'afficher une donnée fausse —
 * aucun fail-open sur un chiffre non vérifié.
 */

import { useEffect, useState } from 'react';

import { getEntitlements } from '@/lib/api/client';
import type { EntitlementsResponse } from '@/lib/api/types';
import { quotaPercent, quotaSeverity, type QuotaSeverity } from '@/lib/subscription-gate';
import { useOrgId } from '@/lib/org-context';

interface Props {
  orgSlug: string;
}

/**
 * Couleurs calibrées pour la lisibilité sur fond asphalte (surface-nav) —
 * distinctes de --status-pass-tx/--status-fail-tx qui sont calibrées pour une
 * surface claire (cf. QuotaBar, utilisé sur surface-base).
 */
const SEVERITY_COLOR: Record<QuotaSeverity, string> = {
  ok: '#7fbf94',
  warning: 'var(--accent-action-on-nav)',
  critical: '#e69a97',
};

export function QuotaIndicator({ orgSlug }: Props) {
  const orgId = useOrgId(orgSlug);
  const [ent, setEnt] = useState<EntitlementsResponse | null>(null);

  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    getEntitlements(orgId)
      .then((e) => {
        if (!cancelled) setEnt(e);
      })
      .catch(() => {
        // Fail-quiet : pas d'affichage plutôt qu'un chiffre non vérifié.
        if (!cancelled) setEnt(null);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  if (!ent) return null;

  const pct = quotaPercent(ent.quota);
  const severity = quotaSeverity(pct);
  const color = ent.expired ? SEVERITY_COLOR.critical : SEVERITY_COLOR[severity];

  const detail = ent.expired
    ? `Abonnement expiré — ${ent.quota.used} sur ${ent.quota.limit} calculs consommés (${pct} %)`
    : `Quota : ${ent.quota.used} sur ${ent.quota.limit} calculs consommés (${pct} %)`;

  return (
    <div
      role="status"
      aria-label={detail}
      title={detail}
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: 3,
        padding: '4px 10px',
        height: 30,
        borderRadius: 'var(--radius-base)',
        background: 'var(--nav-hover)',
        flexShrink: 0,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          fontSize: 'var(--text-xs)',
          color: 'var(--text-on-nav)',
          whiteSpace: 'nowrap',
          lineHeight: 1,
        }}
      >
        {ent.quota.used}/{ent.quota.limit} calculs · {pct} %
      </span>
      <span
        aria-hidden="true"
        style={{
          width: 60,
          height: 3,
          borderRadius: 2,
          background: 'rgba(255,255,255,0.15)',
          overflow: 'hidden',
          display: 'block',
        }}
      >
        <span
          style={{
            display: 'block',
            width: `${pct}%`,
            height: '100%',
            background: color,
            borderRadius: 2,
          }}
        />
      </span>
    </div>
  );
}
