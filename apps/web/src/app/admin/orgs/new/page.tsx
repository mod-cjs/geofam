/**
 * /admin/orgs/new — Wizard onboarding 3 étapes.
 * Client Component : state local multi-étapes, POST /admin/orgs au submit final.
 *
 * Étape 1 : Compte OWNER (recherche user existant OU création inline)
 * Étape 2 : Organisation (nom, slug)
 * Étape 3 : Abonnement (pack, quota, dates)
 *
 * Un seul POST /admin/orgs au submit (atomique : provision_org + subscription).
 */

'use client';

import { ChevronRight, ChevronLeft, Search, Check } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition, useEffect, useCallback } from 'react';

import {
  ALL_ENTITLEMENTS,
  PACK_NAMES,
  PACK_PRESETS,
  customPackWarning,
  isCustomizedVsPack,
  type PackName,
} from '@/components/admin/pack-presets';
import { Button } from '@/components/ui/Button';
import {
  clientSearchUsers,
  clientCreateUser,
  clientCreateOrg,
} from '@/lib/api/admin-client';
import type { AdminUserView } from '@/lib/api/admin-server';

// ---------------------------------------------------------------------------
// Types état wizard
// ---------------------------------------------------------------------------

export interface WizardOwnerState {
  ownerMode: 'search' | 'create';
  ownerSelected: AdminUserView | null;
  /** userId persisté après clientCreateUser réussi. Permet la reprise si
   *  clientCreateOrg échoue ensuite : le user existant est réutilisé SANS le recréer. */
  createdUserId: string | null;
  newUserEmail: string;
  newUserPassword: string;
  newUserFullName: string;
}

interface WizardState extends WizardOwnerState {
  // Étape 1 — OWNER (recherche)
  ownerQuery: string;
  ownerSearchResults: AdminUserView[];
  // Étape 2 — Org
  orgName: string;
  orgSlug: string;
  // Étape 3 — Abo
  subPack: string;
  /** Modules débloqués — pré-remplis par le pack (PACK_PRESETS), éditables ensuite. */
  subEntitlements: string[];
  subQuota: string;
  subDateDebut: string;
  subDateFin: string;
}

// ---------------------------------------------------------------------------
// Résolution de l'id OWNER — logique pure (exportée pour les tests)
// ---------------------------------------------------------------------------

/** Résoud l'id du futur OWNER.
 *  - Si un user est sélectionné via la recherche → son id.
 *  - Si createdUserId est déjà posé (reprise après échec org) → le réutiliser.
 *  - Si mode création sans id existant → appeler createUser et retourner son id.
 *  Garantit qu'une reprise ne recrée JAMAIS l'utilisateur (évite user orphelin + 409). */
export async function resolveOwnerUserId(
  owner: WizardOwnerState,
  createUser: typeof clientCreateUser,
): Promise<{ userId: string; wasCreated: boolean }> {
  if (owner.ownerSelected?.userId) {
    return { userId: owner.ownerSelected.userId, wasCreated: false };
  }
  if (owner.createdUserId) {
    // Reprise : user créé lors d'une tentative précédente → réutiliser sans recréer
    return { userId: owner.createdUserId, wasCreated: false };
  }
  if (owner.ownerMode === 'create') {
    const result = await createUser({
      email: owner.newUserEmail.trim(),
      password: owner.newUserPassword,
      fullName: owner.newUserFullName.trim(),
    });
    return { userId: result.userId, wasCreated: true };
  }
  throw new Error("Impossible de déterminer l'OWNER.");
}

const STEP_LABELS = ['Compte OWNER', 'Organisation', 'Abonnement'];

// ---------------------------------------------------------------------------
// Composant principal
// ---------------------------------------------------------------------------

