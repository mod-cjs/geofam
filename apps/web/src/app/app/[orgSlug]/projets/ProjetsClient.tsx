'use client';

/**
 * B-07 / B-08 — Liste des projets + état vide + modale « Nouveau projet » (F-03)
 * États : chargement · vide · filtre sans résultat · erreur · liste
 */

import {
  Plus,
  FolderOpen,
  AlertCircle,
  RefreshCw,
  Search,
  Trash2,
  Pencil,
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
  renameProject,
} from '@/lib/api/client';
import type { Project, ProjectDomain } from '@/lib/api/types';
import { useOrgId } from '@/lib/org-context';
import { libelleRelatif } from '@/lib/relative-day';

type SortKey = 'date-desc' | 'name-asc';

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

  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  // Formulaire nouveau projet
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newDomain, setNewDomain] = useState<ProjectDomain>('CH');
  const [newNameError, setNewNameError] = useState<string | undefined>();

  // Recherche / tri
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('date-desc');
  // Vue « Archivés » (P0-8) : sans elle, un projet archivé serait introuvable —
  // la modale de suppression promettrait une réversibilité inaccessible.
  const [vue, setVue] = useState<'actifs' | 'archives'>('actifs');
  const [restaurationEnCours, setRestaurationEnCours] = useState<string | null>(null);
  // Renommage en ligne (P0-7) : l'action d'ecriture la plus FREQUENTE etait
  // enterree au 4e onglet, pendant que la suppression avait deux acces directs.
  const [renommage, setRenommage] = useState<string | null>(null);

  // Suppression (soft-delete)
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState(false);

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
      const data =
        vue === 'archives'
          ? await listArchivedProjects(orgId)
          : await listProjects(orgId);
      setProjects(data);
    } catch {
      setError('Impossible de charger les projets. Vérifiez votre connexion.');
    } finally {
      setLoading(false);
    }
  }, [orgId, vue]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  async function handleRename(projet: Project, nouveau: string) {
    const nom = nouveau.trim();
    setRenommage(null);
    // Ni vide ni inchange : le backend refuserait le vide, et reecrire a
    // l'identique est une ecriture inutile qui ferait bouger updatedAt.
    if (!orgId || !nom || nom === projet.name) return;

    try {
      const maj = await renameProject(orgId, projet.id, nom);
      // Mise a jour LOCALE : pas de rechargement complet de la liste.
      setProjects((prev) => prev.map((p) => (p.id === projet.id ? maj : p)));
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
      await restoreProject(orgId, projet.id);
      // Le projet quitte la vue « Archivés » : on le retire localement plutôt
      // que de tout recharger — le retour serveur fait déjà foi.
      setProjects((prev) => prev.filter((p) => p.id !== projet.id));
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
      setProjects((prev) => [p, ...prev]);
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
      await deleteProject(orgId, projectToDelete.id);
      setProjects((prev) => prev.filter((p) => p.id !== projectToDelete.id));
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

  const visibleProjects = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? projects.filter((p) => p.name.toLowerCase().includes(q))
      : projects;
    const sorted = [...filtered];
    if (sortKey === 'name-asc') {
      sorted.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
      return sorted;
    }
    // Tri par activité : le SERVEUR fait foi (il seul connaît le dernier calcul
    // et le dernier PV). Le front ne retrie plus — il y avait jusqu'ici deux
    // vérités d'ordre, dont aucune ne reflétait l'activité réelle : le serveur
    // triait sur createdAt, le front retriait sur updatedAt.
    return sorted;
  }, [projects, query, sortKey]);

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
        <Button
          variant="action"
          size="md"
          iconLeft={<Plus size={16} strokeWidth={1.5} aria-hidden="true" />}
          onClick={() => setNewProjectOpen(true)}
        >
          Nouveau projet
        </Button>
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

      {/* État vide (aucun projet du tout) */}
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
            ctaLabel="Nouveau projet"
            onCta={() => setNewProjectOpen(true)}
          />
        ))}

      {/* Barre recherche + tri */}
      {!loading && !error && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
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
              placeholder="Rechercher un projet…"
              aria-label="Rechercher un projet par nom"
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
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            aria-label="Trier les projets"
            style={{
              padding: '8px 12px',
              fontSize: 'var(--text-sm)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-lg)',
              background: 'var(--surface-base)',
              color: 'var(--text-primary)',
            }}
          >
            <option value="date-desc">Dernière activité</option>
            <option value="name-asc">Nom (A → Z)</option>
          </select>

          {/* Bascule Actifs / Archivés (P0-8). Sans ce point d'entrée, un projet
              archivé serait introuvable et la réversibilité promise par la
              modale de suppression resterait inaccessible. Traitement NEUTRE :
              ni verdict, ni accent de statut (ADR 0008). */}
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
            {(['actifs', 'archives'] as const).map((v) => (
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
                {v === 'actifs' ? 'Actifs' : 'Archivés'}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Filtre sans résultat */}
      {!loading && !error && projects.length > 0 && visibleProjects.length === 0 && (
        <EmptyState
          variant="blank"
          title="Aucun projet ne correspond"
          description={`Aucun projet ne correspond à « ${query} ».`}
          ctaLabel="Réinitialiser la recherche"
          onCta={() => setQuery('')}
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
              onClick={() => router.push(`/app/${orgSlug}/projets/${project.id}`)}
              onDelete={() => setProjectToDelete(project)}
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

      {/* Modale confirmation suppression (soft-delete / archivage) */}
      <Modal
        open={projectToDelete !== null}
        onClose={() => {
          if (!deleting) setProjectToDelete(null);
        }}
        title="Supprimer le projet ?"
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
              Supprimer le projet
            </Button>
          </div>
        }
      >
        <p
          style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)', margin: 0 }}
        >
          Le projet « {projectToDelete?.name} » sera retiré de la liste des projets.
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
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ligne de projet
// ---------------------------------------------------------------------------

function ProjectRow({
  project,
  onClick,
  onDelete,
  enRenommage = false,
  onStartRename,
  onRename,
  onCancelRename,
  archive = false,
  onRestore,
  restauration = false,
}: {
  project: Project;
  onClick: () => void;
  onDelete: () => void;
  /** Renommage en ligne (P0-7). */
  enRenommage?: boolean;
  onStartRename?: () => void;
  onRename?: (nom: string) => void;
  onCancelRename?: () => void;
  /** Vue « Archivés » : la corbeille cède la place au bouton Restaurer. */
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
              {onStartRename && !archive && (
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
        {project.description && (
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
            {project.description}
          </div>
        )}
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

      {archive && onRestore ? (
        <BoutonRestaurer
          onRestore={onRestore}
          enCours={restauration}
          nom={project.name}
        />
      ) : (
        <button
          type="button"
          aria-label={`Supprimer le projet ${project.name}`}
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'none',
            border: 'none',
            borderRadius: 'var(--radius-base)',
            padding: 6,
            cursor: 'pointer',
            color: 'var(--text-muted)',
            flexShrink: 0,
          }}
          onMouseOver={(e) => {
            (e.currentTarget as HTMLElement).style.color = 'var(--status-fail-tx)';
          }}
          onMouseOut={(e) => {
            (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)';
          }}
        >
          <Trash2 size={16} strokeWidth={1.5} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

/**
 * Bouton de restauration (P0-8) — rend vraie la réversibilité promise par la
 * modale de suppression. Traitement NEUTRE : restaurer n'est ni un verdict ni
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
