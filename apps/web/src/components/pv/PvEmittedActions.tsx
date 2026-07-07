'use client';

/**
 * PvEmittedActions — actions après émission d'un PV depuis une page logiciel
 * (ROADSENS/CASAGRANDE/Terzaghi/GEOPLAQUE/PressioPro/FASTLAB).
 *
 * Corrige l'impasse post-émission (audit Lot 4) : jusqu'ici, un PV émis
 * n'affichait qu'un texte de confirmation, sans aucune action possible.
 * Trois actions réelles, sur les endpoints déjà exposés :
 * - Télécharger le PDF : GET /projects/:id/pvs/:pvId/pdf (409 sceau cassé géré)
 * - Voir le PV : lien vers l'onglet PV & Livrables du projet (liste + vérif + aperçu)
 * - Nouveau calcul : réinitialise l'état local (callback fourni par la page)
 *
 * Pas de logique de calcul ici (§8) — uniquement de la restitution/navigation.
 */

import { Download, Eye, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { downloadPvPdf } from '@/lib/api/client';
import type { OfficialPv } from '@/lib/api/types';

interface PvEmittedActionsProps {
  pv: OfficialPv;
  orgId: string | null;
  orgSlug: string;
  projetId: string;
  accent: string;
  onNewCalcul: () => void;
}

function pdfErrorMessage(err: unknown): string {
  const apiErr = err as { statusCode?: number; message?: string };
  if (apiErr?.statusCode === 409) {
    return apiErr.message ?? 'Sceau invalide — ce PV ne peut pas être rendu en PDF.';
  }
  return 'Erreur lors du téléchargement. Réessayez.';
}

export function PvEmittedActions({
  pv,
  orgId,
  orgSlug,
  projetId,
  accent,
  onNewCalcul,
}: PvEmittedActionsProps) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDownload() {
    setDownloading(true);
    setError(null);
    try {
      const blob = await downloadPvPdf(pv.id, orgId ?? undefined, projetId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${pv.number}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      setError(pdfErrorMessage(err));
    } finally {
      setDownloading(false);
    }
  }

  const btnBase: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 12.5,
    fontWeight: 600,
    borderRadius: 8,
    padding: '7px 13px',
    cursor: 'pointer',
    fontFamily: 'inherit',
    textDecoration: 'none',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          data-testid="pv-download-pdf"
          onClick={handleDownload}
          disabled={downloading}
          aria-busy={downloading}
          style={{
            ...btnBase,
            background: accent,
            color: '#fff',
            border: 'none',
            opacity: downloading ? 0.7 : 1,
          }}
        >
          <Download size={14} strokeWidth={1.75} aria-hidden="true" />
          {downloading ? 'Téléchargement…' : 'Télécharger le PDF'}
        </button>

        <Link
          href={`/app/${orgSlug}/projets/${projetId}/pv`}
          data-testid="pv-view-link"
          style={{
            ...btnBase,
            background: '#fff',
            color: accent,
            border: `1px solid ${accent}`,
          }}
        >
          <Eye size={14} strokeWidth={1.75} aria-hidden="true" />
          Voir le PV
        </Link>

        <button
          type="button"
          data-testid="pv-new-calcul"
          onClick={onNewCalcul}
          style={{
            ...btnBase,
            background: 'transparent',
            color: 'var(--text-secondary, #555)',
            border: '1px solid var(--border-default, #ccc)',
          }}
        >
          <RotateCcw size={14} strokeWidth={1.75} aria-hidden="true" />
          Nouveau calcul
        </button>
      </div>

      {error && (
        <span role="alert" style={{ fontSize: 11.5, color: '#991b1b' }}>
          {error}
        </span>
      )}
    </div>
  );
}
