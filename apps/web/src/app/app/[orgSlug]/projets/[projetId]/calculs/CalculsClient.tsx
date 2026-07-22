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
 *
 * P1 dégelé (maquette écran 2, 22/07/2026) — filtres par logiciel, recherche et
 * pagination client, cf. bloc de constantes/helpers ci-dessous.
 */

import { Lock, Printer, Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useEffect, useCallback, useMemo } from 'react';

import { extractVerdict, VerdictTag } from '../verdict';

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
import { slugOf, metaOf } from '@/lib/engine-labels';
import { useOrgId } from '@/lib/org-context';
import { printInertHtml } from '@/lib/print-inert-html';
import { SOFTWARE_CATALOG } from '@/lib/software-catalog';

// Pas de lien "Ouvrir dans le logiciel" ici (retiré — l'outil s'ouvrait
// vierge, sans l'état de ce calcul restauré).

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

/**
 * Filtres par logiciel + recherche + pagination (P1 dégelé, maquette écran 2,
 * 22/07/2026). Chaîne de traitement : filtrer (chip logiciel PUIS recherche)
 * -> paginer — jamais l'inverse, sinon la pagination porterait sur un compte
 * qui ne correspond pas à ce qui est réellement affichable.
 *
 * « Non scellés » est calculable sans hypothèse : `CalcResult.pvId` est déjà
 * la donnée qui gouverne toute la barre d'actions de cet écran (scellé <=>
 * pvId défini) — pas une invention pour ce filtre.
 */
const PAGE_SIZE = 12;
type SoftwareFilter = 'all' | 'unsealed' | string;

/** Normalise une chaîne pour une comparaison insensible à la casse ET aux
 * accents (même règle que la recherche projets, ProjetsClient.tsx). */
