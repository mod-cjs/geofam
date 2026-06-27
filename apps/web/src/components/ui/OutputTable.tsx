'use client';

/**
 * A-09 — OutputTable (gabarit générique paramétrable)
 *
 * Gabarit de table de résultats de calcul — les colonnes effectives par moteur
 * seront du Code (combinatoire). Ce composant est le GABARIT réutilisable.
 *
 * Fonctionnalités :
 * - En-tête sticky via IntersectionObserver sentinelle (jamais listener scroll)
 * - Colonne identifiant gelée (sticky + z-index soigné)
 * - Ligne de sous-titre de groupe (fond pétrole)
 * - Chiffres Geist Mono tabular-nums alignés droite
 * - Hover ligne
 * - États : chargement skeleton (dimensions réelles, CLS=0) / vide / erreur inline / CALC_SUCCESS
 * - Entrée CALC_SUCCESS : opacity 0→1 + translateY(4px)→0, focus programmatique, aria-live
 * - Helper fmt() : Intl.NumberFormat('fr-FR') + espace fine U+202F
 */

import { AlertCircle } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

import { fmt } from './Metric';
import { SkeletonOutputTable } from './Skeleton';

export { fmt };

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface TableColumn {
  /** Clé unique */
  key: string;
  /** Libellé en-tête */
  label: string;
  /** Unité dans le th (jamais dans les cellules) */
  unit?: string;
  /** Colonne numérique (Geist Mono, text-align right) */
  numeric?: boolean;
  /** Largeur fixe en px */
  width?: number;
  /** Nombre de décimales pour fmt() (défaut 4) */
  decimals?: number;
}

export interface TableRow {
  /** Identifiant unique de la ligne */
  id: string;
  /** Données par clé de colonne — absent si la ligne est un séparateur de groupe */
  cells?: Record<string, string | number | null | undefined>;
  /** Si défini, cette ligne est un séparateur de groupe (fond pétrole) */
  groupLabel?: string;
}

export type OutputTableStatus = 'idle' | 'loading' | 'success' | 'error' | 'empty';

interface OutputTableProps {
  columns: TableColumn[];
  rows: TableRow[];
  status?: OutputTableStatus;
  /** Message d'erreur inline */
  error?: string;
  /** Libellé de la colonne identifiant (index 0 — toujours gelée) */
  idColumnLabel?: string;
  /** Nombre de lignes skeleton à afficher (défaut 6) */
  skeletonRows?: number;
  className?: string;
  style?: React.CSSProperties;
}

/* ------------------------------------------------------------------ */
/* Composant                                                           */
/* ------------------------------------------------------------------ */

