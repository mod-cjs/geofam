// @vitest-environment node
// Logique pure (pas de DOM) : resolveOwnerUserId est une fonction async exported.

/**
 * Tests — Reprise du wizard onboarding (anti-user-orphelin).
 *
 * DoD §9 : test-first, given/when/then, sentinelle de non-régression.
 *
 * Couverture :
 *  - Première soumission : createUser appelé, userId retourné (wasCreated=true)
 *  - Reprise (createdUserId déjà posé) : createUser NON rappelé, id réutilisé
 *  - User sélectionné via recherche : createUser NON appelé
 *  - Mode search sans sélection : erreur explicite (pas de tentative de création)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// next/navigation n'est pas utilisé directement ici — pas de mock nécessaire.
// next/headers idem : resolveOwnerUserId ne lit pas les cookies.
// Les composants React et l'API client ne sont pas importés → pas de mock.

import { resolveOwnerUserId } from '../page';
import type { WizardOwnerState } from '../page';
import type { AdminUserView } from '@/lib/api/admin-server';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeCreateState(override: Partial<WizardOwnerState> = {}): WizardOwnerState {
  return {
    ownerMode: 'create',
    ownerSelected: null,
    createdUserId: null,
    newUserEmail: 'amadou@example.com',
    newUserPassword: 'motdepasse123',
    newUserFullName: 'Amadou Diallo',
    ...override,
  };
}

const MOCK_USER: AdminUserView = {
  userId: 'usr_existing',
  email: 'amadou@example.com',
  fullName: 'Amadou Diallo',
  platformRole: null,
  isActive: true,
  nbOrgs: 1,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('resolveOwnerUserId — reprise wizard (§1.3 anti-user-orphelin)', () => {
  const mockCreateUser = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GIVEN mode create sans createdUserId — WHEN première soumission — THEN createUser appelé, wasCreated=true', async () => {
    // Given
    mockCreateUser.mockResolvedValue({ userId: 'usr_new' });
    const state = makeCreateState({ createdUserId: null });

    // When
    const result = await resolveOwnerUserId(state, mockCreateUser);

    // Then
    expect(result.userId).toBe('usr_new');
    expect(result.wasCreated).toBe(true);
    expect(mockCreateUser).toHaveBeenCalledTimes(1);
    expect(mockCreateUser).toHaveBeenCalledWith({
      email: 'amadou@example.com',
      password: 'motdepasse123',
      fullName: 'Amadou Diallo',
    });
  });

  it('GIVEN createdUserId déjà posé (reprise après échec org) — WHEN resoumission — THEN createUser NON rappelé, userId réutilisé', async () => {
    // Ce test est la sentinelle du bug de reprise : ROUGE avant le fix, VERT après.
    // Given : createdUserId posé → user déjà créé lors d'une tentative précédente
    const state = makeCreateState({ createdUserId: 'usr_precedent' });

    // When
    const result = await resolveOwnerUserId(state, mockCreateUser);

    // Then : l'id existant est réutilisé SANS recréer le user
    expect(result.userId).toBe('usr_precedent');
    expect(result.wasCreated).toBe(false);
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it('GIVEN ownerSelected via recherche — WHEN résolution — THEN createUser NON appelé, id du user sélectionné retourné', async () => {
    // Given
    const state = makeCreateState({
      ownerMode: 'search',
      ownerSelected: MOCK_USER,
      createdUserId: null,
    });

    // When
    const result = await resolveOwnerUserId(state, mockCreateUser);

    // Then
    expect(result.userId).toBe('usr_existing');
    expect(result.wasCreated).toBe(false);
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it('GIVEN mode search sans sélection et sans createdUserId — WHEN résolution — THEN erreur explicite (ne tente pas createUser)', async () => {
    // Given : mode search, aucun user sélectionné
    const state = makeCreateState({
      ownerMode: 'search',
      ownerSelected: null,
      createdUserId: null,
    });

    // When / Then
    await expect(resolveOwnerUserId(state, mockCreateUser)).rejects.toThrow(
      "Impossible de déterminer l'OWNER.",
    );
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it('GIVEN ownerSelected ET createdUserId posés — WHEN résolution — THEN ownerSelected prime (sélection explicite)', async () => {
    // Given : sélection recherche + createdUserId résiduel (état théorique)
    const state = makeCreateState({
      ownerMode: 'search',
      ownerSelected: MOCK_USER,
      createdUserId: 'usr_ancien',
    });

    // When
    const result = await resolveOwnerUserId(state, mockCreateUser);

    // Then : ownerSelected prime
    expect(result.userId).toBe('usr_existing');
    expect(result.wasCreated).toBe(false);
    expect(mockCreateUser).not.toHaveBeenCalled();
  });
});
