'use client';

/**
 * B-07 / B-08 — Liste des projets + état vide + modale « Nouveau projet » (F-03)
 * États : chargement · vide · filtre sans résultat · erreur · liste
 */

import { Plus, FolderOpen, AlertCircle, RefreshCw, Search, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/Button';
import { DomainTag } from '@/components/ui/DomainTag';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input, Select, Textarea } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { Skeleton } from '@/components/ui/Skeleton.client';
import { useToast } from '@/components/ui/Toast';
import { listProjects, createProject, deleteProject } from '@/lib/api/client';
import type { Project, ProjectDomain } from '@/lib/api/types';
import { useOrgId } from '@/lib/org-context';

type SortKey = 'date-desc' | 'name-asc';

/**
 * Date relative calculée côté client uniquement (useEffect après montage).
 * Le SSR retourne null → texte vide, évitant le #418 causé par Date.now() au rendu.
 */
function ClientRelativeDate({ iso }: { iso: string }) {
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    const diff = Date.now() - new Date(iso).getTime();
    const d = Math.floor(diff / 86400000);
    setLabel(d === 0 ? "aujourd'hui" : d === 1 ? 'hier' : `il y a ${d} j`);
  }, [iso]);
  if (label === null) return null;
  return <>{label}</>;
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
      const data = await listProjects(orgId);
      setProjects(data);
    } catch {
      setError('Impossible de charger les projets. Vérifiez votre connexion.');
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

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
    } else {
      sorted.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    }
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
      {!loading && !error && projects.length === 0 && (
        <EmptyState
          variant="blank"
          title="Aucun projet pour le moment"
          description="Créez votre premier projet pour démarrer un calcul géotechnique ou routier."
          ctaLabel="Nouveau projet"
          onCta={() => setNewProjectOpen(true)}
        />
      )}

      {/* Barre recherche + tri */}
      {!loading && !error && projects.length > 0 && (
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
            <option value="date-desc">Modifié récemment</option>
            <option value="name-asc">Nom (A → Z)</option>
          </select>
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
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)', margin: 0 }}>
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
          conservés et ne sont pas supprimés. Cette action peut être annulée par un
          administrateur si besoin.
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
}: {
  project: Project;
  onClick: () => void;
  onDelete: () => void;
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
      tabIndex={0}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      aria-label={`Projet ${project.name}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: '14px 16px',
        background: 'var(--surface-base)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--elevation-card)',
        cursor: 'pointer',
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
          {project.name}
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
        <ClientRelativeDate iso={project.updatedAt} />
      </div>

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
    </div>
  );
}
