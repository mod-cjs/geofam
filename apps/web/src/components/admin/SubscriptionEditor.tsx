'use client';

/**
 * SubscriptionEditor — mutations abonnement (Lot 2).
 *
 * Trois actions disponibles depuis l'onglet Abonnement :
 *  1. Top-up : ajuste le quota (delta + motif OBLIGATOIRE + confirmation).
 *  2. Renouvellement : nouvelle fenêtre (dateDebut/dateFin) + reset consommation.
 *  3. Entitlements : édition du pack et des modules débloqués.
 *
 * Idempotence : chaque ouverture de modal génère une clé stable (resolveIntentionKey).
 * Un double-clic ou retry n'entraîne pas de double-crédit.
 *
 * Confidentialité DoD §8 : aucun import @roadsen/engines.
 */

import { useEffect, useId, useRef, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { QuotaBar } from './QuotaBar';
import {
  clientAttachSubscription,
  clientSetEntitlements,
  clientRenew,
  clientTopUp,
} from '@/lib/api/admin-mutations-client';
import type { AdminOrgDetail, OrgSubscriptionDetail } from '@/lib/api/admin-server';

// Modules connus. Le `slug` STOCKÉ dans les entitlements DOIT être le slug de GATE du
// calcul (celui que SubscriptionGuard/assertAccess vérifie), PAS le nom du logiciel.
// Bug corrigé (E2E modules/packs) : l'UI stockait casagrande/geoplaque/pressiopro/fastlab
// alors que le gate attend pieux/radier/pressiometre/labo -> ces modules « cochés »
// restaient gatés 403. On stocke le slug, on AFFICHE un libellé lisible.
const ALL_ENTITLEMENTS = [
  { slug: 'burmister', label: 'ROADSENS — Chaussées' },
  { slug: 'terzaghi', label: 'Terzaghi — Fondations superficielles' },
  { slug: 'pieux', label: 'CASAGRANDE — Pieux' },
  { slug: 'radier', label: 'GEOPLAQUE — Radier & plaque' },
  { slug: 'pressiometre', label: 'PressioPro — Pressiomètre' },
  { slug: 'labo', label: 'FASTLAB — Labo GTR' },
] as const;

const PACKS = ['ROUTES', 'FONDATIONS', 'COMPLETE'] as const;

interface SubscriptionEditorProps {
  orgId: string;
  subscription: OrgSubscriptionDetail | null;
  onMutated: (detail: AdminOrgDetail) => void;
}

export function SubscriptionEditor({
  orgId,
  subscription,
  onMutated,
}: SubscriptionEditorProps) {
  const [openModal, setOpenModal] = useState<
    'topup' | 'renew' | 'entitlements' | 'attach' | null
  >(null);

  function closeModal() {
    setOpenModal(null);
  }

  return (
    <div>
      {/* Lecture abonnement */}
      {subscription ? (
        <SubscriptionReadView subscription={subscription} />
      ) : (
        <p
          style={{
            padding: '20px 24px',
            color: 'var(--text-muted)',
            fontSize: 'var(--text-sm)',
            margin: 0,
          }}
        >
          Aucun abonnement provisionné. L&apos;organisation ne peut pas calculer tant
          qu&apos;un abonnement n&apos;est pas posé.
        </p>
      )}

      {/* Actions */}
      <div
        style={{
          padding: '16px 24px',
          borderTop: '1px solid var(--border-subtle)',
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        {subscription ? (
          <>
            <Button variant="action" size="sm" onClick={() => setOpenModal('topup')}>
              Ajuster le quota
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setOpenModal('renew')}>
              Renouveler
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setOpenModal('entitlements')}>
              Modules
            </Button>
          </>
        ) : (
          <Button variant="action" size="sm" onClick={() => setOpenModal('attach')}>
            Rattacher un abonnement
          </Button>
        )}
      </div>

      {/* Modales */}
      <TopUpModal
        open={openModal === 'topup'}
        orgId={orgId}
        subscription={subscription}
        onClose={closeModal}
        onMutated={onMutated}
      />
      <RenewModal
        open={openModal === 'renew'}
        orgId={orgId}
        onClose={closeModal}
        onMutated={onMutated}
      />
      <EntitlementsModal
        open={openModal === 'entitlements'}
        orgId={orgId}
        subscription={subscription}
        onClose={closeModal}
        onMutated={onMutated}
      />
      <AttachModal
        open={openModal === 'attach'}
        orgId={orgId}
        onClose={closeModal}
        onMutated={onMutated}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lecture (réutilise l'affichage Lot 1 en dl)
// ---------------------------------------------------------------------------

function SubscriptionReadView({ subscription }: { subscription: OrgSubscriptionDetail }) {
  const rows: { label: string; value: React.ReactNode }[] = [
    { label: 'Pack', value: subscription.pack },
    {
      label: 'Quota',
      value: (
        <QuotaBar
          consommation={subscription.consommation}
          quota={subscription.quota}
          width={160}
        />
      ),
    },
    { label: 'Consommation', value: `${subscription.consommation} unités` },
    { label: 'Restant', value: `${subscription.remaining} unités` },
    {
      label: 'Expiration',
      value: (
        <span
          style={{
            color: subscription.expired ? 'var(--status-fail-tx)' : 'inherit',
            fontWeight: subscription.expired ? 500 : 400,
          }}
        >
          {formatDate(subscription.dateFin)}
          {subscription.expired && ' — expiré'}
        </span>
      ),
    },
  ];

  return (
    <dl
      style={{
        display: 'grid',
        gridTemplateColumns: '160px 1fr',
        gap: '1px',
        padding: 0,
        margin: 0,
      }}
    >
      {rows.map(({ label, value }) => (
        <React.Fragment key={label}>
          <dt
            style={{
              padding: '12px 16px',
              fontSize: 'var(--text-sm)',
              color: 'var(--text-secondary)',
              fontWeight: 500,
              borderBottom: '1px solid var(--border-subtle)',
              background: 'rgba(0,0,0,0.01)',
            }}
          >
            {label}
          </dt>
          <dd
            style={{
              padding: '12px 16px',
              fontSize: 'var(--text-sm)',
              color: 'var(--text-primary)',
              borderBottom: '1px solid var(--border-subtle)',
              margin: 0,
            }}
          >
            {value}
          </dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

// ---------------------------------------------------------------------------
// Modal top-up
// ---------------------------------------------------------------------------

function TopUpModal({
  open,
  orgId,
  subscription,
  onClose,
  onMutated,
}: {
  open: boolean;
  orgId: string;
  subscription: OrgSubscriptionDetail | null;
  onClose: () => void;
  onMutated: (detail: AdminOrgDetail) => void;
}) {
  // Clé stable par intention : générée à l'ouverture de la modal, effacée à la fermeture.
  // On n'écrit jamais dans ref.current pendant le render (react-hooks/refs).
  const intentionKeyRef = useRef<string | null>(null);

  const [delta, setDelta] = useState('');
  const [motif, setMotif] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const deltaId = useId();
  const motifId = useId();
  const confirmId = useId();

  // Gérer la clé d'idempotence et réinitialiser les champs à chaque ouverture/fermeture.
  useEffect(() => {
    if (open) {
      // Nouvelle intention : générer une clé seulement si la modal vient de s'ouvrir.
      if (!intentionKeyRef.current) {
        intentionKeyRef.current = crypto.randomUUID();
      }
      setDelta('');
      setMotif('');
      setConfirmed(false);
      setError(undefined);
    } else {
      // Fermeture : libérer la clé pour la prochaine intention.
      intentionKeyRef.current = null;
    }
  }, [open]);

  const parsedDelta = parseInt(delta, 10);
  const canSubmit = canSubmitTopUp({ delta, motif, confirmed }) && !loading;

  const newQuota = subscription && !isNaN(parsedDelta) && parsedDelta !== 0
    ? subscription.quota + parsedDelta
    : null;

  async function handleSubmit() {
    if (!canSubmit || !intentionKeyRef.current) return;
    setLoading(true);
    setError(undefined);
    try {
      const detail = await clientTopUp(
        orgId,
        { delta: parsedDelta, motif: motif.trim() },
        intentionKeyRef.current,
      );
      onMutated(detail);
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
      title="Ajuster le quota"
      description={
        subscription
          ? `Quota actuel : ${subscription.quota} unités — Consommation : ${subscription.consommation}`
          : 'Aucun abonnement en place.'
      }
      size="sm"
      loading={loading}
      error={error}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={loading}>
            Annuler
          </Button>
          <Button
            variant="action"
            size="sm"
            onClick={handleSubmit}
            disabled={!canSubmit}
            loading={loading}
          >
            Confirmer l&apos;ajustement
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Delta */}
        <div>
          <label
            htmlFor={deltaId}
            style={{
              display: 'block',
              fontSize: 12,
              fontWeight: 500,
              color: 'var(--text-secondary)',
              marginBottom: 4,
            }}
          >
            Delta <span aria-hidden="true" style={{ color: 'var(--status-fail-tx)' }}>*</span>
            <span style={{ fontWeight: 400, marginLeft: 4, color: 'var(--text-muted)' }}>
              (négatif = baisse, positif = hausse)
            </span>
          </label>
          <input
            id={deltaId}
            type="number"
            value={delta}
            onChange={(e) => setDelta(e.target.value)}
            placeholder="ex. 50 ou -20"
            style={fieldStyle}
            aria-describedby={`${deltaId}-hint`}
          />
          {newQuota !== null && (
            <p
              id={`${deltaId}-hint`}
              style={{
                fontSize: 12,
                color:
                  subscription && newQuota < subscription.consommation
                    ? 'var(--status-fail-tx)'
                    : 'var(--text-muted)',
                marginTop: 4,
              }}
            >
              Quota résultant : <strong>{newQuota}</strong> unités
              {subscription && newQuota < subscription.consommation &&
                ' — inférieur à la consommation engagée (le backend refusera)'}
            </p>
          )}
        </div>

        {/* Motif obligatoire */}
        <div>
          <label
            htmlFor={motifId}
            style={{
              display: 'block',
              fontSize: 12,
              fontWeight: 500,
              color: 'var(--text-secondary)',
              marginBottom: 4,
            }}
          >
            Motif <span aria-hidden="true" style={{ color: 'var(--status-fail-tx)' }}>*</span>
          </label>
          <textarea
            id={motifId}
            value={motif}
            onChange={(e) => setMotif(e.target.value)}
            placeholder="Ex. : Virement client 05/07 — facture F-2026-042"
            rows={3}
            maxLength={500}
            style={{ ...fieldStyle, resize: 'vertical', height: 'auto' }}
          />
          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            {motif.length}/500 — consigné dans le journal d&apos;audit
          </p>
        </div>

        {/* Confirmation explicite */}
        <label
          htmlFor={confirmId}
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 8,
            cursor: 'pointer',
            fontSize: 'var(--text-sm)',
            color: 'var(--text-primary)',
          }}
        >
          <input
            id={confirmId}
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            style={{ marginTop: 2, flexShrink: 0 }}
          />
          Je confirme cet ajustement de quota.
        </label>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Modal renouvellement
// ---------------------------------------------------------------------------

function RenewModal({
  open,
  orgId,
  onClose,
  onMutated,
}: {
  open: boolean;
  orgId: string;
  onClose: () => void;
  onMutated: (detail: AdminOrgDetail) => void;
}) {
  const intentionKeyRef = useRef<string | null>(null);

  const [dateDebut, setDateDebut] = useState('');
  const [dateFin, setDateFin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const debutId = useId();
  const finId = useId();

  useEffect(() => {
    if (open) {
      if (!intentionKeyRef.current) {
        intentionKeyRef.current = crypto.randomUUID();
      }
      setDateDebut(today());
      setDateFin(oneYearFromToday());
      setError(undefined);
    } else {
      intentionKeyRef.current = null;
    }
  }, [open]);

  const canSubmit =
    dateDebut.length > 0 && dateFin.length > 0 && dateFin >= dateDebut && !loading;

  async function handleSubmit() {
    if (!canSubmit || !intentionKeyRef.current) return;
    setLoading(true);
    setError(undefined);
    try {
      const detail = await clientRenew(
        orgId,
        { dateDebut, dateFin },
        intentionKeyRef.current,
      );
      onMutated(detail);
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
      title="Renouveler l'abonnement"
      size="sm"
      loading={loading}
      error={error}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={loading}>
            Annuler
          </Button>
          <Button
            variant="action"
            size="sm"
            onClick={handleSubmit}
            disabled={!canSubmit}
            loading={loading}
          >
            Confirmer le renouvellement
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Avertissement reset consommation */}
        <div
          role="note"
          style={{
            background: 'var(--status-warn-bg, rgba(255,193,7,0.1))',
            border: '1px solid var(--status-warn-bd, rgba(255,193,7,0.4))',
            borderRadius: 'var(--radius-base)',
            padding: '10px 12px',
            fontSize: 13,
            color: 'var(--text-primary)',
          }}
        >
          Le renouvellement remet la consommation à 0 et ouvre une nouvelle fenêtre.
          Le quota reste inchangé.
        </div>

        <div>
          <label
            htmlFor={debutId}
            style={labelStyle}
          >
            Date de début <span aria-hidden="true" style={{ color: 'var(--status-fail-tx)' }}>*</span>
          </label>
          <input
            id={debutId}
            type="date"
            value={dateDebut}
            onChange={(e) => setDateDebut(e.target.value)}
            style={fieldStyle}
          />
        </div>

        <div>
          <label
            htmlFor={finId}
            style={labelStyle}
          >
            Date de fin <span aria-hidden="true" style={{ color: 'var(--status-fail-tx)' }}>*</span>
          </label>
          <input
            id={finId}
            type="date"
            value={dateFin}
            onChange={(e) => setDateFin(e.target.value)}
            min={dateDebut}
            style={fieldStyle}
          />
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Modal entitlements
// ---------------------------------------------------------------------------

function EntitlementsModal({
  open,
  orgId,
  subscription,
  onClose,
  onMutated,
}: {
  open: boolean;
  orgId: string;
  subscription: OrgSubscriptionDetail | null;
  onClose: () => void;
  onMutated: (detail: AdminOrgDetail) => void;
}) {
  const intentionKeyRef = useRef<string | null>(null);

  // Vérité serveur : `subscription.entitlements` (colonne subscriptions.entitlements),
  // JAMAIS re-approximée depuis PACK_ENTITLEMENTS[pack] — l'ancienne logique écrasait
  // les vrais entitlements à l'enregistrement (BLOQUANT corrigé ici, cf. commentaire
  // au-dessus de OrgSubscriptionDetail).
  const entitlementsAvailable = Array.isArray(subscription?.entitlements);

  const [pack, setPack] = useState(subscription?.pack ?? 'COMPLETE');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const packId = useId();

  useEffect(() => {
    if (open) {
      if (!intentionKeyRef.current) {
        intentionKeyRef.current = crypto.randomUUID();
      }
      setPack(subscription?.pack ?? 'COMPLETE');
      // Initialiser DEPUIS la vérité serveur. Si elle n'est pas disponible
      // (subscription null / champ absent d'une réponse mise en cache), on part
      // d'un ensemble vide et le bouton Enregistrer reste désactivé plus bas —
      // jamais d'écrasement silencieux par une approximation pack.
      setSelected(new Set(subscription?.entitlements ?? []));
      setError(undefined);
    } else {
      intentionKeyRef.current = null;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function toggleEntitlement(e: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(e)) next.delete(e);
      else next.add(e);
      return next;
    });
  }

  // Action EXPLICITE : propose les modules du pack sélectionné (n'écrase jamais
  // silencieusement — l'utilisateur clique délibérément pour appliquer).
  function applyPackDefaults() {
    setSelected(new Set(PACK_ENTITLEMENTS[pack] ?? []));
  }

  async function handleSubmit() {
    if (loading || !intentionKeyRef.current || !entitlementsAvailable) return;
    setLoading(true);
    setError(undefined);
    try {
      const detail = await clientSetEntitlements(
        orgId,
        { pack, entitlements: Array.from(selected) },
        intentionKeyRef.current,
      );
      onMutated(detail);
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
      title="Modules débloqués"
      size="sm"
      loading={loading}
      error={error}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={loading}>
            Annuler
          </Button>
          <Button
            variant="action"
            size="sm"
            onClick={handleSubmit}
            disabled={loading || !entitlementsAvailable}
            loading={loading}
          >
            Enregistrer
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {!entitlementsAvailable && (
          <div
            role="alert"
            style={{
              background: 'var(--status-warn-bg, rgba(255,193,7,0.1))',
              border: '1px solid var(--status-warn-bd, rgba(255,193,7,0.4))',
              borderRadius: 'var(--radius-base)',
              padding: '10px 12px',
              fontSize: 13,
              color: 'var(--text-primary)',
            }}
          >
            Liste des modules indisponible pour cette organisation — enregistrement
            désactivé (pour ne pas écraser les modules réels avec une approximation).
          </div>
        )}

        {/* Pack */}
        <div>
          <label htmlFor={packId} style={labelStyle}>
            Pack
          </label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select
              id={packId}
              value={pack}
              onChange={(e) => setPack(e.target.value)}
              style={{ ...fieldStyle, flex: 1 }}
            >
              {PACKS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <Button variant="ghost" size="sm" onClick={applyPackDefaults}>
              Appliquer les modules du pack
            </Button>
          </div>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '4px 0 0' }}>
            Changer le pack ne modifie pas la sélection ci-dessous — cliquez sur
            « Appliquer les modules du pack » pour la remplacer.
          </p>
        </div>

        {/* Modules */}
        <fieldset
          disabled={!entitlementsAvailable}
          style={{ border: 'none', padding: 0, margin: 0 }}
        >
          <legend
            style={{
              fontSize: 12,
              fontWeight: 500,
              color: 'var(--text-secondary)',
              marginBottom: 8,
            }}
          >
            Modules
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
                }}
              >
                <input
                  type="checkbox"
                  checked={selected.has(e.slug)}
                  onChange={() => toggleEntitlement(e.slug)}
                />
                {e.label}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Prédicats de validation exportés (testables en isolation — DoD §9)
// ---------------------------------------------------------------------------

/**
 * Prédicat de soumission du formulaire top-up.
 * Exporté pour que les tests couvrent le VRAI prédicat utilisé dans le composant.
 * `loading` exclu : le composant le combine localement pour ne pas l'exposer au test.
 */
export function canSubmitTopUp({
  delta,
  motif,
  confirmed,
}: {
  delta: string;
  motif: string;
  confirmed: boolean;
}): boolean {
  const parsed = parseInt(delta, 10);
  const deltaValid = !isNaN(parsed) && parsed !== 0;
  const motifValid = motif.trim().length > 0;
  return deltaValid && motifValid && confirmed;
}

// ---------------------------------------------------------------------------
// Constantes partagées (même que le wizard)
// ---------------------------------------------------------------------------

// Slugs de GATE (= ceux vérifiés par SubscriptionGuard), pas les noms de logiciels.
const PACK_ENTITLEMENTS: Record<string, string[]> = {
  ROUTES: ['burmister'],
  FONDATIONS: ['terzaghi', 'pieux', 'radier', 'pressiometre'],
  COMPLETE: ['burmister', 'terzaghi', 'pieux', 'radier', 'pressiometre', 'labo'],
};

// ---------------------------------------------------------------------------
// Styles inline partagés
// ---------------------------------------------------------------------------

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

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  fontWeight: 500,
  color: 'var(--text-secondary)',
  marginBottom: 4,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function oneYearFromToday(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

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

// ---------------------------------------------------------------------------
// Modal : RATTACHER un abonnement à une org existante SANS abo (Vague 2)
// ---------------------------------------------------------------------------

function AttachModal({
  open,
  orgId,
  onClose,
  onMutated,
}: {
  open: boolean;
  orgId: string;
  onClose: () => void;
  onMutated: (detail: AdminOrgDetail) => void;
}) {
  const [pack, setPack] = useState<'ROUTES' | 'FONDATIONS' | 'COMPLETE'>('COMPLETE');
  const [quota, setQuota] = useState('1000');
  const [dateDebut, setDateDebut] = useState(today());
  const [dateFin, setDateFin] = useState(oneYearFromToday());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const quotaNum = Number.parseInt(quota, 10);
  const canSubmit =
    Number.isInteger(quotaNum) && quotaNum >= 0 && dateDebut <= dateFin && !loading;

  async function handleSubmit() {
    setError(undefined);
    setLoading(true);
    try {
      const detail = await clientAttachSubscription(
        orgId,
        {
          pack,
          entitlements: PACK_ENTITLEMENTS[pack] ?? [],
          quota: quotaNum,
          dateDebut,
          dateFin,
        },
        crypto.randomUUID(),
      );
      onMutated(detail);
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
      title="Rattacher un abonnement"
      description="Provisionne un abonnement pour une organisation qui n'en a pas. Refusé si un abonnement actif existe déjà."
      size="sm"
      loading={loading}
      error={error}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={loading}>
            Annuler
          </Button>
          <Button
            variant="action"
            size="sm"
            onClick={handleSubmit}
            disabled={!canSubmit}
            loading={loading}
          >
            Rattacher
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label style={labelStyle}>Pack</label>
          <select
            value={pack}
            onChange={(e) => setPack(e.target.value as 'ROUTES' | 'FONDATIONS' | 'COMPLETE')}
            style={fieldStyle}
          >
            <option value="ROUTES">ROUTES</option>
            <option value="FONDATIONS">FONDATIONS</option>
            <option value="COMPLETE">COMPLETE</option>
          </select>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '4px 0 0' }}>
            Modules : {(PACK_ENTITLEMENTS[pack] ?? []).join(', ')}
          </p>
        </div>
        <div>
          <label style={labelStyle}>Quota (unités)</label>
          <input
            type="number"
            min={0}
            value={quota}
            onChange={(e) => setQuota(e.target.value)}
            style={fieldStyle}
          />
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Début</label>
            <input
              type="date"
              value={dateDebut}
              onChange={(e) => setDateDebut(e.target.value)}
              style={fieldStyle}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Fin</label>
            <input
              type="date"
              value={dateFin}
              onChange={(e) => setDateFin(e.target.value)}
              style={fieldStyle}
            />
          </div>
        </div>
      </div>
    </Modal>
  );
}

// React needed for JSX Fragment in SubscriptionReadView
import React from 'react';
