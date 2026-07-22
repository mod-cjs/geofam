'use client';

/**
 * B-07 / B-08 — Liste des projets + état vide + modale « Nouveau projet » (F-03)
 * États : chargement · vide · filtre sans résultat · erreur · liste
 *
 * P0 (écran 1, maquette validée 21/07/2026) — ajouts de ce lot :
 *  - recherche par nom ET description, insensible casse/accents ;
 *  - compteurs Actifs/Archivés connus SANS ouvrir la vue Archivés ;
 *  - chips de domaine (effectif, cumulatif, désactivé à zéro — jamais masqué) ;
 *  - indicateur de tri non retriable côté client (le serveur fait foi) ;
 *  - menu d'actions par ligne (⋮) : Renommer / Archiver / Supprimer définitivement ;
 *  - colonne Contenu (N calculs / N PV) ;
 *  - suppression DÉFINITIVE, distincte de l'archivage (irréversible, confirmation forte) ;
 *  - affordances d'écriture gouvernées par le rôle courant (confort d'usage
 *    UNIQUEMENT — cf. RowActionsMenu et BoutonRestaurer plus bas : la seule
 *    barrière réelle reste le RBAC serveur).
 */

import {
  Plus,
  FolderOpen,
  AlertCircle,
  RefreshCw,
  Search,
  Trash2,
  Pencil,
  MoreVertical,
  Archive,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/Button';
import { DomainTag } from '@/components/ui/DomainTag';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input, Select, Textarea } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { Skeleton } from '@/components/ui/Skeleton.client';
import { useToast } from '@/components/ui/Toast';
import {
  listArchivedProjects,
  restoreProject,
  listProjects,
  createProject,
  deleteProject,
  deleteProjectPermanently,
  renameProject,
  getStoredOrgs,
} from '@/lib/api/client';
import type { Project, ProjectDomain } from '@/lib/api/types';
import { useOrgId } from '@/lib/org-context';
import { libelleRelatif } from '@/lib/relative-day';

const DOMAINES: readonly ProjectDomain[] = ['CH', 'FD', 'LB'];
const DOMAIN_LABEL: Record<ProjectDomain, string> = {
  CH: 'Chaussées',
  FD: 'Fondations',
  LB: 'Laboratoire',
};

/**
 * Rôles autorisés à ÉCRIRE (créer/renommer/archiver/restaurer), alignés sur le
 * RBAC réel du serveur (@Roles sur ProjectsController — OWNER/ADMIN/ENGINEER,
 * hors SUPERADMIN back-office non pertinent ici).
 */
const WRITE_ROLES = new Set(['OWNER', 'ADMIN', 'ENGINEER']);
/** Suppression DÉFINITIVE : rôles plus restreints (OWNER/ADMIN uniquement — brief). */
const HARD_DELETE_ROLES = new Set(['OWNER', 'ADMIN']);

/**
 * Normalise une chaîne pour une comparaison insensible à la casse ET aux
 * accents (« Étude » doit matcher une recherche tapée « etude »).
 */
function normaliser(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * Rôle courant DANS CETTE ORGANISATION — lu depuis les claims JWT stockés au
 * login (`getStoredOrgs`, alimenté par `storeTokens`/le mock au login), PAS
 * déduit ni fabriqué côté navigateur.
 *
 * ⚠️ CE N'EST PAS UNE BARRIÈRE DE SÉCURITÉ : masquer un bouton n'autorise
 * rien, seul le RBAC serveur (@Roles) fait foi. `null` (rôle non résolu —
 * SSR, org absente des claims) est traité comme PERMISSIF par défaut : on ne
 * devine jamais un refus, un rôle réellement insuffisant se traduit par un
 * 403 serveur que l'appelant gère proprement (cf. handleHardDeleteProject).
 */
function useRoleCourant(orgSlug: string): string | null {
  const [role, setRole] = useState<string | null>(null);
  useEffect(() => {
    const orgs = getStoredOrgs() as Array<{ slug: string; role: string }>;
    setRole(orgs.find((o) => o.slug === orgSlug)?.role ?? null);
  }, [orgSlug]);
  return role;
}

/**
 * Date relative calculée côté client uniquement (useEffect après montage).
 * Le SSR retourne null → texte vide, évitant le #418 causé par Date.now() au rendu.
 */
function ClientRelativeDate({
  iso,
  kind,
}: {
  iso: string;
  kind?: 'calcul' | 'pv' | 'projet';
}) {
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    // Jours CALENDAIRES : l'ancien calcul en tranches de 24 h glissantes
    // affichait « aujourd'hui » pour un élément d'hier 23:00 consulté à 8:00.
    setLabel(libelleRelatif(new Date(iso), new Date()));
  }, [iso]);

  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;

  // Date ABSOLUE en premier : sur des pièces quasi-probatoires on raisonne en
  // dates, pas en « il y a ». Le relatif reste, en appoint.
  const absolue = d.toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const nature = kind === 'pv' ? 'PV scellé' : kind === 'calcul' ? 'calcul' : undefined;

  return (
    <span title={absolue}>
      {absolue}
      {(nature || label) && (
        <span style={{ display: 'block', color: 'var(--text-muted)', fontSize: 11 }}>
          {[nature, label].filter(Boolean).join(' · ')}
        </span>
      )}
    </span>
  );
}

