'use client';

/**
 * B-24/B-25 — Onglet PV scellés (maquette finale, écran 3 : liste simple de
 * cartes, PAS de panneau de détail scindé — contrairement à Calculs).
 * Liste des PV scellés + actions Vérifier / Aperçu / Télécharger.
 *
 * Verdict de conformité ET badge "Scellé" affichés côte à côte, jamais
 * fusionnés (cf. verdict.tsx) : le scellement atteste l'intégrité, jamais la
 * conformité. Badge "Scellé" = fond asphalte + cadenas, jamais vert (ADR 0008)
 * — quel que soit le verdict (un PV peut être scellé ET NON CONFORME).
 * Vérification = appel serveur GET /projects/:id/pvs/:pvId, champ sealValid
 *
 * Aperçu / Télécharger — option 3 (le PV = le document que l'outil imprime) :
 * on tente D'ABORD GET .../pvs/:pvId/document (le document HTML scellé de
 * l'outil, servi tel quel) via `fetchPvDocumentOrNull` (helper local). 404
 * (PV sans document HTML — ancien PV/autre moteur, `getPvDocument` renvoie
 * `null`) OU 409 (intégrité rompue, `getPvDocument` REJETTE — cf.
 * http-client.ts, révisé suite à reco qa-challenger) → repli sur le PDF
 * pdfmake existant (blob URL, comportement INCHANGÉ) : B1 (revue adverse) —
 * jamais de cul-de-sac ici, le PDF reste un PV valide (son propre contrôle
 * d'intégrité s'applique indépendamment). Le 409 absorbé par
 * `fetchPvDocumentOrNull` reste une anomalie réelle : elle n'est pas masquée
 * dans `CalculsClient`, qui n'a pas ce filet PDF indépendant et refuse
 * d'imprimer sur 409 (fail-closed).
 */

import { Lock, Download, ShieldCheck, AlertCircle, RefreshCw, Eye } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { VerdictTag } from '../verdict';

import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { Skeleton } from '@/components/ui/Skeleton.client';
import { useToast } from '@/components/ui/Toast';
import { listPvs, verifyPv, downloadPvPdf, getPvDocument } from '@/lib/api/client';
import type { OfficialPv, VerifyPvResponse } from '@/lib/api/types';
import { metaOf, slugOf } from '@/lib/engine-labels';
import { useOrgId } from '@/lib/org-context';
import { printInertHtml } from '@/lib/print-inert-html';
import { SOFTWARE_CATALOG } from '@/lib/software-catalog';

// `getPvDocument` renvoie `null` sur 404 (absence légitime) mais REJETTE sur
// 409/intégrité rompue (cf. http-client.ts). Ici, le repli PDF a son propre
// contrôle d'intégrité indépendant (GET .../pvs/:pvId/pdf) : on absorbe donc
// le 409 en `null` pour conserver le comportement B1 existant (jamais de
// cul-de-sac). Toute autre erreur (réseau, 5xx…) reste propagée telle quelle.
async function fetchPvDocumentOrNull(
  orgId: string,
  projectId: string,
  pvId: string,
): Promise<{ html: string } | null> {
  try {
    return await getPvDocument(orgId, projectId, pvId);
  } catch (err: unknown) {
    if ((err as { statusCode?: number })?.statusCode === 409) return null;
    throw err;
  }
}

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

// Date compacte (maquette finale, écran 3) — DD/MM/AAAA HH:mm, utilisée dans la
// méta mono de la ligne PV. Distincte de `formatDate` (phrase complète, modale
// de vérification) : un format numérique dense tient sur une seule ligne.
function formatDateCompact(iso: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Africa/Dakar',
  }).format(new Date(iso));
}

// Titre mnémonique (FX-10, révisé maquette finale 21/07/2026) — le TYPE DE
// NOTE, jamais le nom du projet (déjà affiché dans le fil d'Ariane au-dessus
// de l'onglet, cf. ProjetLayoutClient : le répéter ici cassait la compacité
// ET faisait doublon). Curation manuelle : plus court que le `label` complet
// de l'EngineDescriptor (ex. « Fondation profonde — pieux (NF P 94-262) »
// devient « Fondation profonde »), aligné mot pour mot sur la maquette
// validée. Moteur non mappé (futur) → repli sur `metaOf` (nom métier), jamais
// une exception.
const NOTE_TYPE_LABEL: Record<string, string> = {
  burmister: 'Chaussée',
  terzaghi: 'Fondation superficielle',
  pieux: 'Fondation profonde',
  radier: 'Radier sur sol élastique',
  pressiometre: 'Essai pressiométrique',
  labo: 'Classification GTR',
};