export function OutputTable({
  columns,
  rows,
  status = 'idle',
  error,
  idColumnLabel = 'Paramètre',
  skeletonRows = 6,
  className,
  style,
}: OutputTableProps) {
  const [headerStuck, setHeaderStuck] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const ariaLiveRef = useRef<HTMLDivElement>(null);
  const liveId = useId();

  /* Sticky header via IntersectionObserver sentinelle */
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => setHeaderStuck(!entry.isIntersecting),
      { threshold: 0, rootMargin: '-1px 0px 0px 0px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  /* Focus programmatique + scrollIntoView après CALC_SUCCESS */
  useEffect(() => {
    if (status !== 'success' || !tableRef.current) return;
    const el = tableRef.current;
    el.setAttribute('tabindex', '-1');
    el.focus({ preventScroll: true });
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: prefersReduced ? 'auto' : 'smooth', block: 'nearest' });
  }, [status]);

  const totalColumns = columns.length + 1; // +1 colonne id

  /* ---------------------------------------------------------------- */
  /* État : erreur inline                                             */
  /* ---------------------------------------------------------------- */
  if (status === 'error') {
    return (
      <div
        role="alert"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '12px 16px',
          background: 'var(--status-fail-bg)',
          borderRadius: 'var(--radius-base)',
          color: 'var(--status-fail-tx)',
          fontSize: 13,
        }}
      >
        <AlertCircle size={16} strokeWidth={1.5} aria-hidden="true" />
        <span>{error ?? 'Une erreur est survenue lors du calcul.'}</span>
      </div>
    );
  }

  /* ---------------------------------------------------------------- */
  /* État : chargement skeleton (CLS = 0)                             */
  /* ---------------------------------------------------------------- */
  if (status === 'loading') {
    return (
      <div className={className} style={style}>
        <SkeletonOutputTable rows={skeletonRows} columns={totalColumns} />
      </div>
    );
  }

  /* ---------------------------------------------------------------- */
  /* État : vide                                                       */
  /* ---------------------------------------------------------------- */
  if (status === 'empty' || (status === 'success' && rows.length === 0)) {
    return (
      <div
        style={{
          padding: '32px 16px',
          textAlign: 'center',
          color: 'var(--text-muted)',
          fontSize: 13,
        }}
        role="status"
      >
        Aucun résultat à afficher.
      </div>
    );
  }

  /* ---------------------------------------------------------------- */
  /* État idle : table vide réservée (CLS = 0, zone pré-calcul)      */
  /* ---------------------------------------------------------------- */
  if (status === 'idle') {
    return (
      <div
        style={{
          minHeight: `calc(${skeletonRows} * 40px + 48px)`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-muted)',
          fontSize: 13,
        }}
        role="status"
      >
        Le résultat apparaîtra ici après calcul.
      </div>
    );
  }

  /* ---------------------------------------------------------------- */
  /* État success                                                      */
  /* ---------------------------------------------------------------- */
  return (
    <div className={className} style={{ position: 'relative', ...style }}>
      {/* Annonce aria-live CALC_SUCCESS */}
      <div
        ref={ariaLiveRef}
        id={liveId}
        aria-live="polite"
        aria-atomic="true"
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          overflow: 'hidden',
          clip: 'rect(0,0,0,0)',
          whiteSpace: 'nowrap',
        }}
      >
        {status === 'success' ? 'Résultat prêt' : ''}
      </div>

      {/* Sentinelle IntersectionObserver pour sticky header */}
      <div ref={sentinelRef} style={{ height: 1, marginBottom: -1 }} aria-hidden="true" />

      {/* Table scrollable */}
      <div
        ref={tableRef}
        style={{
          overflowX: 'auto',
          animation:
            status === 'success'
              ? 'rds-table-enter var(--dur-base, 200ms) var(--ease-entrance, cubic-bezier(0.165,0.84,0.44,1)) forwards'
              : undefined,
        }}
        aria-label="Résultats de calcul"
      >
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontFamily: 'var(--font-sans)',
            fontSize: 14,
            tableLayout: 'auto',
          }}
        >
          {/* En-tête sticky */}
          <thead>
            <tr>
              {/* Colonne identifiant gelée */}
              <th
                scope="col"
                style={{
                  position: 'sticky',
                  left: 0,
                  top: 0,
                  zIndex: 12 /* Au-dessus des cellules sticky-left ET sticky-top */,
                  width: 160,
                  minWidth: 160,
                  padding: '9px 12px',
                  textAlign: 'left',
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  color: 'var(--text-muted)',
                  background: 'var(--surface-base)',
                  boxShadow: headerStuck
                    ? 'var(--elevation-sticky), 4px 0 8px rgba(0,0,0,0.06)'
                    : '4px 0 8px rgba(0,0,0,0.06)',
                  transition: `box-shadow var(--dur-fast, 150ms) var(--ease-state)`,
                  whiteSpace: 'nowrap',
                }}
              >
                {idColumnLabel}
              </th>

              {/* Autres colonnes */}
              {columns.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  style={{
                    position: 'sticky',
                    top: 0,
                    zIndex: 10,
                    padding: '9px 12px',
                    textAlign: col.numeric ? 'right' : 'left',
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    color: 'var(--text-muted)',
                    background: 'var(--surface-base)',
                    boxShadow: headerStuck ? 'var(--elevation-sticky)' : 'none',
                    transition: `box-shadow var(--dur-fast, 150ms) var(--ease-state)`,
                    whiteSpace: 'nowrap',
                    width: col.width,
                  }}
                >
                  <span>{col.label}</span>
                  {col.unit && (
                    <span
                      aria-label={`en ${col.unit}`}
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 10,
                        fontWeight: 400,
                        color: 'var(--text-muted)',
                        marginLeft: 4,
                      }}
                    >
                      ({col.unit})
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {rows.map((row) => {
              /* Ligne de groupe (fond pétrole) */
              if (row.groupLabel) {
                return (
                  <tr key={row.id} aria-label={row.groupLabel}>
                    <td
                      colSpan={totalColumns}
                      style={{
                        padding: '6px 12px',
                        background: 'var(--struct-petrole)',
                        color: 'var(--struct-petrole-fg)',
                        fontSize: 11,
                        fontWeight: 600,
                        letterSpacing: '0.05em',
                        textTransform: 'uppercase',
                      }}
                    >
                      {row.groupLabel}
                    </td>
                  </tr>
                );
              }

              return <DataRow key={row.id} row={row} columns={columns} />;
            })}
          </tbody>
        </table>
      </div>

      <style>{`
        @keyframes rds-table-enter {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          [aria-label="Résultats de calcul"] { animation: none !important; }
        }
      `}</style>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Ligne de données                                                     */
/* ------------------------------------------------------------------ */

function DataRow({ row, columns }: { row: TableRow; columns: TableColumn[] }) {
  const [hovered, setHovered] = useState(false);

  return (
    <tr
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered ? 'var(--row-hover-bg, rgba(31,78,74,0.04))' : 'transparent',
        transition: `background-color var(--dur-fast, 150ms) var(--ease-state)`,
        borderBottom: '1px solid var(--color-alt, #eef0f1)',
      }}
    >
      {/* Cellule id gelée */}
      <td
        style={{
          position: 'sticky',
          left: 0,
          zIndex: 5,
          width: 160,
          minWidth: 160,
          padding: '9px 12px',
          fontSize: 13,
          fontWeight: 500,
          color: 'var(--text-primary)',
          background: hovered
            ? 'var(--row-hover-bg, rgba(31,78,74,0.04))'
            : 'var(--surface-base)',
          boxShadow: '4px 0 8px rgba(0,0,0,0.06)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          transition: `background-color var(--dur-fast, 150ms) var(--ease-state)`,
        }}
        title={row.id}
      >
        {row.id}
      </td>

      {/* Cellules de données */}
      {columns.map((col) => {
        const raw = row.cells?.[col.key];
        const displayValue =
          col.numeric && typeof raw === 'number'
            ? fmt(raw, col.decimals ?? 4)
            : raw === null || raw === undefined
              ? '—'
              : String(raw);

        return (
          <td
            key={col.key}
            style={{
              padding: '9px 12px',
              fontSize: 14,
              fontFamily: col.numeric ? 'var(--font-mono)' : 'var(--font-sans)',
              fontVariantNumeric: col.numeric ? 'tabular-nums' : undefined,
              fontWeight: col.numeric ? 600 : 400,
              textAlign: col.numeric ? 'right' : 'left',
              color: 'var(--text-primary)',
            }}
          >
            {displayValue}
          </td>
        );
      })}
    </tr>
  );
}
