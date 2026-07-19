'use client';

/**
 * Calculs d'un projet — historique + document de l'outil (option 3).
 *
 * Décision titulaire (alignement workflow) : les calculs se lancent UNIQUEMENT
 * depuis les logiciels (galerie GEOFAM), pas ici. Cet écran affiche l'historique
 * des calculs du projet et permet, pour chacun :
 *  - de RE-AFFICHER le document EXACT que l'outil produisait (capture serveur
 *    du HTML/SVG d'affichage — ADR « option 3 : le PV = le document que l'outil
 *    imprime »), dans une iframe sandboxée en lecture seule (aucun script) ;
 *  - une fois SCELLÉ, de RÉ-IMPRIMER le document OFFICIEL (celui du PV, jamais
 *    un aperçu qui pourrait diverger) ;
 *  - tant que PAS scellé, de SCELLER cette version (émission du PV officiel).
 *
 * Barre d'actions unifiée (revue titulaire) : IDENTIQUE que l'aperçu soit
 * capturé ou non — `renderActionsBar` est la seule source de vérité, réutilisée
 * par les deux panneaux. Calcul scellé → « Voir le PV scellé » + « Imprimer »
 * (document scellé) ; non scellé → « Sceller cette version » seule (aucun
 * document officiel n'existe encore à imprimer). Le lien « Ouvrir dans le
 * logiciel » a été retiré : il ouvrait l'outil VIERGE (aucun état restauré),
 * sans valeur et source de confusion.
 *
 * Si aucun document n'a été capturé pour ce calcul (ancien calcul / moteur non
 * cloné / capture jamais faite — 404 serveur), on retombe sur le panneau de
 * métadonnées (date/statut/verdict/PV) qui existait déjà.
 *
 * Aucun calcul/formule n'est reconstruit côté navigateur (DoD §8) : le document
 * affiché est un rendu déjà produit et scellé côté serveur.
 */

import { Lock, Printer } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useEffect, useCallback } from 'react';

import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/Toast';
import {
  listCalcResults,
  getCalcSnapshot,
  emitPv,
  getPvDocument,
} from '@/lib/api/client';
import type { CalcResult, CalcSnapshot, NormalizedCalcOutput } from '@/lib/api/types';
import { useOrgId } from '@/lib/org-context';
import { printInertHtml } from '@/lib/print-inert-html';

// registryId (persisté backend) → slug métier court (route logiciel + libellé).
const ENGINE_ID_ALIAS: Record<string, string> = {
  'chaussee-burmister': 'burmister',
  'fondation-superficielle': 'terzaghi',
  'pressiometre-menard': 'pressiometre',
  'fondation-profonde-pieux': 'pieux',
  'radier-plaque': 'radier',
  'labo-classification-gtr': 'labo',
  'fondation-terzaghi': 'terzaghi',
};
// slug → nom métier du logiciel. Les slugs sans page front restent listables
// (historique). Pas de lien "Ouvrir dans le logiciel" ici (retiré — l'outil
// s'ouvrait vierge, sans l'état de ce calcul restauré).
const ENGINE_META: Record<string, { nom: string }> = {
  burmister: { nom: 'ROADSENS — Chaussées' },
  terzaghi: { nom: 'Terzaghi — Fondations superficielles' },
  pieux: { nom: 'CASAGRANDE — Pieux' },
  radier: { nom: 'GEOPLAQUE — Radier' },
  pressiometre: { nom: 'PressioPro — Pressiomètre' },
  labo: { nom: 'FASTLAB — Laboratoire' },
};
function slugOf(engineId: string): string {
  return ENGINE_ID_ALIAS[engineId] ?? engineId;
}
function metaOf(engineId: string): { nom: string } {
  return ENGINE_META[slugOf(engineId)] ?? { nom: engineId };
}

// Style commun de la barre d'actions (les deux panneaux).
const ACTIONS_ROW_STYLE = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 10,
} as const;