interface ProjetsClientProps {
  orgSlug: string;
}

export default function ProjetsClient({ orgSlug }: ProjetsClientProps) {
  const router = useRouter();
  const { addToast } = useToast();
  const orgId = useOrgId(orgSlug);
  const role = useRoleCourant(orgSlug);
  const canWrite = role === null ? true : WRITE_ROLES.has(role);
  const canHardDelete = role === null ? true : HARD_DELETE_ROLES.has(role);

  // Actifs et archivés sont chargés ENSEMBLE, dès le premier rendu : sans
  // cela, le compteur « Archivés N » serait inconnu tant qu'on n'a pas ouvert
  // cette vue — exactement le défaut mesuré (P0-2 de ce lot).
  const [activeProjects, setActiveProjects] = useState<Project[]>([]);
  const [archivedProjects, setArchivedProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  // Formulaire nouveau projet
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newDomain, setNewDomain] = useState<ProjectDomain>('CH');
  const [newNameError, setNewNameError] = useState<string | undefined>();

  // Recherche / filtres
  const [query, setQuery] = useState('');
  const [selectedDomains, setSelectedDomains] = useState<Set<ProjectDomain>>(
    () => new Set(),
  );
  // Vue « Archivés » (P0-8) : sans elle, un projet archivé serait introuvable —
  // la modale de suppression promettrait une réversibilité inaccessible.
  const [vue, setVue] = useState<'actifs' | 'archives'>('actifs');
  const [restaurationEnCours, setRestaurationEnCours] = useState<string | null>(null);
  // Renommage en ligne (P0-7) : l'action d'ecriture la plus FREQUENTE etait
  // enterree au 4e onglet, pendant que la suppression avait deux acces directs.
  const [renommage, setRenommage] = useState<string | null>(null);

  // Suppression (archivage réversible)
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Suppression DÉFINITIVE (irréversible, distincte de l'archivage — P0-9)
  const [projectToHardDelete, setProjectToHardDelete] = useState<Project | null>(null);
  const [hardDeleteConfirmText, setHardDeleteConfirmText] = useState('');
  const [hardDeleteError, setHardDeleteError] = useState<string | null>(null);
  const [hardDeleting, setHardDeleting] = useState(false);

  function resetNewProjectForm() {
    setNewName('');
    setNewDescription('');
    setNewDomain('CH');
    setNewNameError(undefined);
  }

  const loadProjects = useCallback(async () => {
    if (!orgId) {
      setError('Organisation introuvable.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [actifs, archives] = await Promise.all([
        listProjects(orgId),
        listArchivedProjects(orgId),
      ]);
      setActiveProjects(actifs);
      setArchivedProjects(archives);
    } catch {
      setError('Impossible de charger les projets. Vérifiez votre connexion.');
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  // Liste de la vue courante — la bascule Actifs/Archivés ne redéclenche AUCUN
  // appel réseau : les deux listes sont déjà en mémoire (cf. loadProjects).
  const projects = vue === 'archives' ? archivedProjects : activeProjects;

  function resetHardDeleteState() {
    setProjectToHardDelete(null);
    setHardDeleteConfirmText('');
    setHardDeleteError(null);
  }

  async function handleRename(projet: Project, nouveau: string) {
    const nom = nouveau.trim();
    setRenommage(null);
    // Ni vide ni inchange : le backend refuserait le vide, et reecrire a
    // l'identique est une ecriture inutile qui ferait bouger updatedAt.
    if (!orgId || !nom || nom === projet.name) return;

    try {
      const maj = await renameProject(orgId, projet.id, nom);
      // Mise a jour LOCALE : pas de rechargement complet de la liste.
      setActiveProjects((prev) => prev.map((p) => (p.id === projet.id ? maj : p)));
      addToast({ type: 'success', message: `Projet renommé « ${maj.name} ».` });
    } catch {
      // AUCUNE UI optimiste : on n'a jamais affiche le nouveau nom, donc rien a
      // annuler. L'ecran ne montre que ce qui est reellement persiste.
      addToast({ type: 'error', message: 'Renommage impossible.' });
    }
  }

  async function handleRestore(projet: Project) {
    if (!orgId) return;
    setRestaurationEnCours(projet.id);
    try {
      const restaure = await restoreProject(orgId, projet.id);
      // Retiré des archivés, réinjecté dans les actifs : les DEUX compteurs
      // restent exacts sans recharger la liste complète.
      setArchivedProjects((prev) => prev.filter((p) => p.id !== projet.id));
      setActiveProjects((prev) => [restaure, ...prev]);
      addToast({ type: 'success', message: `« ${projet.name} » restauré.` });
    } catch {
      addToast({ type: 'error', message: 'Restauration impossible.' });
    } finally {
      setRestaurationEnCours(null);
    }
  }

  async function handleCreateProject(e: FormEvent) {
    e.preventDefault();
    if (!newName.trim()) {
      setNewNameError('Le nom du projet est requis');
      return;
    }
    if (!orgId) {
      addToast({ type: 'error', message: 'Organisation introuvable.' });
      return;
    }
    setCreating(true);
    try {
      const p = await createProject(orgId, {
        name: newName.trim(),
        description: newDescription.trim() || undefined,
        domain: newDomain,
      });
      // En tête de liste : cohérent avec le tri par défaut (le plus récent d'abord).
      setActiveProjects((prev) => [p, ...prev]);
      setNewProjectOpen(false);
      resetNewProjectForm();
      addToast({ type: 'success', message: `Projet "${p.name}" créé.` });
      router.push(`/app/${orgSlug}/projets/${p.id}`);
    } catch {
      addToast({ type: 'error', message: 'Erreur lors de la création du projet.' });
    } finally {
      setCreating(false);
    }
  }

  async function handleDeleteProject() {
    if (!projectToDelete || !orgId) return;
    setDeleting(true);
    try {
      const archive = await deleteProject(orgId, projectToDelete.id);
      // Retiré des actifs, réinjecté dans les archivés : les DEUX compteurs
      // restent exacts sans recharger la liste complète.
      setActiveProjects((prev) => prev.filter((p) => p.id !== projectToDelete.id));
      setArchivedProjects((prev) => [archive, ...prev]);
      addToast({
        type: 'success',
        message: `Projet "${projectToDelete.name}" archivé. Les PV scellés restent conservés.`,
      });
      setProjectToDelete(null);
    } catch {
      addToast({ type: 'error', message: 'Erreur lors de la suppression du projet.' });
    } finally {
      setDeleting(false);
    }
  }

  async function handleHardDeleteProject() {
    if (!projectToHardDelete || !orgId) return;
    // Garde-fou en plus du bouton désactivé : jamais d'appel API sur une
    // saisie qui ne correspond pas EXACTEMENT au nom du projet.
    if (hardDeleteConfirmText.trim() !== projectToHardDelete.name) return;

    setHardDeleting(true);
    setHardDeleteError(null);
    const cible = projectToHardDelete;
    try {
      await deleteProjectPermanently(orgId, cible.id);
      setActiveProjects((prev) => prev.filter((p) => p.id !== cible.id));
      setArchivedProjects((prev) => prev.filter((p) => p.id !== cible.id));
      addToast({
        type: 'success',
        message: `Projet "${cible.name}" supprimé définitivement.`,
      });
      resetHardDeleteState();
    } catch (err) {
      const statusCode = (err as { statusCode?: number } | undefined)?.statusCode;
      const message = (err as { message?: string } | undefined)?.message;
      if (statusCode === 409) {
        setHardDeleteError(
          message ??
            'Ce projet porte au moins un PV scellé : suppression définitive impossible.',
        );
      } else if (statusCode === 404) {
        setHardDeleteError(
          message ?? 'Projet introuvable — il a peut-être déjà été supprimé.',
        );
      } else if (statusCode === 403) {
        setHardDeleteError(
          message ??
            'Vous n’avez pas les droits pour supprimer définitivement ce projet.',
        );
      } else {
        addToast({
          type: 'error',
          message: 'Erreur lors de la suppression définitive du projet.',
        });
      }
    } finally {
      setHardDeleting(false);
    }
  }

  /** Ouvre la modale d'archivage à la place de la suppression définitive (repli 409). */
  function proposerArchivageALaPlace() {
    const p = projectToHardDelete;
    resetHardDeleteState();
    if (p) setProjectToDelete(p);
  }

  // Effectifs par domaine — TOUJOURS calculés sur la vue courante (actifs OU
  // archivés), indépendamment de la recherche et des chips déjà sélectionnées
  // (facette stable, pas un second filtre qui se retire lui-même).
  const domainCounts = useMemo(() => {
    const counts: Record<ProjectDomain, number> = { CH: 0, FD: 0, LB: 0 };
    for (const p of projects) {
      if (p.domain && p.domain in counts) counts[p.domain] += 1;
    }
    return counts;
  }, [projects]);

  function toggleDomain(d: ProjectDomain) {
    setSelectedDomains((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });
  }

  const visibleProjects = useMemo(() => {
    const q = normaliser(query.trim());
    let list = projects;
    if (q) {
      list = list.filter((p) => {
        const hay = normaliser(`${p.name} ${p.description ?? ''}`);
        return hay.includes(q);
      });
    }
    if (selectedDomains.size > 0) {
      list = list.filter((p) => p.domain !== null && selectedDomains.has(p.domain));
    }
    // Tri par activité : le SERVEUR fait foi (il seul connaît le dernier calcul
    // et le dernier PV). Le front ne retrie JAMAIS — il y avait jusqu'ici deux
    // vérités d'ordre, dont aucune ne reflétait l'activité réelle.
    return list;
  }, [projects, query, selectedDomains]);

  return (
    <div style={{ padding: '32px 32px', maxWidth: 1100, margin: '0 auto' }}>
      {/* En-tête de page */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 24,
          gap: 16,
        }}
      >
        <div>
          <h1
            style={{
              fontSize: 'var(--text-xl)',
              fontWeight: 600,
              color: 'var(--text-primary)',
              margin: 0,
              lineHeight: 1.2,
            }}
          >
            Mes projets
          </h1>
          <p
            style={{
              fontSize: 'var(--text-sm)',
              color: 'var(--text-secondary)',
              marginTop: 4,
            }}
          >
            {orgSlug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
          </p>
        </div>
        {/* Confort d'usage (pas une barrière de sécurité, cf. useRoleCourant) :
            un VIEWER/TECHNICIAN ne voit pas un bouton que le serveur refuserait. */}
        {canWrite && (
          <Button
            variant="action"
            size="md"
            iconLeft={<Plus size={16} strokeWidth={1.5} aria-hidden="true" />}
            onClick={() => setNewProjectOpen(true)}
          >
            Nouveau projet
          </Button>
        )}
      </div>

      {/* État chargement */}
      {loading && (
        <div
          aria-busy="true"
          aria-label="Chargement des projets"
          style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
        >
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} variant="card-projet" />
          ))}
        </div>
      )}

      {/* État erreur */}
      {!loading && error && (
        <div
          role="alert"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 12,
            padding: '48px 24px',
            textAlign: 'center',
          }}
        >
          <AlertCircle
            size={24}
            strokeWidth={1.5}
            aria-hidden="true"
            style={{ color: 'var(--status-fail-tx)' }}
          />
          <p
            style={{
              fontSize: 'var(--text-sm)',
              color: 'var(--text-secondary)',
              maxWidth: 360,
            }}
          >
            {error}
          </p>
          <Button
            variant="secondary"
            size="sm"
            iconLeft={<RefreshCw size={14} strokeWidth={1.5} aria-hidden="true" />}
            onClick={loadProjects}
          >
            Réessayer
          </Button>
        </div>
      )}

      {/* État vide (aucun projet du tout, dans CETTE vue) */}
      {!loading &&
        !error &&
        projects.length === 0 &&
        // L'état vide dépend de la VUE : proposer « Créez votre premier
        // projet » dans la vue Archivés serait un contresens (on n'y crée
        // rien), et laisserait croire que l'archivage a perdu le projet.
        (vue === 'archives' ? (
          <EmptyState
            variant="blank"
            title="Aucun projet archivé"
            description="Les projets que vous archivez apparaîtront ici, et resteront restaurables à tout moment."
          />
        ) : (
          <EmptyState
            variant="blank"
            title="Aucun projet pour le moment"
            description="Créez votre premier projet pour démarrer un calcul géotechnique ou routier."
            ctaLabel={canWrite ? 'Nouveau projet' : undefined}
            onCta={canWrite ? () => setNewProjectOpen(true) : undefined}
          />
        ))}

      {/* Barre d'outils : recherche, bascule Actifs/Archivés, chips domaine, tri */}
      {!loading &&
        !error &&
        (activeProjects.length > 0 || archivedProjects.length > 0) && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 16,
              flexWrap: 'wrap',
            }}
          >
            <div style={{ position: 'relative', flex: '1 1 240px', minWidth: 200 }}>
              <Search
                size={15}
                strokeWidth={1.5}
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  left: 10,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--text-muted)',
                  pointerEvents: 'none',
                }}
              />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filtrer par nom ou description"
                aria-label="Filtrer les projets"
                style={{
                  width: '100%',
                  padding: '8px 12px 8px 32px',
                  fontSize: 'var(--text-sm)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-lg)',
                  background: 'var(--surface-base)',
                  color: 'var(--text-primary)',
                }}
              />
            </div>

            {/* Bascule Actifs / Archivés (P0-8) — compteurs connus SANS ouvrir la
              vue (P0-2 de ce lot) : les deux listes sont chargées ensemble.
              Traitement NEUTRE : ni verdict, ni accent de statut (ADR 0008). */}
            <div
              role="group"
              aria-label="Filtrer par état"
              style={{
                display: 'inline-flex',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-lg)',
                overflow: 'hidden',
              }}
            >
              {(
                [
                  ['actifs', 'Actifs', activeProjects.length],
                  ['archives', 'Archivés', archivedProjects.length],
                ] as const
              ).map(([v, label, count]) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={vue === v}
                  onClick={() => setVue(v)}
                  style={{
                    padding: '7px 13px',
                    minHeight: 32,
                    fontSize: 'var(--text-sm)',
                    border: 0,
                    background:
                      vue === v ? 'var(--state-selected-bg)' : 'var(--surface-base)',
                    color: vue === v ? 'var(--text-primary)' : 'var(--text-secondary)',
                    fontWeight: vue === v ? 600 : 400,
                    cursor: 'pointer',
                  }}
                >
                  {label}{' '}
                  <b style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                    {count}
                  </b>
                </button>
              ))}
            </div>

            {/* Chips de domaine : cumulatifs, effectif affiché, un domaine à ZÉRO
              reste visible mais désactivé — jamais masqué en silence (cf.
              maquette « Pourquoi PressioPro n'apparaît pas »). */}
            {DOMAINES.map((d) => {
              const count = domainCounts[d];
              const pressed = selectedDomains.has(d);
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={pressed}
                  disabled={count === 0}
                  onClick={() => toggleDomain(d)}
                  style={{
                    fontSize: 'var(--text-xs)',
                    padding: '6px 10px',
                    borderRadius: 999,
                    border: `1px solid ${pressed ? 'var(--border-focus)' : 'var(--border-subtle)'}`,
                    background: pressed
                      ? 'var(--state-selected-bg)'
                      : 'var(--surface-base)',
                    color: pressed ? 'var(--text-primary)' : 'var(--text-secondary)',
                    fontWeight: pressed ? 600 : 400,
                    cursor: count === 0 ? 'not-allowed' : 'pointer',
                    opacity: count === 0 ? 0.45 : 1,
                  }}
                >
                  {DOMAIN_LABEL[d]}{' '}
                  <b style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                    {count}
                  </b>
                </button>
              );
            })}

            <div style={{ flex: 1 }} />

            {/* Indicateur de tri — NON interactif : le serveur trie déjà par
              dernière activité décroissante ; un basculeur client ne pourrait
              proposer que des ordres que le serveur sait rendre, et il n'y en
              a qu'un aujourd'hui. Cf. incident passé : deux vérités d'ordre
              (front/serveur), aucune ne reflétant l'activité réelle. */}
            <span
              role="status"
              aria-label="Trié par dernière activité, décroissant"
              style={{
                fontSize: 'var(--text-xs)',
                padding: '6px 10px',
                borderRadius: 999,
                border: '1px solid var(--border-focus)',
                background: 'var(--state-selected-bg)',
                color: 'var(--text-primary)',
                fontWeight: 500,
                whiteSpace: 'nowrap',
              }}
            >
              Dernière activité ↓
            </span>
          </div>
        )}

      {/* Filtre sans résultat */}
      {!loading && !error && projects.length > 0 && visibleProjects.length === 0 && (
        <EmptyState
          variant="blank"
          title="Aucun projet ne correspond"
          description={
            query.trim()
              ? `Aucun projet ne correspond à « ${query} ».`
              : 'Aucun projet ne correspond aux filtres sélectionnés.'
          }
          ctaLabel="Réinitialiser les filtres"
          onCta={() => {
            setQuery('');
            setSelectedDomains(new Set());
          }}
        />
      )}

      {/* Liste des projets */}
      {!loading && !error && visibleProjects.length > 0 && (
        <div
          role="list"
          aria-label="Liste des projets"
          style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
        >
          {visibleProjects.map((project) => (
            <ProjectRow
              key={project.id}
              project={project}
              canWrite={canWrite}
              canHardDelete={canHardDelete}
              onClick={() => router.push(`/app/${orgSlug}/projets/${project.id}`)}
              onArchiveRequest={() => setProjectToDelete(project)}
              onHardDeleteRequest={() => setProjectToHardDelete(project)}
              enRenommage={renommage === project.id}
              onStartRename={() => setRenommage(project.id)}
              onRename={(nom) => handleRename(project, nom)}
              onCancelRename={() => setRenommage(null)}
              archive={vue === 'archives'}
              onRestore={() => handleRestore(project)}
              restauration={restaurationEnCours === project.id}
            />
          ))}
        </div>
      )}

      {/* Modale nouveau projet */}
      <Modal
        open={newProjectOpen}
        onClose={() => {
          if (!creating) {
            setNewProjectOpen(false);
            resetNewProjectForm();
          }
        }}
        title="Nouveau projet"
        size="sm"
        footer={
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button
              variant="ghost"
              size="md"
              onClick={() => {
                setNewProjectOpen(false);
                resetNewProjectForm();
              }}
              disabled={creating}
            >
              Annuler
            </Button>
            <Button
              variant="action"
              size="md"
              loading={creating}
              onClick={handleCreateProject as unknown as React.MouseEventHandler}
            >
              Créer le projet
            </Button>
          </div>
        }
      >
        <form id="new-project-form" onSubmit={handleCreateProject} noValidate>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Input
              id="new-project-name"
              label="Nom du projet"
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value);
                setNewNameError(undefined);
              }}
              onBlur={() => {
                if (!newName.trim()) setNewNameError('Le nom est requis');
              }}
              error={newNameError}
              placeholder="ex. RN2 PK45 — Réhabilitation"
              required
              autoFocus
            />
            <Select
              id="new-project-domain"
              label="Domaine"
              value={newDomain}
              onChange={(e) => setNewDomain(e.target.value as ProjectDomain)}
            >
              <option value="CH">Chaussées</option>
              <option value="FD">Fondations</option>
              <option value="LB">Labo / Sol</option>
            </Select>
            <Textarea
              id="new-project-desc"
              label="Description (optionnelle)"
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              placeholder="Contexte, localisation, référence…"
              rows={3}
            />
          </div>
        </form>
      </Modal>

      {/* Modale confirmation archivage (réversible) */}
      <Modal
        open={projectToDelete !== null}
        onClose={() => {
          if (!deleting) setProjectToDelete(null);
        }}
        title="Archiver le projet ?"
        size="sm"
        footer={
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button
              variant="ghost"
              size="md"
              onClick={() => setProjectToDelete(null)}
              disabled={deleting}
            >
              Annuler
            </Button>
            <Button
              variant="danger"
              size="md"
              loading={deleting}
              onClick={handleDeleteProject}
            >
              Archiver le projet
            </Button>
          </div>
        }
      >
        <p
          style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)', margin: 0 }}
        >
          Le projet « {projectToDelete?.name} » sera retiré de la liste des projets
          actifs.
        </p>
        <p
          style={{
            fontSize: 'var(--text-sm)',
            color: 'var(--text-secondary)',
            marginTop: 8,
          }}
        >
          Il s&apos;agit d&apos;un archivage : les calculs et PV scellés déjà émis restent
          conservés et ne sont pas supprimés. Le projet reste listé dans la vue « Archivés
          », d&apos;où vous pourrez le restaurer vous-même à tout moment.
        </p>
      </Modal>

      {/* Modale confirmation suppression DÉFINITIVE (irréversible, P0-9) —
          DISTINCTE de l'archivage ci-dessus : saisie du nom du projet exigée,
          patron usuel pour une destruction irréversible. */}
      <Modal
        open={projectToHardDelete !== null}
        onClose={() => {
          if (!hardDeleting) resetHardDeleteState();
        }}
        title="Supprimer définitivement le projet ?"
        size="sm"
        footer={
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button
              variant="ghost"
              size="md"
              onClick={resetHardDeleteState}
              disabled={hardDeleting}
            >
              Annuler
            </Button>
            <Button
              variant="danger"
              size="md"
              loading={hardDeleting}
              disabled={
                !!hardDeleteError ||
                !projectToHardDelete ||
                hardDeleteConfirmText.trim() !== projectToHardDelete.name
              }
              onClick={handleHardDeleteProject}
            >
              Supprimer définitivement
            </Button>
          </div>
        }
      >
        <p
          style={{
            fontSize: 'var(--text-sm)',
            color: 'var(--text-primary)',
            margin: 0,
            fontWeight: 600,
          }}
        >
          Cette action est IRRÉVERSIBLE.
        </p>
        <p
          style={{
            fontSize: 'var(--text-sm)',
            color: 'var(--text-secondary)',
            marginTop: 8,
          }}
        >
          Le projet « {projectToHardDelete?.name} », ses calculs et les documents associés
          seront supprimés définitivement — aucune restauration ne sera possible, à la
          différence de l&apos;archivage.
        </p>

        {hardDeleteError ? (
          <div
            role="alert"
            style={{
              marginTop: 12,
              padding: '10px 12px',
              borderRadius: 'var(--radius-base)',
              border: '1px solid var(--border-default)',
              background: 'var(--surface-raised)',
              color: 'var(--text-primary)',
              fontSize: 'var(--text-sm)',
            }}
          >
            {hardDeleteError}
            {/pv\s*scell/i.test(hardDeleteError) && (
              <div style={{ marginTop: 8 }}>
                <Button variant="secondary" size="sm" onClick={proposerArchivageALaPlace}>
                  Archiver à la place
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div style={{ marginTop: 12 }}>
            <Input
              id="hard-delete-confirm"
              label={`Saisissez « ${projectToHardDelete?.name ?? ''} » pour confirmer`}
              value={hardDeleteConfirmText}
              onChange={(e) => setHardDeleteConfirmText(e.target.value)}
              placeholder={projectToHardDelete?.name}
              autoFocus
            />
          </div>
        )}
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Menu d'actions par ligne (⋮) — Renommer / Archiver / Supprimer définitivement
// ---------------------------------------------------------------------------

function RowActionsMenu({
  project,
  canWrite,
  canHardDelete,
  onRename,
  onArchive,
  onHardDelete,
  archive = false,
}: {
  project: Project;
  canWrite: boolean;
  canHardDelete: boolean;
  onRename: () => void;
  onArchive: () => void;
  onHardDelete: () => void;
  /**
   * Vue « Archivés » : Renommer/Archiver n'ont aucun sens sur une ligne déjà
   * archivée (non proposés) ; seule « Supprimer définitivement » reste,
   * gatée sur canHardDelete — cas d'usage PRINCIPAL côté serveur (on archive
   * pour se débarrasser, puis on vide la corbeille).
   */
  archive?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onDocKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        btnRef.current?.focus();
      }
    }
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onDocKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onDocKeyDown);
    };
  }, [open]);

  // Confort d'usage UNIQUEMENT (cf. useRoleCourant) : sans AUCUNE action
  // à proposer, pas de menu du tout plutôt qu'un menu vide. En vue Archivés,
  // seule canHardDelete gouverne (Renommer/Archiver n'existent pas ici).
  if (archive ? !canHardDelete : !canWrite && !canHardDelete) return null;

  const menuItemStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    textAlign: 'left',
    padding: '8px 10px',
    border: 0,
    background: 'none',
    fontSize: 'var(--text-sm)',
    color: 'var(--text-primary)',
    borderRadius: 'var(--radius-base)',
    cursor: 'pointer',
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        ref={btnRef}
        type="button"
        aria-label={`Actions sur le projet ${project.name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        style={{
          display: 'inline-grid',
          placeItems: 'center',
          width: 28,
          height: 28,
          border: 0,
          borderRadius: 'var(--radius-base)',
          background: 'none',
          color: 'var(--text-muted)',
          cursor: 'pointer',
        }}
      >
        <MoreVertical size={16} strokeWidth={1.5} aria-hidden="true" />
      </button>
      {open && (
        <div
          role="menu"
          aria-label={`Actions sur le projet ${project.name}`}
          style={{
            position: 'absolute',
            right: 0,
            top: 'calc(100% + 4px)',
            zIndex: 5,
            minWidth: 210,
            background: 'var(--surface-overlay)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-lg)',
            padding: 5,
            boxShadow: 'var(--elevation-popover)',
          }}
        >
          {!archive && canWrite && (
            <button
              type="button"
              role="menuitem"
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                onRename();
              }}
              style={menuItemStyle}
            >
              <Pencil size={13} strokeWidth={1.5} aria-hidden="true" />
              Renommer
            </button>
          )}
          {!archive && canWrite && (
            <button
              type="button"
              role="menuitem"
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                onArchive();
              }}
              style={menuItemStyle}
            >
              <Archive size={13} strokeWidth={1.5} aria-hidden="true" />
              Archiver
            </button>
          )}
          {!archive && canWrite && canHardDelete && (
            <hr
              style={{
                border: 0,
                borderTop: '1px solid var(--border-subtle)',
                margin: '5px 2px',
              }}
            />
          )}
          {canHardDelete && (
            <button
              type="button"
              role="menuitem"
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                onHardDelete();
              }}
              style={menuItemStyle}
            >
              <Trash2 size={13} strokeWidth={1.5} aria-hidden="true" />
              Supprimer définitivement
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Colonne « Contenu » — N calculs / N PV (PV omis si 0)
// ---------------------------------------------------------------------------

function badgeStyle(): React.CSSProperties {
  return {
    fontFamily: 'var(--font-mono)',
    fontSize: 11,
    color: 'var(--text-secondary)',
    border: '1px solid var(--border-subtle)',
    borderRadius: 999,
    padding: '3px 8px',
    whiteSpace: 'nowrap',
  };
}

function ContentBadges({ project }: { project: Project }) {
  // Compteur pas encore connu (backend antérieur / mock sans compteurs) :
  // aucune pastille plutôt qu'un « 0 » trompeur (cf. types.ts — calcCount).
  if (project.calcCount === undefined) return null;
  return (
    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', flexShrink: 0 }}>
      <span style={badgeStyle()}>
        <b style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
          {project.calcCount}
        </b>{' '}
        calcul{project.calcCount === 1 ? '' : 's'}
      </span>
      {typeof project.pvCount === 'number' && project.pvCount > 0 && (
        <span style={badgeStyle()}>
          <b style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
            {project.pvCount}
          </b>{' '}
          PV
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ligne de projet
// ---------------------------------------------------------------------------

function ProjectRow({
  project,
  canWrite,
  canHardDelete,
  onClick,
  onArchiveRequest,
  onHardDeleteRequest,
  enRenommage = false,
  onStartRename,
  onRename,
  onCancelRename,
  archive = false,
  onRestore,
  restauration = false,
}: {
  project: Project;
  canWrite: boolean;
  canHardDelete: boolean;
  onClick: () => void;
  onArchiveRequest: () => void;
  onHardDeleteRequest: () => void;
  /** Renommage en ligne (P0-7). */
  enRenommage?: boolean;
  onStartRename?: () => void;
  onRename?: (nom: string) => void;
  onCancelRename?: () => void;
  /** Vue « Archivés » : le menu cède la place au bouton Restaurer. */
  archive?: boolean;
  onRestore?: () => void;
  restauration?: boolean;
}) {
  const rowRef = useRef<HTMLDivElement>(null);

  function handleKeyDown(e: React.KeyboardEvent) {
    // Ignorer si la touche vient d'un enfant interactif (ex. bouton Supprimer) :
    // seul le focus sur la ligne elle-même déclenche la navigation clavier.
    if (e.target !== rowRef.current) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick();
    }
  }

  return (
    <div
      ref={rowRef}
      role="listitem"
      tabIndex={archive ? -1 : 0}
      onClick={archive ? undefined : onClick}
      onKeyDown={archive ? undefined : handleKeyDown}
      aria-label={`Projet ${project.name}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: '14px 16px',
        background: 'var(--surface-base)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--elevation-card)',
        cursor: archive ? 'default' : 'pointer',
        transition: `background var(--dur-fast) var(--ease-state)`,
        outline: 'none',
      }}
      onMouseOver={(e) => {
        (e.currentTarget as HTMLElement).style.background = 'var(--row-hover-bg)';
      }}
      onMouseOut={(e) => {
        (e.currentTarget as HTMLElement).style.background = 'var(--surface-base)';
      }}
      onFocus={(e) => {
        (e.currentTarget as HTMLElement).style.boxShadow =
          '0 0 0 2px var(--border-focus)';
      }}
      onBlur={(e) => {
        (e.currentTarget as HTMLElement).style.boxShadow = 'var(--elevation-card)';
      }}
    >
      <FolderOpen
        size={20}
        strokeWidth={1.5}
        aria-hidden="true"
        style={{ color: 'var(--text-muted)', flexShrink: 0 }}
      />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 'var(--text-sm)',
            fontWeight: 500,
            color: 'var(--text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {enRenommage && onRename ? (
            <input
              autoFocus
              defaultValue={project.name}
              aria-label={`Renommer le projet ${project.name}`}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') onRename(e.currentTarget.value);
                // Échap annule SANS écrire : une sortie sûre est obligatoire
                // sur un champ qui s'ouvre au clic.
                if (e.key === 'Escape') onCancelRename?.();
              }}
              onBlur={(e) => onRename(e.currentTarget.value)}
              style={{
                width: '100%',
                font: 'inherit',
                color: 'var(--text-primary)',
                background: 'var(--surface-base)',
                border: '1px solid var(--border-focus)',
                borderRadius: 'var(--radius-base)',
                padding: '2px 6px',
              }}
            />
          ) : (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {project.name}
              {onStartRename && !archive && canWrite && (
                <button
                  type="button"
                  aria-label={`Renommer le projet ${project.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onStartRename();
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
                  <Pencil size={13} strokeWidth={1.5} aria-hidden="true" />
                </button>
              )}
            </span>
          )}
        </div>
        {/* Ligne de description — toujours rendue (P0-7) : la description est
            désormais persistée ; « Aucune description. » atténué signale un
            champ CONNU et vide, pas un champ jamais rempli en silence. */}
        <div
          style={{
            fontSize: 'var(--text-xs)',
            color: 'var(--text-secondary)',
            marginTop: 2,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {project.description ? (
            project.description
          ) : (
            <span style={{ opacity: 0.6 }}>Aucune description.</span>
          )}
        </div>
      </div>

      <DomainTag domain={project.domain} />

      <div
        style={{
          fontSize: 'var(--text-xs)',
          color: 'var(--text-muted)',
          fontFamily: 'var(--font-mono)',
          fontVariantNumeric: 'tabular-nums',
          flexShrink: 0,
          minWidth: 80,
          textAlign: 'right',
        }}
      >
        <ClientRelativeDate
          iso={project.lastActivityAt ?? project.updatedAt}
          kind={project.lastActivityKind}
        />
      </div>

      <ContentBadges project={project} />

      {archive ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {canWrite && onRestore && (
            <BoutonRestaurer
              onRestore={onRestore}
              enCours={restauration}
              nom={project.name}
            />
          )}
          {/* Suppression définitive proposée aussi en vue Archivés — cas
              d'usage PRINCIPAL côté serveur (on archive pour se débarrasser,
              puis on vide la corbeille). Renommer/Archiver n'ont pas de sens
              ici (archive=true les masque dans RowActionsMenu). */}
          <RowActionsMenu
            project={project}
            canWrite={canWrite}
            canHardDelete={canHardDelete}
            onRename={() => onStartRename?.()}
            onArchive={onArchiveRequest}
            onHardDelete={onHardDeleteRequest}
            archive
          />
        </div>
      ) : (
        <RowActionsMenu
          project={project}
          canWrite={canWrite}
          canHardDelete={canHardDelete}
          onRename={() => onStartRename?.()}
          onArchive={onArchiveRequest}
          onHardDelete={onHardDeleteRequest}
        />
      )}
    </div>
  );
}

/**
 * Bouton de restauration (P0-8) — rend vraie la réversibilité promise par la
 * modale d'archivage. Traitement NEUTRE : restaurer n'est ni un verdict ni
 * une action destructive (ADR 0008 — ni vert, ni rouge, ni accent de statut).
 */
function BoutonRestaurer({
  onRestore,
  enCours,
  nom,
}: {
  onRestore: () => void;
  enCours: boolean;
  nom: string;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onRestore();
      }}
      disabled={enCours}
      aria-label={`Restaurer le projet ${nom}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 11px',
        minHeight: 30,
        fontSize: 'var(--text-sm)',
        borderRadius: 'var(--radius-base)',
        border: '1px solid var(--border-default)',
        background: 'var(--surface-base)',
        color: 'var(--text-primary)',
        cursor: enCours ? 'progress' : 'pointer',
        opacity: enCours ? 0.6 : 1,
        flexShrink: 0,
      }}
    >
      <RefreshCw size={14} strokeWidth={1.5} aria-hidden="true" />
      {enCours ? 'Restauration…' : 'Restaurer'}
    </button>
  );
}
