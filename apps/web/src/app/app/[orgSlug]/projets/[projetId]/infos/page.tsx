'use client';

/**
 * B-35 — Onglet Informations projet
 * Renommage (optimistic) + métadonnées en lecture.
 */

import { useEffect, useState } from 'react';
import { getProject } from '@/lib/api/client';
import type { Project } from '@/lib/api/types';
import { Input } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton.client';
import { useToast } from '@/components/ui/Toast';
import { resolveOrgId } from '@/lib/org-context';

interface Props {
  params: Promise<{ orgSlug: string; projetId: string }>;
}


function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso));
}

export default function InfosPage({ params: paramsPromise }: Props) {
  const { addToast } = useToast();
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    paramsPromise.then(({ orgSlug, projetId }) => {
      const orgId = resolveOrgId(orgSlug);
      if (!orgId) { setLoading(false); return; }
      getProject(orgId, projetId).then((p) => {
        setProject(p);
        setName(p.name);
        setLoading(false);
      }).catch(() => setLoading(false));
    });
  }, []);

  async function handleSave() {
    if (!project || !name.trim()) return;
    setSaving(true);
    // Optimistic UI
    const prev = project.name;
    setProject({ ...project, name: name.trim() });
    try {
      await new Promise((r) => setTimeout(r, 400)); // mock save
      addToast({ type: 'success', message: 'Projet renommé.' });
    } catch {
      // Rollback
      setProject({ ...project, name: prev });
      setName(prev);
      addToast({ type: 'error', message: 'Erreur lors de la sauvegarde.' });
    } finally {
      setSaving(false);
    }
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
        <MetaRow label="Domaine" value={{ CH: 'Chaussées', FD: 'Fondations', LB: 'Labo / Sol' }[project.domain] ?? project.domain} />
        <MetaRow label="Créé le" value={formatDate(project.createdAt)} />
        <MetaRow label="Modifié le" value={formatDate(project.updatedAt)} />
      </div>
    </div>
  );
}

function MetaRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'baseline' }}>
      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', minWidth: 100 }}>{label}</span>
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
