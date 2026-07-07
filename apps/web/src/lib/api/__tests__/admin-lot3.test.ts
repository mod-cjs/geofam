// @vitest-environment node
// Logique pure (pas de DOM) : fonctions exportées sans hook React.

/**
 * Tests — Lot 3 back-office : GESTION UTILISATEURS (création, identité, rôle
 * plateforme, appartenances).
 *
 * DoD §9 : test-first, given/when/then, sentinelle de non-régression.
 * Esprit mutation : chaque test DOIT virer rouge si on supprime la condition
 * correspondante dans la fonction exportée réelle (pas une réimpl locale).
 *
 * Couverture :
 *  - canSubmitCreateUser (CreateUserModal) : email, mot de passe ≥ 8, nom requis
 *  - canSubmitIdentityEdit (UserDetailClient) : validité + garde anti no-op (dirty-check)
 *  - canSubmitPlatformRole (UserDetailClient) : garde anti no-op (dirty-check)
 */

import { describe, it, expect } from 'vitest';

import { canSubmitCreateUser } from '@/components/admin/CreateUserModal';
import { canSubmitIdentityEdit, canSubmitPlatformRole } from '@/components/admin/UserDetailClient';

// ---------------------------------------------------------------------------
// canSubmitCreateUser
// ---------------------------------------------------------------------------

describe('canSubmitCreateUser — validation du formulaire de création', () => {
  it('GIVEN email/mdp/nom valides — WHEN vérification — THEN autorise la soumission', () => {
    expect(
      canSubmitCreateUser({ email: 'a@b.com', password: 'motdepasse', fullName: 'Awa Diop' }),
    ).toBe(true);
  });

  it('GIVEN email invalide (sans @) — WHEN vérification — THEN refuse', () => {
    expect(
      canSubmitCreateUser({ email: 'pas-un-email', password: 'motdepasse', fullName: 'Awa Diop' }),
    ).toBe(false);
  });

  it('GIVEN email sans domaine — WHEN vérification — THEN refuse', () => {
    expect(
      canSubmitCreateUser({ email: 'a@b', password: 'motdepasse', fullName: 'Awa Diop' }),
    ).toBe(false);
  });

  it('GIVEN mot de passe de 7 caractères — WHEN vérification — THEN refuse (< 8)', () => {
    expect(
      canSubmitCreateUser({ email: 'a@b.com', password: '1234567', fullName: 'Awa Diop' }),
    ).toBe(false);
  });

  it('GIVEN mot de passe de 8 caractères pile — WHEN vérification — THEN autorise (borne incluse)', () => {
    expect(
      canSubmitCreateUser({ email: 'a@b.com', password: '12345678', fullName: 'Awa Diop' }),
    ).toBe(true);
  });

  it('GIVEN nom vide (espaces seuls) — WHEN vérification — THEN refuse', () => {
    expect(
      canSubmitCreateUser({ email: 'a@b.com', password: 'motdepasse', fullName: '   ' }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// canSubmitIdentityEdit
// ---------------------------------------------------------------------------

describe('canSubmitIdentityEdit — édition identité (fiche utilisateur)', () => {
  const original = { email: 'a@b.com', fullName: 'Awa Diop' };

  it('GIVEN aucun changement — WHEN vérification — THEN refuse (no-op)', () => {
    expect(
      canSubmitIdentityEdit({ email: original.email, fullName: original.fullName, original }),
    ).toBe(false);
  });

  it('GIVEN email changé et valide — WHEN vérification — THEN autorise', () => {
    expect(
      canSubmitIdentityEdit({ email: 'c@d.com', fullName: original.fullName, original }),
    ).toBe(true);
  });

  it('GIVEN nom changé — WHEN vérification — THEN autorise', () => {
    expect(
      canSubmitIdentityEdit({ email: original.email, fullName: 'Awa D.', original }),
    ).toBe(true);
  });

  it('GIVEN email changé mais invalide — WHEN vérification — THEN refuse', () => {
    expect(
      canSubmitIdentityEdit({ email: 'pas-un-email', fullName: original.fullName, original }),
    ).toBe(false);
  });

  it('GIVEN nom changé mais vide — WHEN vérification — THEN refuse', () => {
    expect(
      canSubmitIdentityEdit({ email: original.email, fullName: '   ', original }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// canSubmitPlatformRole
// ---------------------------------------------------------------------------

describe('canSubmitPlatformRole — changement de rôle plateforme', () => {
  it('GIVEN rôle sélectionné identique au rôle actuel — WHEN vérification — THEN refuse (no-op)', () => {
    expect(canSubmitPlatformRole({ selected: 'SUPERADMIN', current: 'SUPERADMIN' })).toBe(false);
  });

  it('GIVEN aucun rôle actuel et aucun sélectionné (deux null) — WHEN vérification — THEN refuse', () => {
    expect(canSubmitPlatformRole({ selected: null, current: null })).toBe(false);
  });

  it('GIVEN rôle sélectionné différent — WHEN vérification — THEN autorise', () => {
    expect(canSubmitPlatformRole({ selected: 'SUPPORT', current: 'SUPERADMIN' })).toBe(true);
  });

  it('GIVEN révocation (sélection null, rôle actuel présent) — WHEN vérification — THEN autorise', () => {
    expect(canSubmitPlatformRole({ selected: null, current: 'SUPPORT' })).toBe(true);
  });
});
