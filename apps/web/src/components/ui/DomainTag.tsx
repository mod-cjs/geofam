/**
 * A-07 — Domain Tag (tag de domaine métier)
 *
 * Préfixe texte NON SUPPRIMABLE : CH. / FD. / LB.
 * Pastille 6px seule INTERDITE (ADR 0008)
 * Redondance non-chromatique : préfixe texte (impression N&B, daltonisme)
 *
 * Accepte :
 *   - ProjectDomain ('CH' | 'FD' | 'LB') — couche données API
 *   - Domain sémantique ('road' | 'foundation' | 'lab') — couche design system
 *
 * Pas de cast `as Domain` : le mapping est exhaustif sur ProjectDomain.
 * Un domaine inconnu (valeur future non encore mappée) affiche le libellé
 * brut sur fond neutre — jamais d'exception.
 */

import type { ProjectDomain } from '@/lib/api/types';

export type Domain = 'road' | 'foundation' | 'lab';

/**
 * Toutes les valeurs de ProjectDomain sont couvertes.
 * Si un nouveau code est ajouté à ProjectDomain, TypeScript signalera
 * une propriété manquante dans ce Record (exhaustivité garantie sans cast).
 */
const PROJECT_DOMAIN_TO_DOMAIN: Record<ProjectDomain, Domain> = {
  CH: 'road',
  FD: 'foundation',
  LB: 'lab',
};

/**
 * Config d'affichage par clé sémantique.
 * Exhaustif sur Domain — si Domain s'étend, TypeScript force la mise à jour.
 */
const domainConfig: Record<
  Domain,
  { prefix: string; label: string; bg: string; tx: string }
> = {
  road: {
    prefix: 'CH.',
    label: 'Chaussées',
    bg: 'var(--domain-road-bg)',
    tx: 'var(--domain-road-tx)',
  },
  foundation: {
    prefix: 'FD.',
    label: 'Fondations',
    bg: 'var(--domain-found-bg)',
    tx: 'var(--domain-found-tx)',
  },
  lab: {
    prefix: 'LB.',
    label: 'Laboratoire',
    bg: 'var(--domain-lab-bg)',
    tx: 'var(--domain-lab-tx)',
  },
};

interface DomainTagProps {
  /**
   * Accepte les clés sémantiques (road/foundation/lab), les codes data (CH/FD/LB),
   * ou `null` pour un projet LEGACY sans domaine (rendu neutre « Non renseigné »).
   */
  domain: Domain | ProjectDomain | null;
  /** Afficher en mode compact (liste calculs) ou standalone (bibliothèque) */
  size?: 'compact' | 'normal';
  className?: string;
}

/**
 * Normalise n'importe quelle valeur domain acceptée en clé sémantique.
 * Retourne null si la valeur n'est pas reconnue (fallback défensif).
 */
function toDomain(domain: Domain | ProjectDomain): Domain | null {
  // Clé sémantique directe
  if (domain in domainConfig) return domain as Domain;
  // Code ProjectDomain
  if (domain in PROJECT_DOMAIN_TO_DOMAIN) {
    return PROJECT_DOMAIN_TO_DOMAIN[domain as ProjectDomain];
  }
  return null;
}

export function DomainTag({ domain, size = 'normal', className }: DomainTagProps) {
  const key = domain === null ? null : toDomain(domain);

  // Fallback défensif : domaine null (projet legacy) → « Non renseigné » ; valeur
  // inconnue → libellé brut. Fond neutre dans les deux cas, jamais d'exception.
  const cfg =
    key !== null
      ? domainConfig[key]
      : {
          prefix: '',
          label: domain === null ? 'Non renseigné' : String(domain),
          bg: 'var(--color-alt)',
          tx: 'var(--color-text-sec)',
        };

  const isCompact = size === 'compact';

  return (
    <span
      className={className}
      title={cfg.label}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: isCompact ? 4 : 5,
        padding: isCompact ? '1px 5px' : '2px 7px',
        borderRadius: 'var(--radius-sm)',
        background: cfg.bg,
        color: cfg.tx,
        fontSize: isCompact ? 10 : 11,
        fontWeight: 600,
        lineHeight: 1,
        userSelect: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      {/* Préfixe texte — NON SUPPRIMABLE */}
      <span style={{ letterSpacing: '0.03em' }}>{cfg.prefix}</span>

      {/* Pastille 6px — complément visuel, jamais seule */}
      <span
        aria-hidden="true"
        style={{
          display: 'inline-block',
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: cfg.tx,
          flexShrink: 0,
          opacity: 0.7,
        }}
      />

      {/* Libellé complet en variante normale */}
      {!isCompact && <span style={{ fontWeight: 500 }}>{cfg.label}</span>}
    </span>
  );
}
