'use client';

/**
 * B-35 — Onglet Informations projet
 * Renommage (optimistic) + métadonnées en lecture.
 */

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { Skeleton } from '@/components/ui/Skeleton.client';
import { useToast } from '@/components/ui/Toast';
import { getProject, renameProject, deleteProject } from '@/lib/api/client';
import type { Project } from '@/lib/api/types';
import { useOrgId } from '@/lib/org-context';

interface Props {
  params: Promise<{ orgSlug: string; projetId: string }>;
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Africa/Dakar',
  })
    .format(new Date(iso))
    .replace(/[\u202F\u00A0]/g, ' '); // espace ICU déterministe (anti #418)
}

export default function InfosPage({ params: paramsPromise }: Props) {
  const router = useRouter();
  const { addToast } = useToast();
  const [orgSlug, setOrgSlug] = useState('');
  const [projetId, setProjetId] = useState('');
  // useOrgId résout le slug après montage (mode réel) ou immédiatement (mock).
  const orgId = useOrgId(orgSlug);
  // Rendu client-only : évite le mismatch d'hydratation (#418).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Étape 1 : extraire les paramètres de route depuis la Promise.
  useEffect(() => {
    paramsPromise.then(({ orgSlug: s, projetId: p }) => {
      setOrgSlug(s);
      setProjetId(p);
    });
  }, [paramsPromise]);

  // Étape 2 : charger le projet une fois orgId résolu.
  useEffect(() => {
    if (!orgId || !projetId) return;
    getProject(orgId, projetId)
      .then((p) => {
        setProject(p);
        setName(p.name);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [orgId, projetId]);

  async function handleSave() {
    if (!project || !name.trim() || !orgId) return;
    setSaving(true);
    // Optimistic UI
    const prev = project.name;
    const trimmed = name.trim();
    setProject({ ...project, name: trimmed });
    try {
      // PATCH /projects/:id — persiste réellement côté serveur (plus de faux succès).
      const updated = await renameProject(orgId, project.id, trimmed);
      setProject(updated);
      setName(updated.name);
      addToast({ type: 'success', message: 'Projet renommé.' });
    } catch {
      // Rollback : le renommage n'a pas persisté, on revient à l'état précédent.
      setProject({ ...project, name: prev });
      setName(prev);
      addToast({
        type: 'error',
        message: 'Erreur lors de la sauvegarde. Le projet n’a pas été renommé.',
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!project || !orgId) return;
    setDeleting(true);
    try {
      await deleteProject(orgId, project.id);
      addToast({
        type: 'success',
        message: `Projet "${project.name}" archivé. Les PV scellés restent conservés.`,
      });
      router.push(`/app/${orgSlug}/projets`);
    } catch {
      addToast({ type: 'error', message: 'Erreur lors de la suppression du projet.' });
      setDeleting(false);
      setDeleteOpen(false);
    }
  }

  if (!mounted) {
    return <div style={{ padding: 24 }} aria-busy="true" />;
  }

  if (loading) {
    return (
      <div style={{ padding: 24 }} aria-busy="true">
        <Skeleton variant="text" style={{ width: 200, marginBottom: 16 }} />
        <Skeleton variant="row" />
      </div>
    );
  }

  if (!project) {
    return (
      <div style={{ padding: 24, color: 'var(--text-secondary)' }}>
        Projet introuvable.
      </div>
    );
  }

  return (
    <div style={{ padding: 24, maxWidth: 560, margin: '0 auto', width: '100%' }}>
      <h2
        style={{
          fontSize: 'var(--text-lg)',
          fontWeight: 600,
          color: 'var(--text-primary)',
          marginBottom: 24,
        }}
      >
        Informations du projet
      </h2>

      {/* Renommage */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Input
          id="project-name"
          label="Nom du projet"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />

        <div style={{ display: 'flex', gap: 8 }}>
          <Button
            variant="action"
            size="md"
            loading={saving}
            disabled={name === project.name || !name.trim()}
            onClick={handleSave}
          >
            Enregistrer
          </Button>
          <Button
            variant="ghost"
            size="md"
            onClick={() => setName(project.name)}
            disabled={name === project.name}
          >
            Annuler
          </Button>
        </div>
      </div>

      {/* Métadonnées */}
      <div
        style={{
          marginTop: 32,
          padding: 16,
          background: 'var(--surface-canvas)',
          borderRadius: 'var(--radius-lg)',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <MetaRow label="Identifiant" value={project.id} mono />
        <MetaRow
          label="Domaine"
          value={
            project.domain
              ? ({ CH: 'Chaussées', FD: 'Fondations', LB: 'Labo / Sol' }[
                  project.domain
                ] ?? project.domain)
              : 'Non renseigné'
          }
        />
        <MetaRow label="Créé le" value={formatDate(project.createdAt)} />
        <MetaRow label="Modifié le" value={formatDate(project.updatedAt)} />
      </div>

      {/* Zone dangereuse — suppression (archivage) */}
      <div
        style={{
          marginTop: 32,
          padding: 16,
          border: '1px solid var(--status-fail-tx)',
          borderRadius: 'var(--radius-lg)',
        }}
      >
        <h3
          style={{
            fontSize: 'var(--text-sm)',
            fontWeight: 600,
            color: 'var(--text-primary)',
            margin: '0 0 4px',
          }}
        >
          Supprimer ce projet
        </h3>
        <p
          style={{
            fontSize: 'var(--text-xs)',
            color: 'var(--text-secondary)',
            margin: '0 0 12px',
          }}
        >
          Archive le projet — il disparaît de la liste. Les calculs et PV scellés déjà
          émis restent conservés.
        </p>
        <Button variant="danger" size="sm" onClick={() => setDeleteOpen(true)}>
          Supprimer le projet
        </Button>
      </div>

      {/* Modale confirmation suppression */}
      <Modal
        open={deleteOpen}
        onClose={() => {
          if (!deleting) setDeleteOpen(false);
        }}
        title="Supprimer le projet ?"
        size="sm"
        footer={
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button
              variant="ghost"
              size="md"
              onClick={() => setDeleteOpen(false)}
              disabled={deleting}
            >
              Annuler
            </Button>
            <Button variant="danger" size="md" loading={deleting} onClick={handleDelete}>
              Supprimer le projet
            </Button>
          </div>
        }
      >
        <p
          style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)', margin: 0 }}
        >
          Le projet « {project.name} » sera retiré de la liste des projets.
        </p>
        <p
          style={{
            fontSize: 'var(--text-sm)',
            color: 'var(--text-secondary)',
            marginTop: 8,
          }}
        >
          Il s&apos;agit d&apos;un archivage : les calculs et PV scellés déjà émis restent
          conservés et ne sont pas supprimés.
        </p>
      </Modal>
    </div>
  );
}

function MetaRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'baseline' }}>
      <span
        style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', minWidth: 100 }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 'var(--text-sm)',
          color: 'var(--text-primary)',
          fontFamily: mono ? 'var(--font-mono)' : undefined,
          fontVariantNumeric: mono ? 'tabular-nums' : undefined,
        }}
      >
        {value}
      </span>
    </div>
  );
}