export default function NewOrgPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [state, setState] = useState<WizardState>({
    ownerMode: 'search',
    ownerQuery: '',
    ownerSearchResults: [],
    ownerSelected: null,
    createdUserId: null,
    newUserEmail: '',
    newUserPassword: '',
    newUserFullName: '',
    orgName: '',
    orgSlug: '',
    subPack: 'COMPLETE',
    subEntitlements: [...PACK_PRESETS.COMPLETE],
    subQuota: '100',
    subDateDebut: today(),
    subDateFin: oneYearFromToday(),
  });

  // Dériver le slug depuis le nom (étape 2)
  useEffect(() => {
    const derived = state.orgName
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
    if (derived && !state.orgSlug) {
      setState((s) => ({ ...s, orgSlug: derived }));
    }
    // Dépendance volontairement limitée à orgName (dérivation one-shot du slug).
  }, [state.orgName]);

  // ---------------------------------------------------------------------------
  // Étape 1 — Recherche user
  // ---------------------------------------------------------------------------

  const searchUsers = useCallback(async (q: string) => {
    if (!q.trim()) {
      setState((s) => ({ ...s, ownerSearchResults: [] }));
      return;
    }
    try {
      const results = await clientSearchUsers(q);
      setState((s) => ({ ...s, ownerSearchResults: results }));
    } catch {
      // Recherche non bloquante
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      if (state.ownerMode === 'search') {
        void searchUsers(state.ownerQuery);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [state.ownerQuery, state.ownerMode, searchUsers]);

  // ---------------------------------------------------------------------------
  // Validation par étape
  // ---------------------------------------------------------------------------

  function validateStep0(): string | null {
    if (state.ownerMode === 'search') {
      if (!state.ownerSelected) return 'Sélectionnez un utilisateur existant.';
    } else {
      if (!state.newUserEmail.trim()) return "L'adresse email est requise.";
      if (!state.newUserPassword.trim() || state.newUserPassword.length < 8)
        return 'Le mot de passe doit contenir au moins 8 caractères.';
      if (!state.newUserFullName.trim()) return 'Le nom complet est requis.';
    }
    return null;
  }

  function validateStep1(): string | null {
    if (!state.orgName.trim()) return "Le nom de l'organisation est requis.";
    if (!state.orgSlug.trim()) return 'Le slug est requis.';
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(state.orgSlug))
      return 'Le slug doit contenir uniquement des lettres minuscules, chiffres et tirets.';
    return null;
  }

  function validateStep2(): string | null {
    const quota = parseInt(state.subQuota, 10);
    if (isNaN(quota) || quota < 1) return 'Le quota doit être un entier positif.';
    if (!state.subDateDebut) return 'La date de début est requise.';
    if (!state.subDateFin) return 'La date de fin est requise.';
    if (state.subDateFin <= state.subDateDebut)
      return 'La date de fin doit être postérieure à la date de début.';
    return null;
  }

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  function goNext() {
    setError(null);
    const validators = [validateStep0, validateStep1, validateStep2];
    const err = validators[step]?.() ?? null;
    if (err) {
      setError(err);
      return;
    }
    setStep((s) => s + 1);
  }

  function goPrev() {
    setError(null);
    setStep((s) => Math.max(0, s - 1));
  }

  // ---------------------------------------------------------------------------
  // Soumission finale
  // ---------------------------------------------------------------------------

  function handleSubmit() {
    setError(null);
    const err = validateStep2();
    if (err) {
      setError(err);
      return;
    }

    startTransition(async () => {
      try {
        // Résolution OWNER — réutilise createdUserId si déjà créé (reprise)
        const { userId: ownerUserId, wasCreated } = await resolveOwnerUserId(
          state,
          clientCreateUser,
        );

        // Persiste le userId créé AVANT d'appeler createOrg (reprise possible)
        if (wasCreated) {
          setState((s) => ({ ...s, createdUserId: ownerUserId }));
          // Pas de message bloquant ici : on enchaîne directement sur l'org.
        }

        // Étape unique : créer l'org + abo (atomique)
        const result = await clientCreateOrg({
          name: state.orgName.trim(),
          slug: state.orgSlug.trim(),
          ownerUserId,
          subscription: {
            pack: state.subPack,
            quota: parseInt(state.subQuota, 10),
            entitlements: state.subEntitlements,
            dateDebut: new Date(state.subDateDebut).toISOString(),
            dateFin: new Date(state.subDateFin).toISOString(),
          },
        });

        setSuccess(`Organisation créée (${result.orgId}). Redirection…`);
        setTimeout(() => router.push('/admin/orgs'), 1500);
      } catch (err: unknown) {
        // NB : le 409 « un user = une org » (R0015, migration 0020) et le 409 slug
        // déjà pris ont chacun un message backend déjà clair et distinct
        // (provisionOrg, auth.service.ts) — pas de normalisation nécessaire ici,
        // contrairement à l'ajout de membre où R0015 peut venir de deux fonctions
        // avec des textes différents (cf. describeAddMemberError, OrgDetailClient).
        const msg =
          typeof err === 'object' && err !== null && 'message' in err
            ? String((err as { message: string }).message)
            : 'Erreur inattendue.';
        // Indice si le compte a été créé mais l'org a échoué (reprise possible)
        if (state.ownerMode === 'create' && state.createdUserId) {
          setError(
            `${msg} — Le compte OWNER a déjà été créé, corrigez les données de l'organisation puis relancez.`,
          );
        } else {
          setError(msg);
        }
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Rendu
  // ---------------------------------------------------------------------------

  return (
    <div style={{ padding: 'var(--sp-6)' }}>
      {/* En-tête */}
      <h1
        style={{
          fontSize: 'var(--text-lg)',
          fontWeight: 600,
          color: 'var(--text-primary)',
          margin: '0 0 var(--sp-6)',
        }}
      >
        Nouvelle organisation
      </h1>

      {/* Indicateur d'étapes */}
      <StepIndicator current={step} steps={STEP_LABELS} />

      {/* Carte de contenu */}
      <div
        style={{
          background: 'var(--surface-base)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--elevation-card)',
          padding: '28px 32px',
          maxWidth: 560,
          marginTop: 'var(--sp-6)',
        }}
      >
        {/* Bannière succès */}
        {success && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: 'var(--status-pass-bg)',
              color: 'var(--status-pass-tx)',
              padding: '10px 14px',
              borderRadius: 'var(--radius-base)',
              marginBottom: 20,
              fontSize: 'var(--text-sm)',
            }}
          >
            <Check size={16} aria-hidden="true" />
            {success}
          </div>
        )}

        {/* Bannière erreur */}
        {error && (
          <div
            role="alert"
            style={{
              background: 'var(--status-fail-bg)',
              color: 'var(--status-fail-tx)',
              padding: '10px 14px',
              borderRadius: 'var(--radius-base)',
              marginBottom: 20,
              fontSize: 'var(--text-sm)',
            }}
          >
            {error}
          </div>
        )}

        {/* Contenu de l'étape */}
        {step === 0 && <Step0 state={state} setState={setState} />}
        {step === 1 && <Step1 state={state} setState={setState} />}
        {step === 2 && <Step2 state={state} setState={setState} />}

        {/* Navigation */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginTop: 28,
            gap: 12,
          }}
        >
          <Button
            variant="ghost"
            onClick={goPrev}
            disabled={step === 0}
            iconLeft={<ChevronLeft size={16} aria-hidden="true" />}
          >
            Précédent
          </Button>

          {step < STEP_LABELS.length - 1 ? (
            <Button
              variant="secondary"
              onClick={goNext}
              iconLeft={<ChevronRight size={16} aria-hidden="true" />}
            >
              Suivant
            </Button>
          ) : (
            <Button
              variant="action"
              onClick={handleSubmit}
              loading={isPending}
              disabled={!!success}
            >
              {isPending ? 'Création…' : "Créer l'organisation"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Indicateur d'étapes
// ---------------------------------------------------------------------------

function StepIndicator({ current, steps }: { current: number; steps: string[] }) {
  return (
    <ol
      style={{
        display: 'flex',
        gap: 0,
        listStyle: 'none',
        padding: 0,
        margin: 0,
        maxWidth: 560,
      }}
      aria-label="Étapes du wizard"
    >
      {steps.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li
            key={i}
            aria-current={active ? 'step' : undefined}
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '0 8px 0 0',
            }}
          >
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 24,
                height: 24,
                borderRadius: '50%',
                background: done
                  ? 'var(--status-pass-tx)'
                  : active
                    ? 'var(--struct-petrole)'
                    : 'var(--border-default)',
                color: done || active ? '#fff' : 'var(--text-muted)',
                fontSize: 'var(--text-xs)',
                fontWeight: 600,
                flexShrink: 0,
              }}
            >
              {done ? <Check size={12} aria-hidden="true" /> : i + 1}
            </span>
            <span
              style={{
                fontSize: 'var(--text-sm)',
                fontWeight: active ? 500 : 400,
                color: active
                  ? 'var(--text-primary)'
                  : done
                    ? 'var(--text-secondary)'
                    : 'var(--text-muted)',
                whiteSpace: 'nowrap',
              }}
            >
              {label}
            </span>
            {i < steps.length - 1 && (
              <div
                aria-hidden="true"
                style={{
                  flex: 1,
                  height: 1,
                  background:
                    i < current ? 'var(--status-pass-tx)' : 'var(--border-subtle)',
                  margin: '0 4px',
                }}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// Étape 0 — Compte OWNER
// ---------------------------------------------------------------------------

function Step0({
  state,
  setState,
}: {
  state: WizardState;
  setState: React.Dispatch<React.SetStateAction<WizardState>>;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h2
        style={{
          fontSize: 'var(--text-base)',
          fontWeight: 600,
          margin: '0 0 4px',
          color: 'var(--text-primary)',
        }}
      >
        Compte OWNER
      </h2>
      <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', margin: 0 }}>
        Sélectionnez un compte existant ou créez-en un nouveau.
      </p>

      {/* Bascule mode */}
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          onClick={() =>
            setState((s) => ({ ...s, ownerMode: 'search', ownerSelected: null }))
          }
          style={{
            padding: '5px 14px',
            borderRadius: 'var(--radius-base)',
            border: '1px solid var(--border-default)',
            background:
              state.ownerMode === 'search' ? 'var(--struct-petrole)' : 'transparent',
            color: state.ownerMode === 'search' ? '#fff' : 'var(--text-secondary)',
            fontSize: 'var(--text-sm)',
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          Compte existant
        </button>
        <button
          type="button"
          onClick={() =>
            setState((s) => ({ ...s, ownerMode: 'create', ownerSelected: null }))
          }
          style={{
            padding: '5px 14px',
            borderRadius: 'var(--radius-base)',
            border: '1px solid var(--border-default)',
            background:
              state.ownerMode === 'create' ? 'var(--struct-petrole)' : 'transparent',
            color: state.ownerMode === 'create' ? '#fff' : 'var(--text-secondary)',
            fontSize: 'var(--text-sm)',
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          Nouveau compte
        </button>
      </div>

      {state.ownerMode === 'search' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Champ de recherche */}
          <div style={{ position: 'relative' }}>
            <Search
              size={14}
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
              aria-label="Rechercher un utilisateur par email ou nom"
              placeholder="Email ou nom…"
              value={state.ownerQuery}
              onChange={(e) => setState((s) => ({ ...s, ownerQuery: e.target.value }))}
              style={{
                width: '100%',
                height: 36,
                padding: '0 12px 0 32px',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-base)',
                fontSize: 'var(--text-sm)',
                background: 'var(--surface-base)',
                color: 'var(--text-primary)',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Résultats */}
          {state.ownerSearchResults.length > 0 && !state.ownerSelected && (
            <ul
              role="listbox"
              aria-label="Utilisateurs trouvés"
              style={{
                listStyle: 'none',
                padding: 0,
                margin: 0,
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-base)',
                overflow: 'hidden',
              }}
            >
              {state.ownerSearchResults.map((u) => {
                // Un user = une org (migration 0020) : signaler/désactiver les comptes
                // déjà membres d'une organisation (l'ajout comme OWNER échouerait en
                // 409 R0015). Info disponible directement sur AdminUserView.nbOrgs.
                const alreadyInOrg = u.nbOrgs > 0;
                return (
                  <li key={u.userId}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={false}
                      disabled={alreadyInOrg}
                      aria-disabled={alreadyInOrg}
                      title={
                        alreadyInOrg
                          ? 'Cet utilisateur appartient déjà à une organisation.'
                          : undefined
                      }
                      onClick={() => {
                        if (alreadyInOrg) return;
                        setState((s) => ({
                          ...s,
                          ownerSelected: u,
                          ownerSearchResults: [],
                        }));
                      }}
                      style={{
                        width: '100%',
                        padding: '10px 14px',
                        background: 'none',
                        border: 'none',
                        textAlign: 'left',
                        cursor: alreadyInOrg ? 'not-allowed' : 'pointer',
                        opacity: alreadyInOrg ? 0.6 : 1,
                        borderBottom: '1px solid var(--border-subtle)',
                      }}
                      onMouseOver={(e) => {
                        if (!alreadyInOrg) {
                          (e.currentTarget as HTMLElement).style.background =
                            'var(--row-hover-bg)';
                        }
                      }}
                      onMouseOut={(e) => {
                        (e.currentTarget as HTMLElement).style.background = 'none';
                      }}
                    >
                      <div
                        style={{
                          fontSize: 'var(--text-sm)',
                          fontWeight: 500,
                          color: 'var(--text-primary)',
                        }}
                      >
                        {u.fullName}
                        {alreadyInOrg && (
                          <span
                            style={{
                              marginLeft: 6,
                              fontSize: 'var(--text-xs)',
                              fontWeight: 400,
                              fontStyle: 'italic',
                              color: 'var(--status-fail-tx)',
                            }}
                          >
                            déjà dans une organisation
                          </span>
                        )}
                      </div>
                      <div
                        style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}
                      >
                        {u.email}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {/* Sélection courante */}
          {state.ownerSelected && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: 'var(--status-pass-bg)',
                borderRadius: 'var(--radius-base)',
                padding: '10px 14px',
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: 'var(--text-sm)',
                    fontWeight: 500,
                    color: 'var(--status-pass-tx)',
                  }}
                >
                  {state.ownerSelected.fullName}
                </div>
                <div
                  style={{ fontSize: 'var(--text-xs)', color: 'var(--status-pass-tx)' }}
                >
                  {state.ownerSelected.email}
                </div>
              </div>
              <button
                type="button"
                aria-label="Changer de sélection"
                onClick={() =>
                  setState((s) => ({ ...s, ownerSelected: null, ownerQuery: '' }))
                }
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 'var(--text-xs)',
                  color: 'var(--status-pass-tx)',
                  padding: '4px 8px',
                  borderRadius: 'var(--radius-sm)',
                }}
              >
                Changer
              </button>
            </div>
          )}
        </div>
      ) : (
        /* Création inline */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field
            label="Nom complet"
            value={state.newUserFullName}
            onChange={(v) => setState((s) => ({ ...s, newUserFullName: v }))}
            placeholder="Amadou Diallo"
          />
          <Field
            label="Email"
            type="email"
            value={state.newUserEmail}
            onChange={(v) => setState((s) => ({ ...s, newUserEmail: v }))}
            placeholder="amadou.diallo@example.com"
          />
          <Field
            label="Mot de passe initial"
            type="password"
            value={state.newUserPassword}
            onChange={(v) => setState((s) => ({ ...s, newUserPassword: v }))}
            placeholder="8 caractères minimum"
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Étape 1 — Organisation
// ---------------------------------------------------------------------------

function Step1({
  state,
  setState,
}: {
  state: WizardState;
  setState: React.Dispatch<React.SetStateAction<WizardState>>;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h2
        style={{
          fontSize: 'var(--text-base)',
          fontWeight: 600,
          margin: '0 0 4px',
          color: 'var(--text-primary)',
        }}
      >
        Organisation
      </h2>

      <Field
        label="Nom de l'organisation"
        value={state.orgName}
        onChange={(v) => {
          const slug = v
            .toLowerCase()
            .normalize('NFD')
            .replace(/[̀-ͯ]/g, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 40);
          setState((s) => ({ ...s, orgName: v, orgSlug: slug }));
        }}
        placeholder="Bureau d'Études Routes Dakar"
      />
      <Field
        label="Slug (identifiant URL)"
        value={state.orgSlug}
        onChange={(v) =>
          setState((s) => ({ ...s, orgSlug: v.toLowerCase().replace(/[^a-z0-9-]/g, '') }))
        }
        placeholder="bureau-etudes-routes-dakar"
        hint="Lettres minuscules, chiffres et tirets uniquement."
        monospace
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Étape 2 — Abonnement
// ---------------------------------------------------------------------------

function Step2({
  state,
  setState,
}: {
  state: WizardState;
  setState: React.Dispatch<React.SetStateAction<WizardState>>;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h2
        style={{
          fontSize: 'var(--text-base)',
          fontWeight: 600,
          margin: '0 0 4px',
          color: 'var(--text-primary)',
        }}
      >
        Abonnement
      </h2>

      {/* Pack */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label
          htmlFor="pack"
          style={{
            fontSize: 'var(--text-sm)',
            fontWeight: 500,
            color: 'var(--text-secondary)',
          }}
        >
          Pack
        </label>
        <select
          id="pack"
          value={state.subPack}
          onChange={(e) => {
            // Choisir un pack COCHE automatiquement ses modules (remplace la
            // sélection courante) — décision titulaire 14/07. Reste éditable après.
            const nextPack = e.target.value;
            setState((s) => ({
              ...s,
              subPack: nextPack,
              subEntitlements: [...(PACK_PRESETS[nextPack as PackName] ?? [])],
            }));
          }}
          style={{
            height: 36,
            padding: '0 28px 0 10px',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-base)',
            fontSize: 'var(--text-sm)',
            background: 'var(--surface-base)',
            color: 'var(--text-primary)',
            appearance: 'none',
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236b7077' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E\")",
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'right 8px center',
            outline: 'none',
          }}
        >
          {PACK_NAMES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>

      {/* Modules débloqués — pré-remplis par le pack, éditables ensuite */}
      <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
        <legend
          style={{
            fontSize: 'var(--text-sm)',
            fontWeight: 500,
            color: 'var(--text-secondary)',
            marginBottom: 6,
            padding: 0,
          }}
        >
          Modules débloqués
        </legend>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {ALL_ENTITLEMENTS.map((e) => (
            <label
              key={e.slug}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                cursor: 'pointer',
                fontSize: 'var(--text-sm)',
                color: 'var(--text-primary)',
              }}
            >
              <input
                type="checkbox"
                checked={state.subEntitlements.includes(e.slug)}
                onChange={() =>
                  setState((s) => {
                    const has = s.subEntitlements.includes(e.slug);
                    return {
                      ...s,
                      subEntitlements: has
                        ? s.subEntitlements.filter((x) => x !== e.slug)
                        : [...s.subEntitlements, e.slug],
                    };
                  })
                }
              />
              {e.label}
            </label>
          ))}
        </div>
        {isCustomizedVsPack(state.subPack, state.subEntitlements) && (
          <p
            role="status"
            style={{
              fontSize: 'var(--text-xs)',
              color: 'var(--status-warn-tx, #92650a)',
              margin: '8px 0 0',
            }}
          >
            {customPackWarning(state.subPack)}
          </p>
        )}
      </fieldset>

      <Field
        label="Quota (unités de calcul)"
        type="number"
        value={state.subQuota}
        onChange={(v) => setState((s) => ({ ...s, subQuota: v }))}
        placeholder="100"
        hint="Nombre total de calculs + PV autorisés sur la période."
      />
      <Field
        label="Date de début"
        type="date"
        value={state.subDateDebut}
        onChange={(v) => setState((s) => ({ ...s, subDateDebut: v }))}
      />
      <Field
        label="Date de fin"
        type="date"
        value={state.subDateFin}
        onChange={(v) => setState((s) => ({ ...s, subDateFin: v }))}
      />

      {/* Récap */}
      <div
        style={{
          background: 'rgba(31,78,74,0.05)',
          borderRadius: 'var(--radius-base)',
          padding: '12px 16px',
          fontSize: 'var(--text-xs)',
          color: 'var(--text-secondary)',
          lineHeight: 1.6,
        }}
      >
        <strong
          style={{ color: 'var(--text-primary)', display: 'block', marginBottom: 4 }}
        >
          Récapitulatif
        </strong>
        Pack <strong>{state.subPack}</strong> · Quota <strong>{state.subQuota}</strong>{' '}
        unités
        <br />
        Du <strong>{state.subDateDebut}</strong> au <strong>{state.subDateFin}</strong>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Composant Field réutilisable (wizard local)
// ---------------------------------------------------------------------------

interface FieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  hint?: string;
  monospace?: boolean;
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  hint,
  monospace,
}: FieldProps) {
  const id = label
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <label
        htmlFor={id}
        style={{
          fontSize: 'var(--text-sm)',
          fontWeight: 500,
          color: 'var(--text-secondary)',
        }}
      >
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          height: 36,
          padding: '0 12px',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-base)',
          fontSize: 'var(--text-sm)',
          fontFamily: monospace ? 'var(--font-mono)' : 'inherit',
          background: 'var(--surface-base)',
          color: 'var(--text-primary)',
          outline: 'none',
          boxSizing: 'border-box',
          width: '100%',
        }}
        onFocus={(e) => {
          (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-focus)';
        }}
        onBlur={(e) => {
          (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-default)';
        }}
      />
      {hint && (
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
          {hint}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers date
// ---------------------------------------------------------------------------

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function oneYearFromToday(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().slice(0, 10);
}
