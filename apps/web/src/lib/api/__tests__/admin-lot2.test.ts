// @vitest-environment node
// Logique pure (pas de DOM) : fonctions exportées sans hook React.

/**
 * Tests — Lot 2 back-office : clé d'idempotence stable + validation client.
 *
 * DoD §9 : test-first, given/when/then, sentinelle de non-régression.
 * Esprit mutation : chaque test DOIT virer rouge si on supprime la condition
 * correspondante dans la fonction exportée réelle (pas une réimpl locale).
 *
 * Couverture :
 *  - resolveIntentionKey : stabilité par intention, renouvellement à la fermeture
 *  - canSubmitTopUp (SubscriptionEditor) : motif obligatoire, delta non nul, confirmation
 *  - canConfirmSuspend (OrgSuspendModal) : recopie exacte du slug
 */

import { describe, it, expect } from 'vitest';

// Clé d'idempotence — logique pure dans la couche API
import { resolveIntentionKey } from '../admin-mutations-client';

// Prédicats RÉELS des composants — si on casse la condition dans le composant,
// le test ci-dessous vire rouge (pas une réimpl locale).
import { canSubmitTopUp } from '@/components/admin/SubscriptionEditor';
import { canConfirmSuspend } from '@/components/admin/OrgSuspendModal';

// ---------------------------------------------------------------------------
// resolveIntentionKey — stabilité de la clé d'idempotence
// ---------------------------------------------------------------------------

describe('resolveIntentionKey — clé d\'idempotence stable par intention', () => {
  it('GIVEN modal fermée — WHEN appel — THEN retourne null', () => {
    // Given/When
    const key = resolveIntentionKey(false, null);
    // Then
    expect(key).toBeNull();
  });

  it('GIVEN modal fermée avec une clé résiduelle — WHEN appel — THEN retourne null (réinitialisation)', () => {
    // Given : modal fermée mais une clé est encore en mémoire (scénario de fermeture)
    const key = resolveIntentionKey(false, 'clé-résiduelle');
    // Then : la clé est abandonnée
    expect(key).toBeNull();
  });

  it('GIVEN modal ouverte sans clé existante — WHEN appel — THEN génère une clé UUID', () => {
    // Given : première ouverture, pas de clé
    const key = resolveIntentionKey(true, null);
    // Then : une clé est générée
    expect(key).not.toBeNull();
    expect(typeof key).toBe('string');
    // UUID v4 : format xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    expect(key).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('GIVEN modal ouverte avec une clé existante — WHEN appel — THEN RÉUTILISE la clé existante (stabilité anti-double-crédit)', () => {
    // Ce test est la sentinelle du double-crédit : ROUGE si resolve régénère à chaque appel.
    // Given : modal déjà ouverte, clé posée lors de l'ouverture
    const existingKey = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    // When : re-render ou retry avec la même intention (modal toujours ouverte)
    const key = resolveIntentionKey(true, existingKey);
    // Then : la clé est INCHANGÉE — même key = idempotence garantie
    expect(key).toBe(existingKey);
  });

  it('GIVEN two successive openings — WHEN première fermeture puis réouverture — THEN clés DIFFÉRENTES (nouvelle intention)', () => {
    // Given : première ouverture
    const key1 = resolveIntentionKey(true, null);
    // Fermeture
    const afterClose = resolveIntentionKey(false, key1);
    expect(afterClose).toBeNull(); // clé abandonnée

    // Réouverture (nouvelle intention)
    const key2 = resolveIntentionKey(true, null); // pas de currentKey = nouvelle intention
    // Then : clé différente de la première (UUID aléatoire)
    // Note : probabilité de collision ≈ 0 (UUID v4 = 122 bits d'entropie)
    expect(key2).not.toBeNull();
    expect(key2).not.toBe(key1);
  });
});

// ---------------------------------------------------------------------------
// canSubmitTopUp — prédicat RÉEL de SubscriptionEditor (pas une réimpl)
// ---------------------------------------------------------------------------

describe('canSubmitTopUp (SubscriptionEditor) — guard motif + delta + confirmation', () => {
  it('GIVEN motif vide — WHEN canSubmitTopUp — THEN false (motif obligatoire)', () => {
    // Sentinelle : vire rouge si on retire la condition motifValid dans canSubmitTopUp
    expect(canSubmitTopUp({ delta: '50', motif: '', confirmed: true })).toBe(false);
    expect(canSubmitTopUp({ delta: '50', motif: '   ', confirmed: true })).toBe(false);
  });

  it('GIVEN delta nul — WHEN canSubmitTopUp — THEN false (delta=0 n\'a pas de sens)', () => {
    // Sentinelle : vire rouge si on retire parsedDelta !== 0
    expect(canSubmitTopUp({ delta: '0', motif: 'virement client', confirmed: true })).toBe(false);
  });

  it('GIVEN delta NaN — WHEN canSubmitTopUp — THEN false', () => {
    // Sentinelle : vire rouge si on retire !isNaN(parsed)
    expect(canSubmitTopUp({ delta: '', motif: 'virement client', confirmed: true })).toBe(false);
    expect(canSubmitTopUp({ delta: 'abc', motif: 'virement client', confirmed: true })).toBe(false);
  });

  it('GIVEN confirmation non cochée — WHEN canSubmitTopUp — THEN false', () => {
    // Sentinelle : vire rouge si on retire la condition confirmed
    expect(canSubmitTopUp({ delta: '50', motif: 'virement client', confirmed: false })).toBe(false);
  });

  it('GIVEN delta valide + motif non vide + confirmation — WHEN canSubmitTopUp — THEN true', () => {
    expect(canSubmitTopUp({ delta: '50', motif: 'virement client 05/07', confirmed: true })).toBe(true);
    expect(canSubmitTopUp({ delta: '-10', motif: 'correction erreur saisie', confirmed: true })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// canConfirmSuspend — prédicat RÉEL de OrgSuspendModal (pas une réimpl)
// ---------------------------------------------------------------------------

describe('canConfirmSuspend (OrgSuspendModal) — guard recopie du slug', () => {
  it('GIVEN slug incorrect — WHEN canConfirmSuspend — THEN false', () => {
    // Sentinelle : vire rouge si on retire la comparaison stricte slug === orgSlug
    expect(canConfirmSuspend('mon-org-typo', 'mon-org')).toBe(false);
    expect(canConfirmSuspend('', 'mon-org')).toBe(false);
    expect(canConfirmSuspend('MON-ORG', 'mon-org')).toBe(false); // sensible à la casse
  });

  it('GIVEN slug exact — WHEN canConfirmSuspend — THEN true', () => {
    expect(canConfirmSuspend('mon-org', 'mon-org')).toBe(true);
  });

  it('GIVEN slug avec espaces entourants — WHEN canConfirmSuspend — THEN true (trim)', () => {
    // Sentinelle : vire rouge si on retire le .trim()
    expect(canConfirmSuspend('  mon-org  ', 'mon-org')).toBe(true);
  });
});
