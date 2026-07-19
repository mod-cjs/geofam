'use client';

/**
 * B-01 — Login (refonte « dark technique » assortie à la landing GEOFAM v3).
 *
 * État : défaut · saisie (on-blur) · chargement · erreur identifiants inline.
 * Hors shell. Focus initial sur email. Submit Entrée. Skip-link conservé.
 * Pas de « créer un compte » ni « mot de passe oublié » (P1, comptes pré-provisionnés).
 *
 * La logique d'authentification (login/getStoredOrgs, returnTo, cookie mock,
 * destination) est INCHANGÉE ; seule la présentation est refaite. Palette dark
 * (fond #080a0d, accent ambre #f0a24b, sceau #4fd1b0) hardcodée ici pour être
 * cohérente avec public/landing.html, indépendamment des tokens clairs de l'app.
 */

import { AlertCircle, ArrowLeft } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';

import { login, getStoredOrgs } from '@/lib/api/client';

interface FieldErrors {
  email?: string;
  password?: string;
}

const C = {
  bg: '#080a0d',
  panel: '#0f141b',
  panel2: '#131a23',
  hair: 'rgba(255,255,255,.09)',
  hair2: 'rgba(255,255,255,.14)',
  ink: '#eef2f6',
  ink2: '#aeb8c4',
  muted: '#6b7684',
  amber: '#f0a24b',
  amber2: '#ffbe6e',
  amberDim: 'rgba(240,162,75,.14)',
  amberLine: 'rgba(240,162,75,.42)',
  seal: '#4fd1b0',
  sealDim: 'rgba(79,209,176,.12)',
  fail: '#ff8a73',
  failBg: 'rgba(255,138,115,.1)',
  failLine: 'rgba(255,138,115,.32)',
  mono: "'JetBrains Mono',ui-monospace,'SF Mono',Menlo,Consolas,monospace",
};

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
  const [focused, setFocused] = useState<'email' | 'password' | null>(null);

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
    setFocused(null);
    const err = validateEmail(email);
    setFieldErrors((prev) => ({ ...prev, email: err }));
  }

  function handlePasswordBlur() {
    setFocused(null);
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
      // Destination : returnTo explicite → 1re org connue → back-office (SUPERADMIN).
      const orgs = getStoredOrgs();
      const destination =
        returnTo ?? (orgs[0]?.slug ? `/app/${orgs[0].slug}/logiciels` : '/admin');
      router.push(destination);
    } catch (err: unknown) {
      const apiErr = err as { message?: string };
      setGlobalError(apiErr?.message ?? 'Une erreur est survenue. Réessayez.');
      setLoading(false);
    }
  }

  // ---- styles inline (dark, self-contained) ----
  function fieldStyle(
    name: 'email' | 'password',
    hasError: boolean,
  ): React.CSSProperties {
    const active = focused === name;
    return {
      width: '100%',
      padding: '12px 14px',
      fontSize: 15,
      color: C.ink,
      background: C.panel2,
      border: `1px solid ${hasError ? C.failLine : active ? C.amberLine : C.hair2}`,
      borderRadius: 10,
      outline: 'none',
      boxShadow: active ? `0 0 0 3px ${hasError ? C.failBg : C.amberDim}` : 'none',
      transition: 'border-color .15s, box-shadow .15s',
      fontFamily: 'inherit',
    };
  }
  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontFamily: C.mono,
    fontSize: 11,
    letterSpacing: '.08em',
    textTransform: 'uppercase',
    color: C.muted,
    marginBottom: 8,
  };
  const errStyle: React.CSSProperties = {
    fontSize: 12.5,
    color: C.fail,
    marginTop: 7,
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px 16px',
        background: C.bg,
        backgroundImage: `radial-gradient(closest-side, rgba(240,162,75,.14), transparent 70%),
          radial-gradient(closest-side, rgba(79,209,176,.06), transparent 70%)`,
        backgroundPosition: '85% -10%, 5% 110%',
        backgroundSize: '55vw 55vw, 45vw 45vw',
        backgroundRepeat: 'no-repeat',
        color: C.ink,
        fontFamily: 'var(--font-sans, ui-sans-serif, system-ui, sans-serif)',
      }}
    >
      {/* Skip-link */}
      <a
        href="#login-form"
        className="sr-only"
        style={{ position: 'absolute', top: 8, left: 8 }}
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

      {/* Retour à l'accueil */}
      <Link
        href="/"
        style={{
          position: 'absolute',
          top: 22,
          left: 22,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 7,
          fontFamily: C.mono,
          fontSize: 12,
          letterSpacing: '.04em',
          color: C.muted,
          textDecoration: 'none',
        }}
      >
        <ArrowLeft size={14} strokeWidth={1.6} aria-hidden="true" /> Accueil
      </Link>

      {/* Carte de connexion en verre */}
      <div
        style={{
          width: '100%',
          maxWidth: 408,
          position: 'relative',
          background: `linear-gradient(180deg, ${C.panel}, ${C.bg})`,
          border: `1px solid ${C.hair}`,
          borderRadius: 16,
          boxShadow:
            '0 1px 0 rgba(255,255,255,.08) inset, 0 40px 80px -40px rgba(0,0,0,.9)',
          padding: '40px 34px 30px',
        }}
      >
        {/* Liseré lumineux haut (signature v3) */}
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            insetInline: 0,
            top: 0,
            height: 1,
            borderRadius: '16px 16px 0 0',
            background:
              'linear-gradient(90deg, transparent, rgba(255,255,255,.16), transparent)',
          }}
        />

        {/* Logo officiel GEOFAM (public/geofam.jpeg) dans un badge clair */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 22 }}>
          <span
            style={{
              width: 112,
              height: 112,
              borderRadius: 18,
              background: '#f6f4ee',
              display: 'grid',
              placeItems: 'center',
              boxShadow: '0 10px 28px -16px rgba(0,0,0,.7)',
              overflow: 'hidden',
            }}
          >
            <Image
              src="/geofam.jpeg"
              alt="GEOFAM — Géotechnique · Logiciels · Formation · Innovation"
              width={104}
              height={104}
              priority
              style={{ width: 104, height: 'auto' }}
            />
          </span>
        </div>

        <p
          style={{
            fontFamily: C.mono,
            fontSize: 11,
            letterSpacing: '.16em',
            textTransform: 'uppercase',
            color: C.amber,
            textAlign: 'center',
            marginBottom: 8,
          }}
        >
          Espace bureaux d&apos;études
        </p>
        <h1
          style={{
            fontSize: 26,
            fontWeight: 650,
            letterSpacing: '-.02em',
            color: C.ink,
            textAlign: 'center',
            marginBottom: 6,
            lineHeight: 1.15,
          }}
        >
          Connexion à GEOFAM
        </h1>
        <p
          style={{
            fontSize: 13.5,
            color: C.ink2,
            textAlign: 'center',
            marginBottom: 26,
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
              gap: 9,
              padding: '11px 13px',
              background: C.failBg,
              border: `1px solid ${C.failLine}`,
              borderRadius: 10,
              marginBottom: 20,
            }}
          >
            <AlertCircle
              size={16}
              strokeWidth={1.6}
              aria-hidden="true"
              style={{ color: C.fail, flexShrink: 0, marginTop: 1 }}
            />
            <span style={{ fontSize: 13, color: C.fail, lineHeight: 1.45 }}>
              {globalError}
            </span>
          </div>
        )}

        <form id="login-form" onSubmit={handleSubmit} noValidate>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            {/* Email */}
            <div>
              <label htmlFor="login-email" style={labelStyle}>
                Adresse e-mail
              </label>
              <input
                id="login-email"
                type="email"
                inputMode="email"
                value={email}
                ref={emailRef}
                autoFocus
                required
                autoComplete="email"
                placeholder="vous@bureau.sn"
                aria-invalid={fieldErrors.email ? true : undefined}
                aria-describedby={fieldErrors.email ? 'login-email-err' : undefined}
                onFocus={() => setFocused('email')}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setGlobalError(null);
                }}
                onBlur={handleEmailBlur}
                style={fieldStyle('email', !!fieldErrors.email)}
              />
              {fieldErrors.email && (
                <p id="login-email-err" style={errStyle}>
                  {fieldErrors.email}
                </p>
              )}
            </div>

            {/* Mot de passe */}
            <div>
              <label htmlFor="login-password" style={labelStyle}>
                Mot de passe
              </label>
              <input
                id="login-password"
                type="password"
                value={password}
                required
                autoComplete="current-password"
                aria-invalid={fieldErrors.password ? true : undefined}
                aria-describedby={fieldErrors.password ? 'login-password-err' : undefined}
                onFocus={() => setFocused('password')}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setGlobalError(null);
                }}
                onBlur={handlePasswordBlur}
                style={fieldStyle('password', !!fieldErrors.password)}
              />
              {fieldErrors.password && (
                <p id="login-password-err" style={errStyle}>
                  {fieldErrors.password}
                </p>
              )}
            </div>

            {/* Bouton */}
            <button
              type="submit"
              disabled={loading}
              aria-busy={loading}
              style={{
                width: '100%',
                marginTop: 4,
                padding: '13px 16px',
                fontSize: 15,
                fontWeight: 600,
                fontFamily: 'inherit',
                color: '#1a1206',
                background: loading
                  ? C.amber
                  : `linear-gradient(${C.amber2}, ${C.amber})`,
                border: 'none',
                borderRadius: 10,
                cursor: loading ? 'default' : 'pointer',
                boxShadow:
                  '0 1px 0 rgba(255,255,255,.35) inset, 0 10px 24px -10px rgba(240,162,75,.6)',
                opacity: loading ? 0.85 : 1,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 9,
                transition: 'opacity .15s, box-shadow .2s',
              }}
            >
              {loading && (
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                  style={{ animation: 'rds-spin .7s linear infinite' }}
                >
                  <circle
                    cx="12"
                    cy="12"
                    r="9"
                    stroke="#1a1206"
                    strokeOpacity="0.25"
                    strokeWidth="3"
                  />
                  <path
                    d="M21 12a9 9 0 0 0-9-9"
                    stroke="#1a1206"
                    strokeWidth="3"
                    strokeLinecap="round"
                  />
                </svg>
              )}
              {loading ? 'Connexion…' : 'Se connecter'}
            </button>
          </div>
        </form>

        {/* Ligne de confiance (assortie au discours PV scellé) */}
        <div
          style={{
            marginTop: 22,
            paddingTop: 18,
            borderTop: `1px solid ${C.hair}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 9,
            fontFamily: C.mono,
            fontSize: 11.5,
            letterSpacing: '.02em',
            color: C.muted,
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: C.seal,
              boxShadow: `0 0 8px ${C.sealDim}`,
            }}
          />
          Calcul serveur · PV scellé à chaque résultat
        </div>
      </div>

      <style>{`@keyframes rds-spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
