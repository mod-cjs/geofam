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

import { Download, Lock, Pencil, Printer, Search, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useEffect, useCallback, useMemo } from 'react';

import { extractVerdict, VerdictTag } from '../verdict';

import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import {
  listCalcResults,
  getCalcSnapshot,
  renameCalcResult,
  deleteCalcResult,
  emitPv,
  getPvDocument,
  getProjectCached,
} from '@/lib/api/client';
import type { CalcResult, CalcSnapshot, NormalizedCalcOutput } from '@/lib/api/types';
import { nomAffiche, nomAfficheCompact, seqParCreation } from '@/lib/calc-name';
import { slugOf, metaOf } from '@/lib/engine-labels';
import { useOrgId } from '@/lib/org-context';
import { printInertHtml } from '@/lib/print-inert-html';
import { SOFTWARE_CATALOG } from '@/lib/software-catalog';

// Pas de lien "Ouvrir dans le logiciel" ici (retiré — l'outil s'ouvrait
// vierge, sans l'état de ce calcul restauré).

// Style commun de la barre d'actions (les deux panneaux).
/**
 * EXPORTER (JSON) — reproduit le bouton « Exporter » de l'outil client, qui
 * télécharge la SAISIE (l'état `S` du formulaire) dans un fichier ré-importable
 * via son bouton « Importer ». Notre `calc_results.input` EST cette forme `S`
 * (le contrat valide directement l'état de l'outil), donc l'export d'un calcul
 * PERSISTÉ produit un fichier que l'outil sait relire.
 *
 * Confidentialité (DoD §8) : on n'exporte QUE les ENTRÉES — aucune formule ni
 * sortie moteur. Ce sont les données que l'ingénieur a lui-même saisies.
 */
function triggerJsonDownload(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Nom de fichier calqué sur l'outil client : `<logiciel>-<projet>.json`. */
function exportFilename(engineSlug: string, params: Record<string, unknown>): string {
  const projet =
    typeof params.projet === 'string' && params.projet.trim() ? params.projet : 'projet';
  const slug = projet
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `${engineSlug}-${slug || 'projet'}.json`;
}

/**
 * FILIGRANE « document de travail » — pour l'APERÇU DE LA NOTE AVANT scellement.
 *
 * L'outil client imprime la note à tout moment (« Imprimer la note »). On porte
 * ce livrable de TRAVAIL, mais la revue adverse #6 avait retiré l'impression
 * pré-scellement au motif qu'un aperçu pourrait DIVERGER du document finalement
 * scellé et se faire passer pour le PV. On réconcilie : l'aperçu est autorisé,
 * mais filigrané de façon impossible à confondre avec le PV opposable — bandeau
 * en tête + filigrane diagonal répété, y compris à l'impression.
 *
 * Le HTML est le `printHtml` capturé de l'outil (déjà inerte, `assertInertHtml`
 * au moment de la capture) ; on n'y injecte que de la présentation.
 */
const DRAFT_WATERMARK_TEXT = 'DOCUMENT DE TRAVAIL — NON SCELLÉ · non opposable';

// Tuile SVG « NON SCELLÉ » (data-URI) répétée en fond : contrairement à un texte
// unique centré, un fond TUILÉ couvre TOUTE la hauteur du document, donc CHAQUE
// page à l'impression (le bandeau, lui, n'apparaît qu'en page 1). C'est la seule
// marque garantie par page.
// Limite connue (dette tracée, revue adverse) : sous Firefox, un overlay
// `position:fixed` peut n'être imprimé qu'UNE fois ; la robustesse multi-pages
// tous navigateurs (motif de page via @page) est à durcir quand on généralisera
// au-delà du pilote Terzaghi.
const DRAFT_WM_TILE = encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="360" height="230">' +
    '<text x="180" y="120" transform="rotate(-30 180 120)" ' +
    'fill="rgba(122,74,18,0.13)" font-family="system-ui,sans-serif" ' +
    'font-size="26" font-weight="700" text-anchor="middle">NON SCELLÉ</text></svg>',
);

