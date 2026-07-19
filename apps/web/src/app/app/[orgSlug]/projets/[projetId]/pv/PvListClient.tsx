'use client';

/**
 * B-24/B-25 — Onglet PV & Livrables
 * Liste des PV scellés + actions Aperçu / Télécharger / Vérifier intégrité
 *
 * Badge "Scellé" = fond asphalte + cadenas, jamais vert (ADR 0008)
 * Vérification = appel serveur GET /projects/:id/pvs/:pvId, champ sealValid
 *
 * Aperçu / Télécharger — option 3 (le PV = le document que l'outil imprime) :
 * on tente D'ABORD GET .../pvs/:pvId/document (le document HTML scellé de
 * l'outil, servi tel quel). 404 (PV sans document HTML — ancien PV/autre
 * moteur) OU 409 (intégrité rompue) → repli sur le PDF pdfmake existant (blob
 * URL, comportement INCHANGÉ) : B1 (revue adverse) — jamais de cul-de-sac,
 * le PDF reste un PV valide (son propre contrôle d'intégrité s'applique). Le
 * 409 est loggé séparément côté `httpGetPvDocument` (anomalie), mais ne
 * bloque pas l'ingénieur ici.
 */

import { Lock, Download, ShieldCheck, AlertCircle, RefreshCw, Eye } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { Skeleton } from '@/components/ui/Skeleton.client';
import { useToast } from '@/components/ui/Toast';
import { listPvs, verifyPv, downloadPvPdf, getPvDocument } from '@/lib/api/client';
import type { OfficialPv, VerifyPvResponse } from '@/lib/api/types';
import { useOrgId } from '@/lib/org-context';
import { printInertHtml } from '@/lib/print-inert-html';

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    // timeZone déterministe → SSR (UTC) et client (fuseau local) produisent le même texte (#418)
    timeZone: 'Africa/Dakar',
  })
    .format(new Date(iso))
    .replace(/[\u202F\u00A0]/g, ' '); // espace ICU déterministe (anti #418)
}

interface PvListClientProps {
  orgSlug: string;
  projetId: string;
}