function normaliser(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function chipStyle(pressed: boolean, disabled = false): React.CSSProperties {
  return {
    fontSize: 11.5,
    padding: '6px 10px',
    borderRadius: 999,
    border: `1px solid ${pressed ? 'var(--border-focus)' : 'var(--border-subtle)'}`,
    background: pressed ? 'var(--state-selected-bg)' : 'var(--surface-base)',
    color: pressed ? 'var(--text-primary)' : 'var(--text-secondary)',
    fontWeight: pressed ? 600 : 400,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.45 : 1,
    whiteSpace: 'nowrap',
  };
}

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

  // Filtres par logiciel + recherche + pagination (P1 dégelé) — la sélection
  // (`selectedId`) vit à part et survit à tout changement de filtre/page :
  // elle référence toujours l'ensemble complet `calculs`, jamais la page
  // affichée (cf. rendu plus bas).
  const [softwareFilter, setSoftwareFilter] = useState<SoftwareFilter>('all');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);

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

  // Effectifs par logiciel — TOUJOURS calculés sur `calculs` en entier
  // (jamais sur la liste déjà filtrée) : c'est une facette stable, pas un
  // second filtre qui se retirerait lui-même. Les 6 logiciels du catalogue
  // sont TOUS représentés, même à effectif 0 (chip désactivée, pas masquée —
  // même règle que les chips de domaine de l'écran 1).
  const softwareCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const entry of SOFTWARE_CATALOG) counts[entry.engineId] = 0;
    for (const c of calculs) {
      const slug = slugOf(c.engineId);
      if (slug in counts) counts[slug] += 1;
    }
    return counts;
  }, [calculs]);
  const unsealedCount = useMemo(() => calculs.filter((c) => !c.pvId).length, [calculs]);

  // Filtrer (chip logiciel) PUIS rechercher — ordre demandé par la maquette.
  const filteredBySoftware = useMemo(() => {
    if (softwareFilter === 'all') return calculs;
    if (softwareFilter === 'unsealed') return calculs.filter((c) => !c.pvId);
    return calculs.filter((c) => slugOf(c.engineId) === softwareFilter);
  }, [calculs, softwareFilter]);

  const filteredCalculs = useMemo(() => {
    const q = normaliser(query.trim());
    if (!q) return filteredBySoftware;
    return filteredBySoftware.filter((c) => {
      const hay = normaliser(`${metaOf(c.engineId).nom} ${c.label}`);
      return hay.includes(q);
    });
  }, [filteredBySoftware, query]);

  // Pagination — appliquée APRÈS filtre + recherche. Bornage défensif : si la
  // page en mémoire dépasse le nouveau total, on retombe sur la dernière page
  // valide (jamais un panneau vide en silence) ; ce bornage seul NE remet PAS
  // à 1 tout seul — c'est `handleSoftwareFilter`/`handleQueryChange`
  // ci-dessous qui portent explicitement cette remise à 1.
  const totalPages = Math.max(1, Math.ceil(filteredCalculs.length / PAGE_SIZE));
  const pageActuelle = Math.min(page, totalPages);
  const paginatedCalculs = useMemo(
    () => filteredCalculs.slice((pageActuelle - 1) * PAGE_SIZE, pageActuelle * PAGE_SIZE),
    [filteredCalculs, pageActuelle],
  );

  function handleSoftwareFilter(next: SoftwareFilter) {
    setSoftwareFilter(next);
    setPage(1);
  }

  function handleQueryChange(next: string) {
    setQuery(next);
    setPage(1);
  }

  if (!mounted)
    return (
      <div style={{ padding: 24 }} aria-busy="true" aria-label="Chargement des calculs" />
    );

  // La sélection référence TOUJOURS l'ensemble complet des calculs — jamais
  // la page affichée : sélectionner un calcul puis changer de page ne doit
  // jamais faire disparaître le panneau de détail.
  const selected = calculs.find((c) => c.id === selectedId) ?? null;
  const output = (selected?.output ?? null) as NormalizedCalcOutput | null;
  // Trois verdicts, pas deux — TOUJOURS extrait (y compris NA), affiché dans
  // l'en-tête du panneau quel que soit l'état (aperçu ou repli métadonnées).
  const verdictOfSelected = selected ? extractVerdict(selected.output) : undefined;
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
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
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
          color: 'var(--status-warn-tx)',
          background: 'var(--status-warn-bg)',
          border: '1px solid var(--warn-line, var(--status-warn-tx))',
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
      <div
        role="alert"
        style={{ marginTop: 10, fontSize: 12, color: 'var(--status-fail-tx)' }}
      >
        {sealError}
      </div>
    );
  }

  function renderPrintError() {
    if (!printError) return null;
    return (
      <div
        role="alert"
        style={{ marginTop: 10, fontSize: 12, color: 'var(--status-fail-tx)' }}
      >
        {printError}
      </div>
    );
  }

  // Note de fidélité et de confidentialité (DoD §8) — l'engagement tenu par
  // ce panneau : le document AFFICHÉ est celui du logiciel client, reproduit
  // à l'identique (option 3, capture serveur) — jamais reconstruit ni recalculé
  // dans le navigateur. Cette mention n'est honnête QUE quand un document a
  // réellement été capturé (`snapshot`) : sans capture, il n'y a rien à
  // "reproduire à l'identique" — on ne le prétend donc pas dans ce cas, mais
  // le calcul reste, lui, TOUJOURS exécuté côté serveur.
  function renderConfidentialityNote(hasSnapshot: boolean) {
    if (!selected) return null;
    if (hasSnapshot) {
      const fidelity =
        "Rendu produit par le logiciel du client, reproduit à l'identique. Calcul exécuté côté serveur.";
      const suffix = selected.pvId
        ? ' « Imprimer » affiche le document scellé (celui du PV), pas cet aperçu.'
        : " Ce calcul n'est pas encore scellé : seule l'action « Sceller cette version » est proposée — l'impression du document officiel ne sera possible qu'une fois scellé.";
      return (
        <div
          style={{
            marginTop: 12,
            fontSize: 10.5,
            color: 'var(--text-muted)',
            fontStyle: 'italic',
          }}
        >
          {fidelity}
          {suffix}
        </div>
      );
    }
    return (
      <div
        style={{
          marginTop: 12,
          fontSize: 10.5,
          color: 'var(--text-muted)',
          fontStyle: 'italic',
        }}
      >
        {selected.pvId
          ? 'Rendu non capturé pour ce PV — « Imprimer » affiche le document officiel scellé. Calcul exécuté côté serveur.'
          : 'Lecture seule. Le résultat se consulte dans le logiciel ; calcul exécuté côté serveur.'}
      </div>
    );
  }

  // Barre de filtres par logiciel + recherche (P1 dégelé, maquette écran 2).
  // Un seul groupe ARIA englobe « Tous », les 6 chips logiciel (catalogue
  // COMPLET, effectif 0 = désactivé, jamais masqué) et « Non scellés ».
  function renderFilterBar() {
    if (calculs.length === 0) return null;
    return (
      <div
        style={{
          flex: 'none',
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
          alignItems: 'center',
          padding: '16px 20px 0',
        }}
      >
        <div
          role="group"
          aria-label="Filtrer les calculs par logiciel"
          style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}
        >
          <button
            type="button"
            aria-pressed={softwareFilter === 'all'}
            onClick={() => handleSoftwareFilter('all')}
            style={chipStyle(softwareFilter === 'all')}
          >
            Tous{' '}
            <b style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
              {calculs.length}
            </b>
          </button>
          {SOFTWARE_CATALOG.map((entry) => {
            const count = softwareCounts[entry.engineId] ?? 0;
            const pressed = softwareFilter === entry.engineId;
            return (
              <button
                key={entry.engineId}
                type="button"
                aria-pressed={pressed}
                disabled={count === 0}
                onClick={() => handleSoftwareFilter(entry.engineId)}
                style={chipStyle(pressed, count === 0)}
              >
                {entry.nom}{' '}
                <b style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{count}</b>
              </button>
            );
          })}
          <button
            type="button"
            aria-pressed={softwareFilter === 'unsealed'}
            onClick={() => handleSoftwareFilter('unsealed')}
            style={chipStyle(softwareFilter === 'unsealed')}
          >
            Non scellés{' '}
            <b style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
              {unsealedCount}
            </b>
          </button>
        </div>

        <div style={{ position: 'relative', flex: '1 1 200px', minWidth: 180 }}>
          <Search
            size={13}
            strokeWidth={1.5}
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: 9,
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--text-muted)',
              pointerEvents: 'none',
            }}
          />
          <input
            type="search"
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            placeholder="Rechercher un calcul"
            aria-label="Rechercher parmi les calculs"
            style={{
              width: '100%',
              padding: '6px 10px 6px 28px',
              fontSize: 12,
              border: '1px solid var(--border-subtle)',
              borderRadius: 8,
              background: 'var(--surface-base)',
              color: 'var(--text-primary)',
            }}
          />
        </div>
      </div>
    );
  }

  // Pagination client (~12/page, P1 dégelé) — masquée dès que tout tient sur
  // une page. Toujours APRÈS filtre + recherche (cf. `paginatedCalculs`).
  function renderPagination() {
    if (totalPages <= 1) return null;
    return (
      <div
        style={{
          flex: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          marginTop: 10,
          paddingTop: 8,
        }}
      >
        <button
          type="button"
          disabled={pageActuelle <= 1}
          onClick={() => setPage(Math.max(1, pageActuelle - 1))}
          style={{
            padding: '5px 10px',
            fontSize: 11.5,
            border: '1px solid var(--border-subtle)',
            borderRadius: 6,
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
            fontSize: 10.5,
            color: 'var(--text-secondary)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          Page {pageActuelle} sur {totalPages}
        </span>
        <button
          type="button"
          disabled={pageActuelle >= totalPages}
          onClick={() => setPage(Math.min(totalPages, pageActuelle + 1))}
          style={{
            padding: '5px 10px',
            fontSize: 11.5,
            border: '1px solid var(--border-subtle)',
            borderRadius: 6,
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
    );
  }

  return (
    // Colonne englobante : la barre de filtres/recherche (P1 dégelé, hauteur
    // fixe) au-dessus, puis la grille liste+document qui occupe le RESTE de
    // la hauteur — c'est elle, pas cette colonne, qui porte `height: '100%'`.
    <div
      style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}
    >
      {renderFilterBar()}
      {/* Panneau de détail PLEINE HAUTEUR (correction titulaire, maquette
          écran 2) : `flex: '1 1 auto'` + `minHeight: 0` sur toute la chaîne
          flex, plutôt qu'une hauteur dictée par le contenu. `overflow: hidden`
          ici : la page ne défile jamais, seules les DEUX régions internes
          (liste, document) défilent. */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(260px, 320px) 1fr',
          gap: 20,
          padding: 20,
          flex: '1 1 auto',
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        {/* Colonne gauche — historique */}
        <aside
          className="calculs-list-col"
          style={{
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            minHeight: 0,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              marginBottom: 12,
              flex: 'none',
            }}
          >
            <h1
              style={{ fontSize: 17, margin: 0, color: 'var(--text-primary, #16212e)' }}
            >
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
              flex: 'none',
            }}
          >
            Historique en lecture. Les calculs se lancent depuis les logiciels.
          </p>

          {/* SEULE région défilante de cette colonne — l'en-tête ci-dessus
              reste fixe pendant que l'historique défile. */}
          <div
            data-testid="calculs-list-scroll"
            style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto' }}
          >
            {loading ? (
              <div style={{ fontSize: 13, color: 'var(--text-secondary, #6b7178)' }}>
                Chargement…
              </div>
            ) : error ? (
              <div style={{ fontSize: 13, color: 'var(--status-fail-tx)' }} role="alert">
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
            ) : filteredCalculs.length === 0 ? (
              // Filtre/recherche sans correspondance — DISTINCT de « Aucun
              // calcul » ci-dessus (qui répond à zéro calcul dans le projet).
              <div
                style={{
                  fontSize: 12.5,
                  color: 'var(--text-secondary, #6b7178)',
                  padding: '12px 4px',
                }}
              >
                Aucun calcul ne correspond à ces critères.
              </div>
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
                {paginatedCalculs.map((c) => {
                  const active = c.id === selectedId;
                  const verdict = extractVerdict(c.output);
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
                          background: active ? 'var(--surface-base)' : 'transparent',
                          border: `1px solid ${active ? 'var(--border-default)' : 'var(--border-subtle)'}`,
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
                          {/* Trois verdicts, pas deux — NON APPLICABLE (moteur
                            d'extraction/classification, ex. GEOPLAQUE/radier)
                            n'est PAS masqué : c'est une information réelle,
                            pas un échec, cf. verdict.tsx (ADR 0008 neutre). */}
                          {verdict && (
                            <VerdictTag
                              verdict={verdict}
                              compact
                              style={{ marginLeft: 'auto' }}
                            />
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
                            color: 'var(--text-muted)',
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
            {renderPagination()}
          </div>
        </aside>

        {/* Colonne droite — document de l'outil (option 3) ou, à défaut, métadonnées.
            Toujours pleine hauteur : que le calcul soit sélectionné ou non
            (état vide compris), la colonne occupe l'espace disponible. */}
        <section
          className="calculs-panel"
          style={{
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            minHeight: 0,
            overflow: 'hidden',
          }}
        >
          {!selected ? (
            <div
              style={{
                flex: '1 1 auto',
                minHeight: 0,
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <EmptyState
                variant="pre-calc"
                title="Sélectionnez un calcul"
                description="Choisissez un calcul dans l'historique pour en consulter le document."
                minHeight="100%"
              />
            </div>
          ) : (
            <div
              data-testid="calc-detail-panel"
              className="surface-glass"
              style={{
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
                minHeight: 0,
                overflow: 'hidden',
              }}
            >
              {/* En-tête — fixe, ne défile jamais. Le verdict de conformité y
                  reste TOUJOURS visible (avant correction : absent dès qu'un
                  aperçu snapshot était affiché — cf. Trois verdicts, pas deux). */}
              <div
                data-testid="calc-detail-header"
                style={{
                  flex: 'none',
                  padding: '18px 20px 14px',
                  borderBottom: '1px solid var(--border-subtle)',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h2
                    style={{
                      fontSize: 16,
                      margin: 0,
                      color: 'var(--text-primary, #16212e)',
                    }}
                  >
                    {metaOf(selected.engineId).nom}
                  </h2>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary, #6b7178)' }}>
                    {selected.label}
                  </div>
                </div>
                {/* Verdict TOUJOURS visible dans l'en-tête, que le document soit
                  affiché (aperçu) ou en repli métadonnées — cf. verdict.tsx. */}
                {verdictOfSelected && (
                  <VerdictTag verdict={verdictOfSelected} style={{ fontSize: 9.5 }} />
                )}
              </div>

              {/* Corps — SEULE région qui défile dans ce panneau (pas la page).
                Aucune action ici : les actions restent ancrées dans le pied,
                en dehors de cette zone défilante. */}
              <div
                data-testid="calc-detail-body"
                style={{
                  flex: '1 1 auto',
                  minHeight: 0,
                  overflowY: 'auto',
                  padding: '16px 20px',
                  // Colonne flex pour que le document (iframe) puisse REMPLIR la
                  // hauteur restante au lieu de rester a une taille fixe. Sans
                  // cela, le panneau etait bien pleine hauteur mais son contenu
                  // s'arretait a 420px : document coupe en plein milieu, et un
                  // grand vide en dessous — exactement le defaut signale.
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
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
                  <iframe
                    data-testid="calc-snapshot-frame"
                    title={`Aperçu du calcul — ${selected.label}`}
                    srcDoc={snapshot.displayHtml}
                    sandbox=""
                    style={{
                      width: '100%',
                      // REMPLIT la hauteur disponible et defile EN INTERNE. On ne
                      // peut pas dimensionner l'iframe sur la hauteur de son
                      // contenu : `sandbox=""` interdit tout script, donc rien ne
                      // peut mesurer le document depuis l'interieur et nous le
                      // renvoyer. Faire remplir est la seule option honnete — et
                      // c'est aussi ce que demande la maquette (le document du
                      // logiciel client occupe la place).
                      flex: '1 1 auto',
                      // Plancher : sur un ecran tres court, le document garde une
                      // hauteur lisible et c'est le panneau qui defile.
                      minHeight: 420,
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 10,
                      background: '#fff',
                    }}
                  />
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

                      {/* Trois verdicts, pas deux — NON APPLICABLE affiché, pas
                        masqué (avant correction : la ligne disparaissait
                        entièrement pour ce cas réel, ex. radier). */}
                      {output && verdictOfSelected && (
                        <>
                          <dt style={{ color: 'var(--text-secondary, #6b7178)' }}>
                            Verdict
                          </dt>
                          <dd style={{ margin: 0 }}>
                            <VerdictTag
                              verdict={verdictOfSelected}
                              style={{ fontSize: 11 }}
                            />
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
                        fontSize: 11.5,
                        color: 'var(--text-muted)',
                        fontStyle: 'italic',
                      }}
                    >
                      Rendu non capturé — relancer le calcul dans le logiciel pour le
                      capturer.
                    </div>
                  </>
                )}
              </div>

              {/* Pied — ANCRÉ EN BAS, jamais dans la zone défilante ci-dessus.
                Absent tant que le document est en cours de chargement (comme
                avant la refonte : pas d'action tant que l'état snapshot n'est
                pas connu). */}
              {!snapshotLoading && (
                <div
                  data-testid="calc-detail-footer"
                  style={{
                    flex: 'none',
                    padding: '12px 20px 16px',
                    borderTop: '1px solid var(--border-subtle)',
                  }}
                >
                  {renderActionsBar()}
                  {renderSealWarning()}
                  {renderSealError()}
                  {renderPrintError()}
                  {renderConfidentialityNote(!!snapshot)}
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
