'use client';

/**
 * B-07 / B-08 — Liste des projets + état vide + modale « Nouveau projet » (F-03)
 * États : chargement · vide · filtre sans résultat · erreur · liste
 */

import { Plus, FolderOpen, AlertCircle, RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/Button';
import { DomainTag } from '@/components/ui/DomainTag';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input, Select, Textarea } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { Skeleton } from '@/components/ui/Skeleton.client';
import { useToast } from '@/components/ui/Toast';
import { listProjects, createProject } from '@/lib/api/client';
import type { Project, ProjectDomain } from '@/lib/api/types';
import { useOrgId } from '@/lib/org-context';

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
      setProjects((prev) => [...prev, p]);
      setNewProjectOpen(false);
      setNewName('');
      setNewDescription('');
      setNewDomain('CH');
      addToast({ type: 'success', message: `Projet "${p.name}" créé.` });
      router.push(`/app/${orgSlug}/projets/${p.id}`);
    } catch {
      addToast({ type: 'error', message: 'Erreur lors de la création du projet.' });
    } finally {
      setCreating(false);
    }
  }

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

      {/* État vide */}
      {!loading && !error && projects.length === 0 && (
        <EmptyState
          variant="blank"
          title="Aucun projet pour le moment"
          description="Créez votre premier projet pour démarrer un calcul géotechnique ou routier."
          ctaLabel="Nouveau projet"
          onCta={() => setNewProjectOpen(true)}
        />
      )}

      {/* Liste des projets */}
      {!loading && !error && projects.length > 0 && (
        <div
          role="list"
          aria-label="Liste des projets"
          style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
        >
          {projects.map((project) => (
            <ProjectRow
              key={project.id}
              project={project}
              onClick={() => router.push(`/app/${orgSlug}/projets/${project.id}`)}
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
            setNewName('');
            setNewDescription('');
            setNewNameError(undefined);
          }
        }}
        title="Nouveau projet"
        size="sm"
        footer={
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button
              variant="ghost"
              size="md"
              onClick={() => setNewProjectOpen(false)}
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
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ligne de projet
// ---------------------------------------------------------------------------

function ProjectRow({ project, onClick }: { project: Project; onClick: () => void }) {
  const rowRef = useRef<HTMLDivElement>(null);

  function handleKeyDown(e: React.KeyboardEvent) {
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
    </div>
  );
}