function injectDraftWatermark(html: string): string {
  const style =
    '<style id="__draft_wm">' +
    // Bandeau en tête (écran : sticky ; impression : page 1).
    '.__draft-banner{position:sticky;top:0;z-index:99999;background:#7a4a12;' +
    'color:#fff;font:600 12px/1.4 system-ui,sans-serif;text-align:center;' +
    'padding:6px 10px;letter-spacing:.04em}' +
    // Filigrane TUILÉ par page (overlay non cliquable, fond répété).
    '.__draft-wm{position:fixed;inset:0;z-index:99998;pointer-events:none;' +
    `background-image:url("data:image/svg+xml,${DRAFT_WM_TILE}");` +
    'background-repeat:repeat;background-position:top left}' +
    '@media print{.__draft-banner{position:static}}' +
    '</style>';
  const overlay =
    '<div class="__draft-banner">' +
    DRAFT_WATERMARK_TEXT +
    '</div><div class="__draft-wm" aria-hidden="true"></div>';
  let out = html;
  out = /<\/head>/i.test(out)
    ? out.replace(/<\/head>/i, () => style + '</head>')
    : style + out;
  out = /<body[^>]*>/i.test(out)
    ? out.replace(/<body[^>]*>/i, (m) => m + overlay)
    : overlay + out;
  return out;
}

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

  // Nom mnémonique (décision titulaire 22/07/2026) — nécessite le nom du
  // PROJET courant (contexte pas encore disponible dans ce composant, cf.
  // lib/calc-name.ts). `getProjectCached` est déjà partagé avec
  // ProjetLayoutClient/PvListClient (pas de GET redondant).
  const [projectName, setProjectName] = useState<string | null>(null);
  useEffect(() => {
    if (orgId === null) return;
    let cancelled = false;
    getProjectCached(orgId, projetId)
      .then((p) => {
        if (!cancelled) setProjectName(p.name);
      })
      .catch(() => {
        /* repli silencieux : le mnémonique s'affiche alors sans nom de projet */
      });
    return () => {
      cancelled = true;
    };
  }, [orgId, projetId]);

  // Renommage en ligne (P0-7 patron, appliqué aux calculs) : le crayon ouvre
  // un champ pré-rempli du nom d'affichage COURANT (mnémonique ou personnalisé).
  const [renommage, setRenommage] = useState<string | null>(null);

  // Suppression d'un calcul NON scellé — irréversible, confirmation forte.
  const [calcToDelete, setCalcToDelete] = useState<CalcResult | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Dialogue de nommage AVANT émission du PV (décision titulaire 22/07/2026) :
  // pré-rempli avec le nom d'affichage courant du calcul source, éditable.
  const [sealNameOpen, setSealNameOpen] = useState(false);
  const [sealNameValue, setSealNameValue] = useState('');

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

  // Position #n (mnémonique) — TOUJOURS calculée sur `calculs` en ENTIER,
  // jamais sur la liste filtrée/paginée : le numéro d'un calcul ne doit pas se
  // déplacer selon le filtre ou la page affichés (cf. lib/calc-name.ts).
  const seqById = useMemo(() => seqParCreation(calculs, (c) => c.createdAt), [calculs]);

  // Nom COMPLET « Logiciel · Projet · #n » — pour les endroits larges (en-tête
  // du panneau de détail, modales, valeur pré-remplie à l'émission du PV).
  const displayNameOf = useCallback(
    (c: CalcResult) => nomAffiche(c, projectName ?? '', seqById.get(c.id) ?? 0),
    [projectName, seqById],
  );

  // Nom COMPACT « Logiciel · #n » — pour la COLONNE ÉTROITE de la liste
  // (décision titulaire 22/07/2026). Vérifié dans l'app réelle : le nom complet
  // y était tronqué à « ROADSENS · Route Dakar-T… » sur toutes les lignes, ce
  // qui coupait le #n — la seule partie qui les distingue. Le nom du projet est
  // de toute façon redondant ici : on est déjà DANS ce projet.
  const shortNameOf = useCallback(
    (c: CalcResult) => nomAfficheCompact(c, seqById.get(c.id) ?? 0),
    [seqById],
  );

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
      // Recherche étendue au NOM d'affichage (mnémonique ou personnalisé) — un
      // calcul renommé doit rester trouvable par ce nom, pas seulement par le
      // logiciel/libellé technique.
      const hay = normaliser(`${metaOf(c.engineId).nom} ${c.label} ${displayNameOf(c)}`);
      return hay.includes(q);
    });
  }, [filteredBySoftware, query, displayNameOf]);

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
  // EXPORTER (JSON) du calcul sélectionné — livrable « Exporter » de l'outil,
  // porté sur un calcul PERSISTÉ de l'historique. `params` = l'input persisté
  // (forme `S` de l'outil), déjà présent sur chaque ligne (listForProject
  // renvoie l'input). Aucun appel réseau, aucune sortie moteur.
  function handleExportJson() {
    if (!selected) return;
    triggerJsonDownload(
      selected.params,
      exportFilename(slugOf(selected.engineId), selected.params),
    );
  }

  // APERÇU DE LA NOTE avant scellement (livrable « Imprimer la note » de l'outil,
  // version TRAVAIL) : imprime le document capturé, FILIGRANÉ « non scellé » pour
  // qu'il ne se confonde jamais avec le PV opposable. Bouton présent seulement si
  // un document a été capturé (snapshot) et que le calcul n'est PAS scellé (un
  // calcul scellé imprime son PV officiel via handlePrint, pas un aperçu).
  function handlePreviewNote() {
    if (!snapshot) return;
    printInertHtml(injectDraftWatermark(snapshot.printHtml));
  }

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

  /**
   * Émet le PV. `name` est TOUJOURS envoyé (pré-rempli par le dialogue de
   * nommage, cf. `openSealNameDialog` / Modal ci-dessous) — décision titulaire
   * 22/07/2026 : proposer un nom éditable AVANT scellement plutôt qu'imposer
   * silencieusement le mnémonique.
   */
  async function handleSeal(name?: string) {
    if (!selected || !orgId) return;
    setSealing(true);
    setSealError(null);
    try {
      const pv = await emitPv(orgId, projetId, { calcResultId: selected.id, name });
      setCalculs((prev) =>
        prev.map((c) => (c.id === selected.id ? { ...c, pvId: pv.id } : c)),
      );
      setSealConfirmOpen(false);
      setSealNameOpen(false);
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

  /** Ouvre le dialogue de nommage, pré-rempli avec le nom d'affichage COURANT
   * du calcul source (mnémonique ou déjà renommé) — cf. nomAffiche. */
  function openSealNameDialog() {
    if (!selected) return;
    setSealNameValue(displayNameOf(selected));
    setSealNameOpen(true);
  }

  // M3 : avec document capturé → dialogue de nommage direct (comportement
  // inchangé pour le fond, cf. avant ce lot, où l'émission était directe).
  // Sans document (roadsens) → 1er clic affiche l'avertissement + demande
  // confirmation explicite ; seul le 2e clic (« Confirmer… ») ouvre le
  // dialogue de nommage (l'émission proprement dite n'a lieu qu'à sa validation).
  function handleSealClick() {
    if (!snapshot && !sealConfirmOpen) {
      setSealConfirmOpen(true);
      return;
    }
    openSealNameDialog();
  }

  /**
   * Renommage en ligne d'un calcul (patron rename-inline des projets, P0-7).
   * Une saisie VIDE renvoie explicitement `null` (retour au mnémonique) — à la
   * différence du renommage projet, où le vide est un no-op (un projet n'a pas
   * de mnémonique de repli). Une saisie IDENTIQUE au nom personnalisé actuel
   * (pas au mnémonique affiché) n'appelle pas non plus l'API.
   */
  async function handleRenameCalc(c: CalcResult, nouveau: string) {
    setRenommage(null);
    if (!orgId) return;
    const nomActuel = c.name ?? null;
    const valeur = nouveau.trim();

    // Le champ est PRÉ-REMPLI avec le nom d'affichage courant — donc, sur un
    // calcul sans nom, avec le MNÉMONIQUE lui-même. Valider sans rien modifier
    // (Entrée, ou simplement cliquer ailleurs) ne doit PAS figer ce mnémonique
    // en nom personnalisé : il deviendrait menteur (il ne suivrait plus le
    // projet renommé ni le rang) et repasserait en forme longue dans la colonne
    // étroite, ramenant la troncature que la forme compacte corrige.
    // « Saisie identique au mnémonique » vaut donc « pas de nom personnalisé ».
    const mnemoniqueCourant = nomAffiche(
      { name: null, engineId: c.engineId },
      projectName ?? '',
      seqById.get(c.id) ?? 0,
    );

    if (valeur === '' || valeur === mnemoniqueCourant) {
      if (nomActuel === null) return; // déjà au mnémonique, rien à changer
      try {
        const maj = await renameCalcResult(orgId, projetId, c.id, null);
        setCalculs((prev) => prev.map((x) => (x.id === c.id ? maj : x)));
        addToast({ type: 'success', message: 'Nom réinitialisé au mnémonique.' });
      } catch {
        addToast({ type: 'error', message: 'Renommage impossible.' });
      }
      return;
    }

    if (valeur === nomActuel) return; // inchangé

    try {
      const maj = await renameCalcResult(orgId, projetId, c.id, valeur);
      setCalculs((prev) => prev.map((x) => (x.id === c.id ? maj : x)));
      addToast({ type: 'success', message: `Calcul renommé « ${maj.name} ».` });
    } catch {
      addToast({ type: 'error', message: 'Renommage impossible.' });
    }
  }

  /**
   * Suppression DÉFINITIVE d'un calcul NON scellé (bouton absent sinon, cf.
   * rendu de la ligne plus bas). 409 (un PV existe malgré tout, ex. concurrence)
   * → message exploitable, la modale reste ouverte plutôt que de fermer en
   * silence sur un refus serveur.
   */
  async function handleDeleteCalc() {
    if (!calcToDelete || !orgId) return;
    setDeleting(true);
    setDeleteError(null);
    const cible = calcToDelete;
    try {
      await deleteCalcResult(orgId, projetId, cible.id);
      setCalculs((prev) => prev.filter((c) => c.id !== cible.id));
      setSelectedId((cur) => (cur === cible.id ? null : cur));
      addToast({ type: 'success', message: 'Calcul supprimé.' });
      setCalcToDelete(null);
    } catch (err: unknown) {
      const statusCode = (err as { statusCode?: number } | undefined)?.statusCode;
      const message = (err as { message?: string } | undefined)?.message;
      if (statusCode === 409) {
        setDeleteError(
          message ?? 'Ce calcul porte un PV scellé, il ne peut pas être supprimé.',
        );
      } else if (statusCode === 404) {
        setDeleteError(message ?? 'Calcul introuvable — peut-être déjà supprimé.');
      } else {
        addToast({ type: 'error', message: 'Erreur lors de la suppression du calcul.' });
      }
    } finally {
      setDeleting(false);
    }
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
  // « Exporter (JSON) » — livrable présent quel que soit l'état du calcul
  // (scellé ou non) : les ENTRÉES d'un calcul persisté sont toujours
  // exportables/ré-importables. Rendu dans chaque branche de la barre d'actions.
  const exportButton = (
    <Button
      size="sm"
      variant="secondary"
      iconLeft={<Download size={14} strokeWidth={1.5} aria-hidden="true" />}
      onClick={handleExportJson}
    >
      Exporter (JSON)
    </Button>
  );

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
          {exportButton}
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
          {snapshot && (
            <Button
              size="sm"
              variant="secondary"
              iconLeft={<Printer size={14} strokeWidth={1.5} aria-hidden="true" />}
              onClick={handlePreviewNote}
            >
              Aperçu de la note
            </Button>
          )}
          {exportButton}
        </div>
      );
    }

    return (
      <div style={ACTIONS_ROW_STYLE}>
        {exportButton}
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
                  // Colonne étroite -> forme COMPACTE « Logiciel · #n » : le nom
                  // complet y était tronqué sur toutes les lignes, coupant le #n
                  // qui les distingue. Le nom COMPLET reste dans l'en-tête du
                  // panneau de détail et dans le champ de renommage (ci-dessous).
                  const displayName = shortNameOf(c);
                  const enRenommage = renommage === c.id;
                  return (
                    <li
                      key={c.id}
                      style={{ display: 'flex', alignItems: 'stretch', gap: 4 }}
                    >
                      {enRenommage ? (
                        // Renommage en ligne (patron rename-inline des projets) : un
                        // <input> ne peut pas vivre DANS le <button> de sélection
                        // (nesting HTML invalide) — il le REMPLACE le temps de la
                        // saisie, plutôt que de le contenir.
                        <div style={{ flex: 1, padding: '10px 12px' }}>
                          <input
                            autoFocus
                            // Nom COMPLET à la saisie (pas la forme compacte de
                            // la liste) : le client doit voir et pouvoir garder
                            // ce qu'il renomme réellement, pas un raccourci
                            // d'affichage qui deviendrait le nom persisté.
                            defaultValue={displayNameOf(c)}
                            aria-label={`Renommer le calcul ${displayName}`}
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => {
                              e.stopPropagation();
                              if (e.key === 'Enter')
                                handleRenameCalc(c, e.currentTarget.value);
                              // Échap annule SANS écrire.
                              if (e.key === 'Escape') setRenommage(null);
                            }}
                            onBlur={(e) => handleRenameCalc(c, e.currentTarget.value)}
                            style={{
                              width: '100%',
                              font: 'inherit',
                              fontSize: 13,
                              color: 'var(--text-primary)',
                              background: 'var(--surface-base)',
                              border: '1px solid var(--border-focus)',
                              borderRadius: 8,
                              padding: '6px 8px',
                            }}
                          />
                        </div>
                      ) : (
                        <button
                          onClick={() => setSelectedId(c.id)}
                          aria-current={active ? 'true' : undefined}
                          style={{
                            flex: 1,
                            minWidth: 0,
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
                            {/* Titre = nom d'affichage (mnémonique ou renommé) — le
                              nom du logiciel, identique pour tous les calculs d'un
                              même moteur, descend en méta (ligne suivante). */}
                            <span
                              title={displayName}
                              style={{
                                fontSize: 13,
                                fontWeight: 600,
                                color: 'var(--text-primary, #16212e)',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {displayName}
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
                            {metaOf(c.engineId).nom} · {c.label}
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
                      )}
                      {!enRenommage && (
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 2,
                            flexShrink: 0,
                            justifyContent: 'center',
                          }}
                        >
                          <button
                            type="button"
                            aria-label={`Renommer le calcul ${displayName}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setRenommage(c.id);
                            }}
                            style={{
                              display: 'inline-grid',
                              placeItems: 'center',
                              width: 24,
                              height: 24,
                              border: 0,
                              background: 'none',
                              color: 'var(--text-muted)',
                              cursor: 'pointer',
                            }}
                          >
                            <Pencil size={12} strokeWidth={1.5} aria-hidden="true" />
                          </button>
                          {/* Supprimer — UNIQUEMENT pour un calcul NON scellé (pvId
                            absent) : un calcul portant un PV n'a pas cette action,
                            plutôt que de la proposer désactivée sans explication
                            visible ici (la raison est de toute façon évidente : le
                            calcul affiche déjà « · PV émis » juste au-dessus). */}
                          {!c.pvId && (
                            <button
                              type="button"
                              aria-label={`Supprimer le calcul ${displayName}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setDeleteError(null);
                                setCalcToDelete(c);
                              }}
                              style={{
                                display: 'inline-grid',
                                placeItems: 'center',
                                width: 24,
                                height: 24,
                                border: 0,
                                background: 'none',
                                color: 'var(--text-muted)',
                                cursor: 'pointer',
                              }}
                            >
                              <Trash2 size={12} strokeWidth={1.5} aria-hidden="true" />
                            </button>
                          )}
                        </div>
                      )}
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
                    {displayNameOf(selected)}
                  </h2>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary, #6b7178)' }}>
                    {metaOf(selected.engineId).nom} · {selected.label}
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
                  {renderPrintError()}
                  {renderConfidentialityNote(!!snapshot)}
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      {/* Dialogue de nommage AVANT émission du PV (décision titulaire
          22/07/2026) — pré-rempli avec le nom d'affichage courant du calcul
          source (nomAffiche), éditable. L'appel emitPv n'a lieu qu'à la
          validation de cette modale (jamais au clic sur « Sceller cette
          version » lui-même). */}
      <Modal
        open={sealNameOpen}
        onClose={() => {
          if (!sealing) setSealNameOpen(false);
        }}
        title="Nommer le PV avant scellement"
        size="sm"
        error={sealError ?? undefined}
        footer={
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button
              variant="ghost"
              size="md"
              onClick={() => setSealNameOpen(false)}
              disabled={sealing}
            >
              Annuler
            </Button>
            <Button
              variant="action"
              size="md"
              loading={sealing}
              onClick={() => handleSeal(sealNameValue.trim() || undefined)}
            >
              Sceller
            </Button>
          </div>
        }
      >
        <Input
          id="pv-name-input"
          label="Nom du PV"
          value={sealNameValue}
          onChange={(e) => setSealNameValue(e.target.value)}
          autoFocus
        />
      </Modal>

      {/* Suppression DÉFINITIVE d'un calcul NON scellé (menu de la ligne) —
          irréversible : confirmation forte, pas d'UI optimiste. */}
      <Modal
        open={calcToDelete !== null}
        onClose={() => {
          if (!deleting) {
            setCalcToDelete(null);
            setDeleteError(null);
          }
        }}
        title="Supprimer ce calcul ?"
        size="sm"
        footer={
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button
              variant="ghost"
              size="md"
              onClick={() => {
                setCalcToDelete(null);
                setDeleteError(null);
              }}
              disabled={deleting}
            >
              Annuler
            </Button>
            <Button
              variant="danger"
              size="md"
              loading={deleting}
              onClick={handleDeleteCalc}
            >
              Supprimer définitivement
            </Button>
          </div>
        }
      >
        <p style={{ fontSize: 13, color: 'var(--text-primary)', margin: 0 }}>
          Le calcul « {calcToDelete && displayNameOf(calcToDelete)} » sera supprimé
          définitivement. Cette action est irréversible.
        </p>
        {deleteError && (
          <div
            role="alert"
            style={{
              marginTop: 12,
              padding: '10px 12px',
              borderRadius: 8,
              border: '1px solid var(--border-default)',
              background: 'var(--surface-raised)',
              color: 'var(--text-primary)',
              fontSize: 13,
            }}
          >
            {deleteError}
          </div>
        )}
      </Modal>
    </div>
  );
}