// Statut du calcul (métadonnée, jamais le détail des résultats).
const STATUS_LABEL: Record<CalcResult['status'], string> = {
  DRAFT: 'Brouillon',
  PENDING: 'En attente',
  DONE: 'Terminé',
  ERROR: 'En erreur',
};

interface CalculsClientProps {
  orgSlug: string;
  projetId: string;
}

export default function CalculsClient({ orgSlug, projetId }: CalculsClientProps) {
  const router = useRouter();
  const orgId = useOrgId(orgSlug);
  const { addToast } = useToast();

  const [calculs, setCalculs] = useState<CalcResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Document capturé de l'outil pour le calcul sélectionné (option 3).
  const [snapshot, setSnapshot] = useState<CalcSnapshot | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);

  // #6 (revue adverse) : « Imprimer » sur un calcul DÉJÀ scellé imprime le
  // document scellé (immuable), jamais l'aperçu courant — la capture pourrait
  // diverger du PV. `printing` couvre l'aller-retour serveur.
  const [printing, setPrinting] = useState(false);
  // Fail-closed sur 409/erreur réseau (reco qa-challenger) : si l'intégrité du
  // document scellé ne peut pas être vérifiée, on n'imprime RIEN et on le dit
  // — jamais de repli silencieux sur un rendu non garanti authentique. Seul un
  // 404 (aucun document capturé pour ce PV — anomalie distincte, cf. #6 plus
  // bas) reste un repli légitime.
  const [printError, setPrintError] = useState<string | null>(null);

  // Scellement depuis cet écran (réutilise le flux emitPv des pages logiciels).
  const [sealing, setSealing] = useState(false);
  const [sealError, setSealError] = useState<string | null>(null);
  // M3 (revue adverse) : quand le document n'a pas été capturé pour un calcul
  // roadsens, sceller depuis cet écran émettrait un PV SANS le document de
  // l'outil (repli PDF standard, silencieux). On ne l'empêche pas — mais on
  // exige un avertissement explicite + une confirmation avant d'appeler
  // emitPv (jamais de scellement sans document qui surprenne l'ingénieur).
  const [sealConfirmOpen, setSealConfirmOpen] = useState(false);

  const load = useCallback(async () => {
    if (orgId === null) return; // orgId en cours de résolution
    setLoading(true);
    setError(null);
    try {
      const data = await listCalcResults(orgId, projetId);
      setCalculs(data);
      setSelectedId((cur) => cur ?? data[0]?.id ?? null);
    } catch {
      setError('Impossible de charger les calculs.');
    } finally {
      setLoading(false);
    }
  }, [orgId, projetId]);
  useEffect(() => {
    load();
  }, [load]);

  // Relit le document capturé de l'outil à chaque sélection. 404 (contrat
  // explicite, cf. getCalcSnapshot) → snapshot null, on retombe sur les
  // métadonnées ; toute autre erreur retombe silencieusement sur le même repli
  // (jamais bloquant, l'historique reste consultable).
  useEffect(() => {
    setSnapshot(null);
    setSealError(null);
    setSealConfirmOpen(false);
    setPrintError(null);
    if (!selectedId || orgId === null) return;
    let cancelled = false;
    setSnapshotLoading(true);
    getCalcSnapshot(orgId, projetId, selectedId)
      .then((snap) => {
        if (!cancelled) setSnapshot(snap);
      })
      .catch(() => {
        if (!cancelled) setSnapshot(null);
      })
      .finally(() => {
        if (!cancelled) setSnapshotLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, orgId, projetId]);

  if (!mounted)
    return (
      <div style={{ padding: 24 }} aria-busy="true" aria-label="Chargement des calculs" />
    );

  const selected = calculs.find((c) => c.id === selectedId) ?? null;
  const output = (selected?.output ?? null) as NormalizedCalcOutput | null;
  const goGallery = () => router.push(`/app/${orgSlug}/logiciels`);
  const pvTabHref = `/app/${orgSlug}/projets/${projetId}/pv`;
  // Pilote option 3 = roadsens (les autres logiciels ne capturent pas encore le
  // document — cf. rollout par étapes) : c'est LÀ, et seulement là, qu'une
  // absence de document au moment de sceller signale une VRAIE anomalie de
  // capture (pas un simple "pas encore câblé").
  const isRoadsensCalc = !!selected && slugOf(selected.engineId) === 'burmister';

  // #6 / point 4 (revue adverse qa-challenger) : le bouton « Imprimer » n'existe
  // QUE pour un calcul déjà scellé (barre d'actions unifiée, cf. renderActionsBar)
  // — la source de vérité pour l'impression est donc TOUJOURS le document
  // SCELLÉ (`GET .../pvs/:pvId/document`), jamais une re-capture potentiellement
  // divergente du PV.
  // - 404 (`getPvDocument` → null) : PV sans document HTML capturé (ancien
  //   PV/autre moteur) — anomalie de capture distincte, pas d'intégrité ;
  //   repli LÉGITIME sur l'aperçu courant s'il est disponible.
  // - 409 (`getPvDocument` rejette, cf. http-client.ts) ou toute erreur réseau :
  //   intégrité NON vérifiable — fail-closed, on n'imprime RIEN et on le dit
  //   (jamais de repli silencieux sur un rendu dont on ne peut garantir
  //   l'authenticité).
  async function handlePrint() {
    if (!selected?.pvId || !orgId) return; // garde défensive (bouton absent sinon)
    setPrinting(true);
    setPrintError(null);
    try {
      const doc = await getPvDocument(orgId, projetId, selected.pvId);
      if (doc) {
        printInertHtml(doc.html);
        return;
      }
      // 404 : repli légitime sur l'aperçu courant, s'il existe.
      if (snapshot) printInertHtml(snapshot.printHtml);
    } catch {
      setPrintError(
        "Impossible de vérifier l'intégrité du document scellé — impression annulée. Consultez le PV depuis l'onglet PV ou réessayez plus tard.",
      );
    } finally {
      setPrinting(false);
    }
  }

  async function handleSeal() {
    if (!selected || !orgId) return;
    setSealing(true);
    setSealError(null);
    try {
      const pv = await emitPv(orgId, projetId, { calcResultId: selected.id });
      setCalculs((prev) =>
        prev.map((c) => (c.id === selected.id ? { ...c, pvId: pv.id } : c)),
      );
      setSealConfirmOpen(false);
      addToast({
        type: 'success',
        message: `PV ${pv.number} scellé.`,
        actionLabel: 'Voir le PV',
        onAction: () => router.push(pvTabHref),
      });
    } catch (err: unknown) {
      setSealError(
        (err as { message?: string })?.message ?? 'Erreur lors du scellement. Réessayez.',
      );
    } finally {
      setSealing(false);
    }
  }

  // M3 : avec document capturé → scellement direct (comportement inchangé).
  // Sans document (roadsens) → 1er clic affiche l'avertissement + demande
  // confirmation explicite ; seul le 2e clic (« Confirmer… ») appelle emitPv.
  function handleSealClick() {
    if (snapshot) {
      handleSeal();
      return;
    }
    if (!sealConfirmOpen) {
      setSealConfirmOpen(true);
      return;
    }
    handleSeal();
  }

  const sealButtonLabel =
    !snapshot && sealConfirmOpen
      ? 'Confirmer le scellement sans document'
      : 'Sceller cette version';

  // Barre d'actions UNIFIÉE (point 3, revue titulaire) : IDENTIQUE que l'aperçu
  // (snapshot) soit affiché ou qu'on soit replié sur le panneau de métadonnées
  // — une seule source de vérité, réutilisée par les deux panneaux ci-dessous.
  //  - scellé (pvId)      → « Voir le PV scellé » (primaire) + « Imprimer »
  //    (secondaire, imprime le document scellé).
  //  - non scellé, mais capture dispo (snapshot) ou moteur pilote (roadsens)
  //    → « Sceller cette version » seule (aucun document officiel à imprimer
  //    tant que ce n'est pas scellé).
  //  - non scellé, sans capture, moteur non pilote → texte informatif seul.
  function renderActionsBar() {
    if (!selected) return null;

    if (selected.pvId) {
      return (
        <div style={ACTIONS_ROW_STYLE}>
          <Link href={pvTabHref} style={{ textDecoration: 'none' }}>
            <Button
              size="sm"
              iconLeft={<Lock size={14} strokeWidth={1.5} aria-hidden="true" />}
            >
              Voir le PV scellé
            </Button>
          </Link>
          <Button
            size="sm"
            variant="secondary"
            loading={printing}
            iconLeft={<Printer size={14} strokeWidth={1.5} aria-hidden="true" />}
            onClick={handlePrint}
          >
            Imprimer
          </Button>
        </div>
      );
    }

    if (snapshot || isRoadsensCalc) {
      return (
        <div style={ACTIONS_ROW_STYLE}>
          <Button
            size="sm"
            loading={sealing}
            iconLeft={<Lock size={14} strokeWidth={1.5} aria-hidden="true" />}
            onClick={handleSealClick}
          >
            {sealButtonLabel}
          </Button>
        </div>
      );
    }

    return (
      <div style={ACTIONS_ROW_STYLE}>
        <span style={{ fontSize: 12, color: 'var(--text-tertiary, #96a0ab)' }}>
          Aucun PV émis — ouvrez le logiciel pour en générer un.
        </span>
      </div>
    );
  }

  // Avertissement M3 (revue adverse) : ne peut apparaître que quand le
  // scellement est déclenché SANS document capturé (cf. handleSealClick) —
  // c'est-à-dire jamais si `snapshot` est présent (handleSealClick scelle alors
  // directement).
  function renderSealWarning() {
    if (!selected || selected.pvId || snapshot || !sealConfirmOpen) return null;
    return (
      <div
        role="alert"
        style={{
          marginTop: 10,
          fontSize: 12,
          color: '#96701a',
          background: '#f4edd8',
          border: '1px solid #e6cf9c',
          borderRadius: 8,
          padding: '10px 12px',
        }}
      >
        Le rendu de ce calcul n&apos;a pas été capturé — le PV sera émis au format
        standard, pas le document de l&apos;outil. Relancez le calcul dans le logiciel
        pour capturer le document.
        <div style={{ marginTop: 8 }}>
          <Button size="sm" variant="ghost" onClick={() => setSealConfirmOpen(false)}>
            Annuler
          </Button>
        </div>
      </div>
    );
  }

  function renderSealError() {
    if (!sealError) return null;
    return (
      <div role="alert" style={{ marginTop: 10, fontSize: 12, color: '#b23a2e' }}>
        {sealError}
      </div>
    );
  }

  function renderPrintError() {
    if (!printError) return null;
    return (
      <div role="alert" style={{ marginTop: 10, fontSize: 12, color: '#b23a2e' }}>
        {printError}
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(260px, 320px) 1fr',
        gap: 20,
        padding: '24px 20px 56px',
        maxWidth: 1200,
        margin: '0 auto',
      }}
    >
      {/* Colonne gauche — historique */}
      <aside className="calculs-list-col">
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
          <h1 style={{ fontSize: 17, margin: 0, color: 'var(--text-primary, #16212e)' }}>
            Calculs
          </h1>
          <div style={{ marginLeft: 'auto' }}>
            <Button size="sm" onClick={goGallery}>
              Nouveau calcul
            </Button>
          </div>
        </div>
        <p
          style={{
            fontSize: 11.5,
            color: 'var(--text-secondary, #6b7178)',
            margin: '0 0 12px',
          }}
        >
          Historique en lecture. Les calculs se lancent depuis les logiciels.
        </p>

        {loading ? (
          <div style={{ fontSize: 13, color: 'var(--text-secondary, #6b7178)' }}>
            Chargement…
          </div>
        ) : error ? (
          <div style={{ fontSize: 13, color: '#b23a2e' }} role="alert">
            {error}
          </div>
        ) : calculs.length === 0 ? (
          <EmptyState
            variant="blank"
            title="Aucun calcul"
            description="Lancez un calcul depuis un logiciel ; il apparaîtra ici."
            ctaLabel="Ouvrir un logiciel"
            onCta={goGallery}
          />
        ) : (
          <ul
            role="list"
            style={{
              listStyle: 'none',
              padding: 0,
              margin: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            {calculs.map((c) => {
              const active = c.id === selectedId;
              const out = c.output as NormalizedCalcOutput | null;
              const verdict = out?.verdict;
              return (
                <li key={c.id}>
                  <button
                    onClick={() => setSelectedId(c.id)}
                    aria-current={active ? 'true' : undefined}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      background: active ? 'var(--surface-panel, #fff)' : 'transparent',
                      border: `1px solid ${active ? 'var(--border-secondary, #d2d8e1)' : 'var(--border-tertiary, #e6eaef)'}`,
                      borderRadius: 10,
                      padding: '10px 12px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {/* FX-4 : le titre est le nom métier du logiciel (identique
                          pour tous les calculs d'un même moteur) — la date/heure
                          complète et le verdict, affichés ci-dessous, sont ce qui
                          distingue deux calculs entre eux. */}
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: 'var(--text-primary, #16212e)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {metaOf(c.engineId).nom}
                      </span>
                      {verdict && verdict !== 'NA' && (
                        <span
                          style={{
                            marginLeft: 'auto',
                            flex: 'none',
                            fontSize: 9.5,
                            fontWeight: 800,
                            padding: '2px 7px',
                            borderRadius: 20,
                            background: verdict === 'PASS' ? '#e4efe6' : '#f6e5e1',
                            color: verdict === 'PASS' ? '#2e7d4f' : '#b23a2e',
                          }}
                        >
                          {verdict === 'PASS' ? 'CONFORME' : 'NON CONF.'}
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: 'var(--text-secondary, #6b7178)',
                        marginTop: 2,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={c.label}
                    >
                      {c.label}
                      {c.pvId ? ' · PV émis' : ''}
                    </div>
                    <div
                      suppressHydrationWarning
                      style={{
                        fontSize: 10.5,
                        color: 'var(--text-tertiary, #96a0ab)',
                        marginTop: 1,
                      }}
                    >
                      {new Date(c.createdAt).toLocaleString('fr-FR', {
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </aside>

      {/* Colonne droite — document de l'outil (option 3) ou, à défaut, métadonnées. */}
      <section className="calculs-panel">
        {!selected ? (
          <EmptyState
            variant="pre-calc"
            title="Sélectionnez un calcul"
            description="Choisissez un calcul dans l'historique pour en consulter le document."
          />
        ) : (
          <div
            style={{
              background: 'var(--surface-panel, #fff)',
              border: '1px solid var(--border-tertiary, #e6eaef)',
              borderRadius: 14,
              padding: '18px 20px',
            }}
          >
            <div style={{ marginBottom: 16 }}>
              <h2
                style={{ fontSize: 16, margin: 0, color: 'var(--text-primary, #16212e)' }}
              >
                {metaOf(selected.engineId).nom}
              </h2>
              <div style={{ fontSize: 12, color: 'var(--text-secondary, #6b7178)' }}>
                {selected.label}
              </div>
            </div>

            {snapshotLoading ? (
              <div
                aria-busy="true"
                aria-label="Chargement du document"
                style={{
                  fontSize: 13,
                  color: 'var(--text-secondary, #6b7178)',
                  padding: '20px 0',
                }}
              >
                Chargement du document…
              </div>
            ) : snapshot ? (
              <>
                <iframe
                  data-testid="calc-snapshot-frame"
                  title={`Aperçu du calcul — ${selected.label}`}
                  srcDoc={snapshot.displayHtml}
                  sandbox=""
                  style={{
                    width: '100%',
                    minHeight: 420,
                    border: '1px solid var(--border-tertiary, #e6eaef)',
                    borderRadius: 10,
                    background: '#fff',
                    marginBottom: 16,
                  }}
                />

                {renderActionsBar()}
                {renderSealWarning()}
                {renderSealError()}
                {renderPrintError()}

                <div
                  style={{
                    marginTop: 16,
                    fontSize: 10.5,
                    color: 'var(--text-tertiary, #96a0ab)',
                    fontStyle: 'italic',
                  }}
                >
                  {selected.pvId ? (
                    <>
                      L&apos;aperçu ci-dessus montre le rendu à l&apos;écran ; « Imprimer
                      » affiche le document scellé (celui du PV), pas cet aperçu. Formules
                      et calcul ont été appliqués côté serveur.
                    </>
                  ) : (
                    <>
                      L&apos;aperçu ci-dessus montre le rendu à l&apos;écran. Ce calcul
                      n&apos;est pas encore scellé : seule l&apos;action « Sceller cette
                      version » est proposée — l&apos;impression du document officiel ne
                      sera possible qu&apos;une fois scellé. Formules et calcul sont
                      appliqués côté serveur.
                    </>
                  )}
                </div>
              </>
            ) : (
              <>
                <dl
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'auto 1fr',
                    rowGap: 8,
                    columnGap: 14,
                    fontSize: 13,
                    margin: '0 0 20px',
                  }}
                >
                  <dt style={{ color: 'var(--text-secondary, #6b7178)' }}>Date</dt>
                  <dd suppressHydrationWarning style={{ margin: 0 }}>
                    {new Date(selected.createdAt).toLocaleString('fr-FR', {
                      day: '2-digit',
                      month: 'long',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </dd>

                  <dt style={{ color: 'var(--text-secondary, #6b7178)' }}>Statut</dt>
                  <dd style={{ margin: 0 }}>{STATUS_LABEL[selected.status]}</dd>

                  {output && output.verdict !== 'NA' && (
                    <>
                      <dt style={{ color: 'var(--text-secondary, #6b7178)' }}>Verdict</dt>
                      <dd style={{ margin: 0 }}>
                        <span
                          aria-label={`Verdict : ${output.verdict === 'PASS' ? 'CONFORME' : 'NON CONFORME'}`}
                          style={{
                            fontWeight: 700,
                            color: output.verdict === 'PASS' ? '#2e7d4f' : '#b23a2e',
                          }}
                        >
                          {output.verdict === 'PASS' ? 'CONFORME' : 'NON CONFORME'}
                        </span>
                      </dd>
                    </>
                  )}

                  <dt style={{ color: 'var(--text-secondary, #6b7178)' }}>PV</dt>
                  <dd style={{ margin: 0 }}>
                    {selected.pvId ? 'Émis' : 'Aucun PV émis'}
                  </dd>
                </dl>

                <div
                  style={{
                    marginBottom: 16,
                    fontSize: 11.5,
                    color: 'var(--text-tertiary, #96a0ab)',
                    fontStyle: 'italic',
                  }}
                >
                  Rendu non capturé — relancer le calcul dans le logiciel pour le
                  capturer.
                </div>

                {renderActionsBar()}
                {renderSealWarning()}
                {renderSealError()}
                {renderPrintError()}

                <div
                  style={{
                    marginTop: 16,
                    fontSize: 10.5,
                    color: 'var(--text-tertiary, #96a0ab)',
                    fontStyle: 'italic',
                  }}
                >
                  {selected.pvId
                    ? 'Rendu non capturé pour ce PV — « Imprimer » affiche le document officiel scellé. Formules et calcul ont été appliqués côté serveur.'
                    : 'Lecture seule. Le résultat se consulte dans le logiciel ; formules et calcul sont appliqués côté serveur.'}
                </div>
              </>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