export default function PvListClient({ orgSlug, projetId }: PvListClientProps) {
  const { addToast } = useToast();
  const orgId = useOrgId(orgSlug);
  // Rendu client-only : page data-driven → pas de mismatch d'hydratation (#418).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [pvs, setPvs] = useState<OfficialPv[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modale vérification intégrité
  const [verifyModal, setVerifyModal] = useState<{
    pvId: string;
    number: string;
  } | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<VerifyPvResponse | null>(null);

  // Téléchargement PDF
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  // Aperçu (Bug F) — soit le document HTML scellé de l'outil (option 3), soit
  // le repli PDF (blob URL révoquée à la fermeture) si le PV n'a pas de document.
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [previewModal, setPreviewModal] = useState<
    | { kind: 'pdf'; blobUrl: string; number: string; pvId: string }
    | { kind: 'doc'; html: string; number: string; pvId: string }
    | null
  >(null);
  const previewUrlRef = useRef<string | null>(null);

  const loadPvs = useCallback(async () => {
    if (orgId === null) {
      // orgId encore en cours de résolution (mode réel : useEffect du hook) —
      // on reste en état de chargement sans afficher d'erreur (Bug #17).
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await listPvs(orgId, projetId);
      setPvs(data);
    } catch {
      setError('Impossible de charger les PV.');
    } finally {
      setLoading(false);
    }
  }, [orgId, projetId]);

  useEffect(() => {
    loadPvs();
  }, [loadPvs]);

  // Nettoyage de la blob URL si le composant est démonté pendant un aperçu
  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

  async function handleVerify(pv: OfficialPv) {
    setVerifyModal({ pvId: pv.id, number: pv.number });
    setVerifyResult(null);
    setVerifying(true);
    try {
      // Bug C : on passe orgId et projectId — la vérification lit
      // GET /projects/:projectId/pvs/:pvId et exploite sealValid.
      const result = await verifyPv(orgId!, projetId, pv.id);
      setVerifyResult(result);
    } catch {
      addToast({ type: 'error', message: 'Erreur lors de la vérification. Réessayez.' });
      setVerifyModal(null);
    } finally {
      setVerifying(false);
    }
  }

  async function handleDownload(pv: OfficialPv) {
    setDownloadingId(pv.id);
    try {
      // Option 3 : tenter d'abord le document HTML scellé de l'outil. Présent
      // → on l'imprime tel quel (équivalent du "print natif" de l'outil, qui
      // permet d'enregistrer en PDF depuis la boîte de dialogue du navigateur).
      const doc = await getPvDocument(orgId!, projetId, pv.id);
      if (doc) {
        printInertHtml(doc.html);
        return;
      }
      // 404 (pas de document HTML pour ce PV) → repli PDF pdfmake INCHANGÉ.
      const blob = await downloadPvPdf(pv.id, orgId ?? undefined, projetId);
      triggerBlobDownload(blob, `${pv.number}.pdf`);
      addToast({ type: 'success', message: `${pv.number} téléchargé.` });
    } catch (err: unknown) {
      addToast({ type: 'error', message: pdfErrorMessage(err) });
    } finally {
      setDownloadingId(null);
    }
  }

  // Bug F — Aperçu dans une modale (document HTML scellé en priorité, repli PDF)
  async function handlePreview(pv: OfficialPv) {
    setPreviewingId(pv.id);
    try {
      const doc = await getPvDocument(orgId!, projetId, pv.id);
      if (doc) {
        setPreviewModal({ kind: 'doc', html: doc.html, number: pv.number, pvId: pv.id });
        return;
      }
      // 404 (pas de document HTML pour ce PV) → repli PDF blob INCHANGÉ.
      const blob = await downloadPvPdf(pv.id, orgId ?? undefined, projetId);
      const url = URL.createObjectURL(blob);
      previewUrlRef.current = url;
      setPreviewModal({ kind: 'pdf', blobUrl: url, number: pv.number, pvId: pv.id });
    } catch (err: unknown) {
      addToast({ type: 'error', message: pdfErrorMessage(err) });
    } finally {
      setPreviewingId(null);
    }
  }

  function closePreview() {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setPreviewModal(null);
  }

  async function handlePreviewDownload() {
    if (!previewModal) return;
    const pv = pvs.find((p) => p.id === previewModal.pvId);
    if (pv) await handleDownload(pv);
  }

  if (!mounted) {
    return (
      <div style={{ padding: 24 }} aria-busy="true" aria-label="Chargement des PV" />
    );
  }

  return (
    <div style={{ padding: 24, maxWidth: 800, margin: '0 auto', width: '100%' }}>
      <h2
        style={{
          fontSize: 'var(--text-lg)',
          fontWeight: 600,
          color: 'var(--text-primary)',
          marginBottom: 20,
        }}
      >
        PV & Livrables
      </h2>

      {/* Chargement */}
      {loading && (
        <div aria-busy="true" aria-label="Chargement des PV">
          {[1, 2].map((i) => (
            <Skeleton key={i} variant="row" style={{ marginBottom: 8, height: 80 }} />
          ))}
        </div>
      )}

      {/* Erreur */}
      {!loading && error && (
        <div
          role="alert"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 12,
            padding: 40,
          }}
        >
          <AlertCircle
            size={24}
            strokeWidth={1.5}
            aria-hidden="true"
            style={{ color: 'var(--status-fail-tx)' }}
          />
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
            {error}
          </p>
          <Button
            variant="secondary"
            size="sm"
            iconLeft={<RefreshCw size={14} strokeWidth={1.5} aria-hidden="true" />}
            onClick={loadPvs}
          >
            Réessayer
          </Button>
        </div>
      )}

      {/* Vide */}
      {!loading && !error && pvs.length === 0 && (
        <EmptyState
          variant="blank"
          title="Aucun PV émis"
          description="Les PV apparaissent ici une fois un calcul scellé. Ouvrez l'onglet Calculs pour émettre un PV."
        />
      )}

      {/* Liste des PV */}
      {!loading && !error && pvs.length > 0 && (
        <div
          role="list"
          aria-label="Liste des procès-verbaux scellés"
          style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
        >
          {pvs.map((pv) => (
            <PvRow
              key={pv.id}
              pv={pv}
              downloading={downloadingId === pv.id}
              previewing={previewingId === pv.id}
              onDownload={() => handleDownload(pv)}
              onPreview={() => handlePreview(pv)}
              onVerify={() => handleVerify(pv)}
            />
          ))}
        </div>
      )}

      {/* Modale vérification intégrité (C-03) */}
      <Modal
        open={verifyModal !== null}
        onClose={() => {
          if (!verifying) {
            setVerifyModal(null);
            setVerifyResult(null);
          }
        }}
        title={`Vérifier l'intégrité — ${verifyModal?.number ?? ''}`}
        size="sm"
        footer={
          <Button
            variant="ghost"
            size="md"
            onClick={() => {
              setVerifyModal(null);
              setVerifyResult(null);
            }}
            disabled={verifying}
          >
            Fermer
          </Button>
        }
      >
        {verifying && (
          <div
            style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0' }}
          >
            <div
              style={{
                width: 16,
                height: 16,
                borderRadius: '50%',
                border: '2px solid var(--border-default)',
                borderTopColor: 'var(--struct-petrole)',
                animation: 'spin 1s linear infinite',
                flexShrink: 0,
              }}
              aria-hidden="true"
            />
            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
              Vérification en cours côté serveur…
            </span>
          </div>
        )}

        {!verifying && verifyResult && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 12,
                padding: '12px 14px',
                background: verifyResult.intact
                  ? 'var(--status-pass-bg)'
                  : 'var(--status-fail-bg)',
                borderRadius: 'var(--radius-base)',
              }}
            >
              <ShieldCheck
                size={20}
                strokeWidth={1.5}
                aria-hidden="true"
                style={{
                  color: verifyResult.intact
                    ? 'var(--status-pass-tx)'
                    : 'var(--status-fail-tx)',
                  flexShrink: 0,
                }}
              />
              <div>
                <div
                  style={{
                    fontSize: 'var(--text-sm)',
                    fontWeight: 500,
                    color: verifyResult.intact
                      ? 'var(--status-pass-tx)'
                      : 'var(--status-fail-tx)',
                  }}
                >
                  {verifyResult.intact
                    ? 'Sceau vérifié — document intact'
                    : 'Le sceau ne correspond pas — ce document a pu être altéré'}
                </div>
                <div
                  style={{
                    fontSize: 'var(--text-xs)',
                    color: 'var(--text-muted)',
                    marginTop: 4,
                  }}
                >
                  Vérifié le {formatDate(verifyResult.verifiedAt)} côté serveur
                </div>
              </div>
            </div>

            {/* Rappel légal */}
            <p
              style={{
                fontSize: 'var(--text-xs)',
                color: 'var(--text-muted)',
                lineHeight: 1.6,
                margin: 0,
              }}
            >
              {
                "Cette vérification confirme l'intégrité des données depuis le scellement. Elle ne constitue pas une signature électronique qualifiée (loi 2008-08)."
              }
            </p>
          </div>
        )}

        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      </Modal>

      {/* Modale aperçu (Bug F) — document HTML scellé (option 3) ou repli PDF */}
      <Modal
        open={previewModal !== null}
        onClose={closePreview}
        title={`Aperçu — ${previewModal?.number ?? ''}`}
        size="lg"
        footer={
          <div
            style={{
              display: 'flex',
              gap: 8,
              justifyContent: 'space-between',
              width: '100%',
            }}
          >
            <Button variant="ghost" size="md" onClick={closePreview}>
              Fermer
            </Button>
            <Button
              variant="secondary"
              size="md"
              iconLeft={<Download size={14} strokeWidth={1.5} aria-hidden="true" />}
              loading={downloadingId === previewModal?.pvId}
              onClick={handlePreviewDownload}
            >
              Télécharger
            </Button>
          </div>
        }
      >
        {previewModal?.kind === 'doc' && (
          // Document HTML scellé de l'outil (option 3) : lecture seule stricte,
          // aucun script (garde §8 côté serveur — le document est déjà inerte,
          // sandbox="" est une seconde barrière en profondeur).
          <iframe
            data-testid="pv-preview-doc-iframe"
            srcDoc={previewModal.html}
            sandbox=""
            title={`Aperçu — ${previewModal.number}`}
            style={{
              width: '100%',
              height: 560,
              border: 'none',
              borderRadius: 'var(--radius-base)',
              background: 'var(--surface-canvas)',
            }}
          />
        )}
        {previewModal?.kind === 'pdf' && (
          <iframe
            data-testid="pv-preview-iframe"
            src={previewModal.blobUrl}
            title={`Aperçu PDF — ${previewModal.number}`}
            style={{
              width: '100%',
              height: 560,
              border: 'none',
              borderRadius: 'var(--radius-base)',
              background: 'var(--surface-canvas)',
            }}
          />
        )}
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// 409 = sceau cassé côté serveur (GET .../pdf refuse le rendu, cf. pv.service.ts
// pdfForView) : le backend renvoie un message clair, on le propage tel quel plutôt
// qu'un générique "réessayez" (un nouvel essai ne changera rien, le PV est altéré).
function pdfErrorMessage(err: unknown): string {
  const apiErr = err as { statusCode?: number; message?: string };
  if (apiErr?.statusCode === 409) {
    return apiErr.message ?? 'Sceau invalide — ce PV ne peut pas être rendu en PDF.';
  }
  return 'Erreur lors du chargement du PDF. Réessayez.';
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Ligne PV
// ---------------------------------------------------------------------------

function PvRow({
  pv,
  downloading,
  previewing,
  onDownload,
  onPreview,
  onVerify,
}: {
  pv: OfficialPv;
  downloading: boolean;
  previewing: boolean;
  onDownload: () => void;
  onPreview: () => void;
  onVerify: () => void;
}) {
  return (
    <div
      role="listitem"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: '14px 16px',
        background: 'var(--surface-base)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--elevation-card)',
      }}
    >
      {/* Icône */}
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 'var(--radius-base)',
          background: 'var(--surface-nav)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <Lock
          size={16}
          strokeWidth={1.5}
          aria-hidden="true"
          style={{ color: 'var(--text-on-nav)' }}
        />
      </div>

      {/* Infos */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              fontSize: 'var(--text-sm)',
              fontWeight: 500,
              color: 'var(--text-primary)',
            }}
          >
            {pv.number}
          </span>
          {/* Badge Scellé */}
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 3,
              padding: '1px 6px',
              background: 'var(--surface-nav)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 11,
              color: 'var(--text-on-nav)',
              fontWeight: 500,
            }}
          >
            <Lock size={10} strokeWidth={1.5} aria-hidden="true" />
            Scellé
          </span>
        </div>
        <div
          style={{
            fontSize: 'var(--text-xs)',
            color: 'var(--text-secondary)',
            marginTop: 2,
          }}
        >
          {pv.engineId} · {pv.sealedBy} · {formatDate(pv.sealedAt)}
        </div>
        {/* Hash HMAC tronqué — 8 chars, visible mais sans légende explicative */}
        <div
          style={{
            fontSize: 11,
            fontFamily: 'var(--font-mono)',
            fontVariantNumeric: 'tabular-nums',
            color: 'var(--text-muted)',
            marginTop: 4,
          }}
          title="Code d'intégrité HMAC (8 premiers caractères)"
        >
          {pv.hmacTruncated}
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        <Button
          variant="ghost"
          size="sm"
          iconLeft={<ShieldCheck size={14} strokeWidth={1.5} aria-hidden="true" />}
          onClick={onVerify}
          aria-label={`Vérifier l'intégrité du PV ${pv.number}`}
        >
          Vérifier
        </Button>
        <Button
          variant="ghost"
          size="sm"
          iconLeft={<Eye size={14} strokeWidth={1.5} aria-hidden="true" />}
          loading={previewing}
          onClick={onPreview}
          aria-label={`Aperçu PDF du PV ${pv.number}`}
        >
          Aperçu
        </Button>
        <Button
          variant="secondary"
          size="sm"
          iconLeft={<Download size={14} strokeWidth={1.5} aria-hidden="true" />}
          loading={downloading}
          onClick={onDownload}
          aria-label={`Télécharger le PDF du PV ${pv.number}`}
        >
          Télécharger
        </Button>
      </div>
    </div>
  );
}