function pvTitle(pv: OfficialPv): string {
  const slug = slugOf(pv.engineId);
  const type = NOTE_TYPE_LABEL[slug] ?? metaOf(pv.engineId).nom;
  return `Note de calcul — ${type}`;
}

// Nom court du logiciel pour la méta compacte (« CASAGRANDE », « GEOPLAQUE »…)
// — source unique : SOFTWARE_CATALOG (déjà utilisé par la galerie des 6
// logiciels), pas une nouvelle copie locale des noms de marque.
function logicielNomFor(engineId: string): string {
  const slug = slugOf(engineId);
  return SOFTWARE_CATALOG.find((s) => s.engineId === slug)?.nom ?? metaOf(engineId).nom;
}

// ---------------------------------------------------------------------------
// Tri interactif + pagination (P2 dégelé, maquette finale écran 3, 21/07/2026)
// ---------------------------------------------------------------------------

type PvSortKey = 'date' | 'numero';
type SortDir = 'asc' | 'desc';

/** Recliquer sur l'option déjà active bascule le sens ; sinon adopte le sens par défaut. */
const PV_SORT_OPTIONS: ReadonlyArray<{
  key: PvSortKey;
  label: string;
  defaultDir: SortDir;
}> = [
  { key: 'date', label: 'Date de scellement', defaultDir: 'desc' },
  { key: 'numero', label: 'Numéro', defaultDir: 'asc' },
];

/** Nombre de PV affichés par page (pagination client, ~12/page). */
const PV_PAGE_SIZE = 12;

