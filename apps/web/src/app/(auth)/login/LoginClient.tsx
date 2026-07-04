'use client';

/**
 * B-01 — Login
 * État : défaut · saisie (on-blur) · chargement · erreur identifiants inline
 * Hors shell. Focus initial sur email. Submit Entrée.
 * Pas de "créer un compte" ni "mot de passe oublié" (P1, comptes pré-provisionnés).
 */

import { AlertCircle } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { Logotype } from '@/components/ui/Logotype';
import { login, getStoredOrgs } from '@/lib/api/client';

interface FieldErrors {
  email?: string;
  password?: string;
}

export default function LoginClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = searchParams.get('returnTo');

  const emailRef = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Validation on-blur
  function validateEmail(value: string): string | undefined {
    if (!value.trim()) return "L'adresse e-mail est requise";
    if (!value.includes('@')) return "Format d'adresse invalide";
    return undefined;
  }

  function validatePassword(value: string): string | undefined {
    if (!value) return 'Le mot de passe est requis';
    return undefined;
  }

  function handleEmailBlur() {
    const err = validateEmail(email);
    setFieldErrors((prev) => ({ ...prev, email: err }));
  }

  function handlePasswordBlur() {
    const err = validatePassword(password);
    setFieldErrors((prev) => ({ ...prev, password: err }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setGlobalError(null);

    const emailErr = validateEmail(email);
    const pwErr = validatePassword(password);
    if (emailErr || pwErr) {
      setFieldErrors({ email: emailErr, password: pwErr });
      return;
    }

    setLoading(true);
    try {
      await login({ email, password });
      // En mode mock : pose un cookie indicateur pour le middleware demo.
      // En mode réel (NEXT_PUBLIC_API_BASE_URL posée) : http-client.ts a déjà posé
      // le cookie `roadsen_access_token` via storeTokens() — le middleware Edge
      // le lira pour vérifier le JWT. Rien à faire ici.
      if (!process.env.NEXT_PUBLIC_API_BASE_URL) {
        document.cookie = 'roadsen_mock_auth=1; path=/; SameSite=Lax';
      }
      // Destination : returnTo explicite → 1re org connue → racine (middleware redirige).
      // Plus de slug mock codé en dur.
      const orgs = getStoredOrgs();
      // Accueil = galerie des logiciels GEOFAM (l'utilisateur choisit un module).
      const destination =
        returnTo ?? (orgs[0]?.slug ? `/app/${orgs[0].slug}/logiciels` : '/');
      router.push(destination);
    } catch (err: unknown) {
      const apiErr = err as { message?: string };
      setGlobalError(apiErr?.message ?? 'Une erreur est survenue. Réessayez.');
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--surface-canvas)',
        padding: '24px 16px',
      }}
    >
      {/* Skip-link */}
      <a
        href="#login-form"
        className="sr-only"
        style={{
          position: 'absolute',
          top: 8,
          left: 8,
        }}
        onFocus={(e) => {
          e.currentTarget.style.clip = 'auto';
          e.currentTarget.style.width = 'auto';
          e.currentTarget.style.height = 'auto';
          e.currentTarget.style.overflow = 'visible';
        }}
        onBlur={(e) => {
          e.currentTarget.style.clip = '';
          e.currentTarget.style.width = '';
          e.currentTarget.style.height = '';
          e.currentTarget.style.overflow = '';
        }}
      >
        Aller au formulaire de connexion
      </a>

      <div
        style={{
          width: '100%',
          maxWidth: 400,
          background: 'var(--surface-base)',
          borderRadius: 'var(--radius-xl)',
          boxShadow: 'var(--elevation-modal)',
          padding: '40px 32px',
        }}
      >
        {/* Logotype */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 32 }}>
          <Logotype size={48} />
        </div>

        <h1
          style={{
            fontSize: 'var(--text-xl)',
            fontWeight: 600,
            color: 'var(--text-primary)',
            marginBottom: 4,
            lineHeight: 1.2,
          }}
        >
          Connexion
        </h1>
        <p
          style={{
            fontSize: 'var(--text-sm)',
            color: 'var(--text-secondary)',
            marginBottom: 28,
          }}
        >
          Accès réservé aux membres provisionnés.
        </p>

        {/* Erreur globale */}
        {globalError && (
          <div
            role="alert"
            aria-live="assertive"
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
              padding: '10px 12px',
              background: 'var(--status-fail-bg)',
              borderRadius: 'var(--radius-base)',
              marginBottom: 20,
            }}
          >
            <AlertCircle
              size={16}
              strokeWidth={1.5}
              aria-hidden="true"
              style={{ color: 'var(--status-fail-tx)', flexShrink: 0, marginTop: 1 }}
            />
            <span
              style={{
                fontSize: 'var(--text-sm)',
                color: 'var(--status-fail-tx)',
                lineHeight: 1.4,
              }}
            >
              {globalError}
            </span>
          </div>
        )}

        <form id="login-form" onSubmit={handleSubmit} noValidate>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Input
              id="login-email"
              label="Adresse e-mail"
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setGlobalError(null);
              }}
              onBlur={handleEmailBlur}
              error={fieldErrors.email}
              autoComplete="email"
              autoFocus
              required
              ref={emailRef}
              placeholder="vous@bureau.sn"
            />

            <Input
              id="login-password"
              label="Mot de passe"
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setGlobalError(null);
              }}
              onBlur={handlePasswordBlur}
              error={fieldErrors.password}
              autoComplete="current-password"
              required
            />

            <Button
              type="submit"
              variant="action"
              size="lg"
              loading={loading}
              disabled={loading}
              style={{ width: '100%', marginTop: 8 }}
            >
              Se connecter
            </Button>
          </div>
        </form>

        {/* Aide de démonstration */}
        <p
          style={{
            marginTop: 24,
            fontSize: 'var(--text-xs)',
            color: 'var(--text-muted)',
            textAlign: 'center',
            lineHeight: 1.5,
          }}
        >
          Démo : saisissez n&apos;importe quel e-mail et mot de passe (sauf
          &laquo;&nbsp;wrong&nbsp;&raquo;).
        </p>
      </div>
    </div>
  );
}
