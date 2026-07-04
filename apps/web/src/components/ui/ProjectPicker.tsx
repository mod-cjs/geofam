'use client';

/**
 * Sélecteur de projet avec création INLINE.
 * Partagé par les logiciels : choisir un projet du bon domaine, ou en créer un
 * directement (« ＋ Nouveau projet… ») sans quitter le calcul.
 */

import { useState } from 'react';

import { createProject } from '@/lib/api/client';
import type { Project, ProjectDomain } from '@/lib/api/types';

interface ProjectPickerProps {
  orgId: string | null;
  domain: ProjectDomain;
  projects: Project[];
  setProjects: (updater: (prev: Project[]) => Project[]) => void;
  value: string;
  onChange: (id: string) => void;
  accent?: string;
  width?: number;
}

const NEW = '__new__';

export function ProjectPicker({ orgId, domain, projects, setProjects, value, onChange, accent = '#1b3a5b', width = 240 }: ProjectPickerProps) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const inp: React.CSSProperties = { border: '1px solid #b7b2a6', borderRadius: 7, padding: '7px 9px', fontSize: 13, fontFamily: 'inherit', background: '#fff', color: '#1a1f24' };

  const create = async () => {
    const n = name.trim();
    if (!orgId || !n || busy) return;
    setBusy(true); setErr(null);
    try {
      const p = await createProject(orgId, { name: n, domain });
      setProjects((prev) => [p, ...prev]);
      onChange(p.id);
      setCreating(false); setName('');
    } catch (e) {
      setErr((e as { message?: string })?.message ?? 'Création impossible.');
    } finally { setBusy(false); }
  };

  if (creating) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input
          autoFocus
          style={{ ...inp, width }}
          value={name}
          placeholder="Nom du nouveau projet"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') create(); if (e.key === 'Escape') { setCreating(false); setName(''); } }}
          aria-label="Nom du nouveau projet"
        />
        <button type="button" onClick={create} disabled={busy || !name.trim()} title="Créer"
          style={{ background: accent, color: '#fff', border: 'none', borderRadius: 7, padding: '8px 12px', fontSize: 13, fontWeight: 600, cursor: busy || !name.trim() ? 'not-allowed' : 'pointer', opacity: busy || !name.trim() ? 0.6 : 1 }}>
          {busy ? '…' : 'Créer'}
        </button>
        <button type="button" onClick={() => { setCreating(false); setName(''); setErr(null); }} aria-label="Annuler"
          style={{ background: '#fff', color: '#6b7077', border: '1px solid #d3ccbf', borderRadius: 7, padding: '8px 10px', fontSize: 13, cursor: 'pointer' }}>✕</button>
        {err && <span role="alert" style={{ fontSize: 11, color: '#b23a2e' }}>{err}</span>}
      </div>
    );
  }

  return (
    <select
      style={{ ...inp, width }}
      value={value}
      onChange={(e) => { if (e.target.value === NEW) { setCreating(true); } else { onChange(e.target.value); } }}
      aria-label="Projet"
    >
      <option value="">Sélectionner…</option>
      {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      <option value={NEW}>＋ Nouveau projet…</option>
    </select>
  );
}
