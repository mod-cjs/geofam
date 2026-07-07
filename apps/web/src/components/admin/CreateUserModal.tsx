'use client';

/**
 * CreateUserModal — création d'un compte utilisateur GLOBAL standalone (hors wizard org).
 *
 * Utilisé depuis /admin/users (« Nouvel utilisateur »). L'utilisateur créé n'est
 * membre d'AUCUNE org à ce stade — le rattachement se fait ensuite (fiche user
 * → « Ajouter à une org » ou wizard de création d'org).
 *
 * Confidentialité DoD §8 : aucun import @roadsen/engines.
 */

import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { clientCreateUser } from '@/lib/api/admin-client';

interface CreateUserModalProps {
  open: boolean;
  onClose: () => void;
  /** Appelé après succès (userId créé) — le parent rafraîchit la liste. */
  onCreated: (userId: string) => void;
}

export function CreateUserModal({ open, onClose, onCreated }: CreateUserModalProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  // Réinitialisation à chaque ouverture
  useEffect(() => {
    if (open) {
      setEmail('');
      setPassword('');
      setFullName('');
      setError(undefined);
    }
  }, [open]);

  const canSubmit = canSubmitCreateUser({ email, password, fullName }) && !loading;

  async function handleSubmit() {
    if (!canSubmit) return;
    setLoading(true);
    setError(undefined);
    try {
      const { userId } = await clientCreateUser({
        email: email.trim(),
        password,
        fullName: fullName.trim(),
      });
      onCreated(userId);
      onClose();
    } catch (err) {
      setError(extractMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nouvel utilisateur"
      description="Crée un compte global. Le rattachement à une organisation se fait ensuite."
      size="sm"
      loading={loading}
      error={error}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={loading}>
            Annuler
          </Button>
          <Button variant="action" size="sm" onClick={handleSubmit} disabled={!canSubmit} loading={loading}>
            Créer
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label htmlFor="cu-email" style={labelStyle}>
            Email
          </label>
          <input
            id="cu-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="off"
            style={fieldStyle}
          />
        </div>
        <div>
          <label htmlFor="cu-fullname" style={labelStyle}>
            Nom complet
          </label>
          <input
            id="cu-fullname"
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            autoComplete="off"
            style={fieldStyle}
          />
        </div>
        <div>
          <label htmlFor="cu-password" style={labelStyle}>
            Mot de passe initial (≥ 12 caractères)
          </label>
          <input
            id="cu-password"
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="off"
            style={fieldStyle}
          />
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', margin: '4px 0 0' }}>
            Communique-le à l&apos;utilisateur par un canal sûr — il n&apos;est stocké nulle part.
          </p>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Prédicat de validation exporté (testable en isolation — DoD §9)
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function canSubmitCreateUser({
  email,
  password,
  fullName,
}: {
  email: string;
  password: string;
  fullName: string;
}): boolean {
  return EMAIL_RE.test(email.trim()) && password.length >= 12 && fullName.trim().length > 0;
}

// ---------------------------------------------------------------------------
// Styles inline partagés
// ---------------------------------------------------------------------------

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 'var(--text-xs)',
  fontWeight: 500,
  color: 'var(--text-secondary)',
  marginBottom: 4,
};

const fieldStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: 'var(--radius-base)',
  border: '1px solid var(--border-default)',
  fontSize: 'var(--text-sm)',
  fontFamily: 'var(--font-sans)',
  background: 'var(--surface-canvas)',
  color: 'var(--text-primary)',
  boxSizing: 'border-box',
};

function extractMessage(err: unknown): string {
  if (
    err &&
    typeof err === 'object' &&
    'message' in err &&
    typeof (err as { message: unknown }).message === 'string'
  ) {
    return (err as { message: string }).message;
  }
  return 'Une erreur inattendue est survenue.';
}