function comparerPvs(a: OfficialPv, b: OfficialPv, key: PvSortKey, dir: SortDir): number {
  let cmp: number;
  switch (key) {
    case 'numero':
      cmp = a.number.localeCompare(b.number, 'fr', {
        numeric: true,
        sensitivity: 'base',
      });
      break;
    case 'date':
    default:
      cmp = new Date(a.sealedAt).getTime() - new Date(b.sealedAt).getTime();
      break;
  }
  return dir === 'asc' ? cmp : -cmp;
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

  // Tri interactif + pagination client (P2 dégelé, maquette finale écran 3).
  // Défaut = Date de scellement décroissante : identique à l'ordre initial
  // servi par l'API, aucune surprise à l'ouverture.
  const [sortKey, setSortKey] = useState<PvSortKey>('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [currentPage, setCurrentPage] = useState(1);

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

  /** Reclique sur l'option déjà active → bascule le sens ; sinon adopte le sens par défaut. */
  function toggleSort(option: (typeof PV_SORT_OPTIONS)[number]) {
    if (sortKey === option.key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(option.key);
      setSortDir(option.defaultDir);
    }
    // Changement de tri : on repart de la première page — sinon une page 2
    // pourrait afficher un contenu incohérent avec le nouvel ordre.
    setCurrentPage(1);
  }

  // Tri côté client (P2 dégelé) — la liste entière est déjà en mémoire
  // (listPvs renvoie tout le projet) : trier ici ne contredit pas le serveur,
  // dont l'ordre initial n'est qu'un défaut. Copie défensive : sort mute en place.
  const sortedPvs = useMemo(
    () => [...pvs].sort((a, b) => comparerPvs(a, b, sortKey, sortDir)),
    [pvs, sortKey, sortDir],
  );

  // Pagination client (~12/page) — appliquée APRÈS le tri. Bornage défensif :
  // si la page en mémoire dépasse le nouveau total, on affiche la dernière
  // page valide plutôt qu'un panneau vide en silence.
  const totalPages = Math.max(1, Math.ceil(sortedPvs.length / PV_PAGE_SIZE));
  const pageActuelle = Math.min(currentPage, totalPages);
  const pagedPvs = useMemo(
    () => sortedPvs.slice((pageActuelle - 1) * PV_PAGE_SIZE, pageActuelle * PV_PAGE_SIZE),
    [sortedPvs, pageActuelle],
  );

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
      const doc = await fetchPvDocumentOrNull(orgId!, projetId, pv.id);
      if (doc) {
        printInertHtml(doc.html);
        return;
      }
      // 404/409 (pas de document HTML servable pour ce PV) → repli PDF pdfmake INCHANGÉ.
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
      const doc = await fetchPvDocumentOrNull(orgId!, projetId, pv.id);
      if (doc) {
        setPreviewModal({ kind: 'doc', html: doc.html, number: pv.number, pvId: pv.id });
        return;
      }
      // 404/409 (pas de document HTML servable pour ce PV) → repli PDF blob INCHANGÉ.
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

  // Largeur de contenu alignée sur la maquette : à 800 px, la ligne PV compacte
  // comprimait la méta au point de masquer le logiciel et la date sous l'ellipse
  // après le seul numéro. 1100 px laisse « numéro · logiciel · date » tenir sur
  // une ligne à côté des badges et des trois actions, sans casser la compacité.
  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto', width: '100%' }}>
      <h2
        style={{
          fontSize: 'var(--text-lg)',
          fontWeight: 600,
          color: 'var(--text-primary)',
          marginBottom: 20,
        }}
      >
        PV scellés
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

      {/* Barre d'outils — tri interactif (P2 dégelé, maquette finale). Recherche,
        filtres et livraison groupée restent P2 : rien n'est promis ici. */}
      {!loading && !error && pvs.length > 0 && (
        <div
          style={{
            display: 'flex',
            gap: 7,
            flexWrap: 'wrap',
            alignItems: 'center',
            marginBottom: 12,
          }}
        >
          <div style={{ flex: 1 }} />
          <div
            role="group"
            aria-label="Trier les PV"
            style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}
          >
            {PV_SORT_OPTIONS.map((option) => {
              const actif = sortKey === option.key;
              const croissant = sortDir === 'asc';
              return (
                <button
                  key={option.key}
                  type="button"
                  aria-pressed={actif}
                  aria-label={
                    actif
                      ? `Trier par ${option.label}, ordre ${croissant ? 'croissant' : 'décroissant'} — cliquer pour inverser`
                      : `Trier par ${option.label}`
                  }
                  onClick={() => toggleSort(option)}
                  style={{
                    fontSize: 'var(--text-xs)',
                    padding: '6px 10px',
                    borderRadius: 999,
                    border: `1px solid ${actif ? 'var(--border-focus)' : 'var(--border-subtle)'}`,
                    background: actif
                      ? 'var(--state-selected-bg)'
                      : 'var(--surface-base)',
                    color: actif ? 'var(--text-primary)' : 'var(--text-secondary)',
                    fontWeight: actif ? 600 : 400,
                    whiteSpace: 'nowrap',
                    cursor: 'pointer',
                  }}
                >
                  {option.label}
                  {actif && (
                    <span aria-hidden="true" style={{ marginLeft: 4 }}>
                      {croissant ? '↑' : '↓'}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Liste des PV — page courante uniquement (pagination client, maquette
        finale : lignes compactes sur une rangée, pas de grandes cartes). */}
      {!loading && !error && pvs.length > 0 && (
        <div
          role="list"
          aria-label="Liste des procès-verbaux scellés"
          style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
        >
          {pagedPvs.map((pv) => (
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

      {/* Pagination client (~12/page) — masquée dès que tout tient sur une page. */}
      {!loading && !error && pvs.length > 0 && totalPages > 1 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            marginTop: 20,
          }}
        >
          <button
            type="button"
            aria-label="Page précédente"
            disabled={pageActuelle <= 1}
            onClick={() => setCurrentPage(Math.max(1, pageActuelle - 1))}
            style={{
              padding: '6px 12px',
              minHeight: 32,
              fontSize: 'var(--text-sm)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-base)',
              background: 'var(--surface-base)',
              color: pageActuelle <= 1 ? 'var(--text-muted)' : 'var(--text-primary)',
              cursor: pageActuelle <= 1 ? 'not-allowed' : 'pointer',
              opacity: pageActuelle <= 1 ? 0.5 : 1,
            }}
          >
            Précédent
          </button>
          <span
            role="status"
            aria-live="polite"
            style={{
              fontSize: 'var(--text-xs)',
              color: 'var(--text-secondary)',
              fontFamily: 'var(--font-mono)',
              minWidth: 100,
              textAlign: 'center',
            }}
          >
            Page {pageActuelle} sur {totalPages}
          </span>
          <button
            type="button"
            aria-label="Page suivante"
            disabled={pageActuelle >= totalPages}
            onClick={() => setCurrentPage(Math.min(totalPages, pageActuelle + 1))}
            style={{
              padding: '6px 12px',
              minHeight: 32,
              fontSize: 'var(--text-sm)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-base)',
              background: 'var(--surface-base)',
              color:
                pageActuelle >= totalPages ? 'var(--text-muted)' : 'var(--text-primary)',
              cursor: pageActuelle >= totalPages ? 'not-allowed' : 'pointer',
              opacity: pageActuelle >= totalPages ? 0.5 : 1,
            }}
          >
            Suivant
          </button>
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
                borderTopColor: 'var(--struct-petrole-text)',
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
// Ligne PV — maquette finale écran 3 (21/07/2026) : ligne COMPACTE sur une
// rangée, PAS une grande carte. Le titre (type de note) et la méta
// (numéro · logiciel · date) tiennent chacun sur une seule ligne, jamais de
// numéro de PV coupé au milieu (bug rapporté sur le déployé).
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
  // Verdict de conformité — DISTINCT du scellement (cf. badge « Scellé »
  // ci-dessous), jamais fusionné (maquette finale, écran 3). Un PV est déjà
  // SCELLÉ : `pv.verdict` (copie du verdict scellé côté serveur, ADR 0012)
  // fait foi ici, PAS une re-dérivation de `pv.output` par duck-typing (cf.
  // verdict.tsx — les deux logiques sont indépendantes et peuvent diverger).
  // `undefined` seulement si le backend ne renvoie pas la colonne (cas
  // défensif) — pas de badge affiché plutôt qu'un verdict inventé.
  const verdict = pv.verdict;

  return (
    <div
      role="listitem"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '11px 13px',
        // Surface PLATE, volontairement pas « verre » : le dégradé du verre
        // descend jusqu'à la couleur du fond, ce qui délave des lignes
        // répétées et leur fait perdre leur contour. Le verre est réservé au
        // panneau de détail (surface unique, mise en avant).
        background: 'var(--surface-base)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--elevation-card)',
      }}
    >
      {/* Icône — fond asphalte, JAMAIS vert (ADR 0008). Le scellement n'est pas
          un verdict : un PV peut être scellé tout en rapportant un calcul NON
          CONFORME. Le teinter en vert ferait lire « tout va bien » à côté d'un
          résultat en échec — l'ambiguïté exacte que l'ADR interdit. Le vert et
          le rouge restent réservés aux verdicts de conformité. */}
      <div
        style={{
          width: 31,
          height: 31,
          borderRadius: 'var(--radius-base)',
          background: 'var(--surface-nav)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <Lock
          size={14}
          strokeWidth={1.5}
          aria-hidden="true"
          style={{ color: 'var(--text-on-nav)' }}
        />
      </div>

      {/* Infos — DEUX lignes maximum, chacune contrainte à un seul rang
          (nowrap + ellipsis) : c'est ce qui empêche le numéro de PV de se
          couper au milieu sur une ligne étroite. */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Titre mnémonique — le TYPE DE NOTE (ex. « Fondation profonde »),
            jamais le nom du projet (déjà dans le fil d'Ariane) ni le numéro
            officiel (référence secondaire ci-dessous). */}
        <span
          style={{
            display: 'block',
            fontSize: 'var(--text-sm)',
            fontWeight: 500,
            color: 'var(--text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {pvTitle(pv)}
        </span>
        {/* Méta compacte — numéro officiel · logiciel · date de scellement,
            UN SEUL bloc mono sur une ligne (pas de « · » orphelin éclaté sur
            plusieurs éléments). Le hash HMAC (non présent dans la maquette,
            cf. commentaire ci-dessous) reste accessible en tooltip discret. */}
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            color: 'var(--text-secondary)',
            marginTop: 3,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={`Code d'intégrité (HMAC tronqué) : ${pv.hmacTruncated}`}
        >
          {pv.number} · {logicielNomFor(pv.engineId)} · {formatDateCompact(pv.sealedAt)}
        </div>
      </div>

      {/* Verdict de conformité — DISTINCT du scellement, jamais fusionné :
          un PV peut être parfaitement scellé (intégrité) et rapporter
          NON CONFORME (résultat). NON APPLICABLE (ex. radier) est un cas
          réel, neutre (cf. verdict.tsx — ADR 0008). Rien d'affiché si le
          verdict n'est pas exploitable (ancien PV) — pas de verdict inventé. */}
      {verdict && <VerdictTag verdict={verdict} compact />}

      {/* Badge Scellé — atteste l'INTÉGRITÉ, jamais la conformité : reste en
          asphalte + cadenas, JAMAIS vert (ADR 0008), quel que soit le
          verdict ci-dessus. Coloré vert une fois par erreur (revue titulaire) —
          l'ambiguïté exacte que l'ADR interdit : un PV scellé NON CONFORME
          aurait alors semblé "tout va bien". */}
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
          flexShrink: 0,
        }}
      >
        <Lock size={10} strokeWidth={1.5} aria-hidden="true" />
        Scellé
      </span>

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
