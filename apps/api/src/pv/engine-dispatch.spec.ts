import {
  AXI_FIXTURES,
  PLANE_STRAIN_FIXTURES,
  TRI_RAFT_FIXTURES,
  runAxi,
  runPlaneStrain,
  runTriRaft,
} from '@roadsen/engines';

import {
  ENGINE_DISPATCH,
  findEngineDispatch,
  findEngineDispatchByRegistryId,
} from './engine-dispatch';

/**
 * DISPATCH des moteurs GEOPLAQUE (plane-strain / axi / tri-raft) — cablage TENANT (#63).
 *
 * Prouve que chaque SLUG d'URL route vers le BON moteur (run + contrat + registryId), que
 * le recalcul serveur reussit sur une fixture reelle, et que la resolution inverse
 * (registryId -> dispatch) est coherente. Un mauvais cablage (slug melange, mauvais
 * registryId) rend ce test ROUGE.
 */
describe('engine-dispatch — moteurs GEOPLAQUE (plane-strain / axi / tri-raft)', () => {
  it('route « plane-strain » vers runPlaneStrain (registryId=plane-strain)', () => {
    const d = findEngineDispatch('plane-strain');
    expect(d).toBeDefined();
    expect(d?.run).toBe(runPlaneStrain);
    expect(d?.registryId).toBe('plane-strain');
  });

  it('route « axi » vers runAxi (registryId=axi-plaque)', () => {
    const d = findEngineDispatch('axi');
    expect(d).toBeDefined();
    expect(d?.run).toBe(runAxi);
    expect(d?.registryId).toBe('axi-plaque');
  });

  it('route « tri-raft » vers runTriRaft (registryId=radier-tri)', () => {
    const d = findEngineDispatch('tri-raft');
    expect(d).toBeDefined();
    expect(d?.run).toBe(runTriRaft);
    expect(d?.registryId).toBe('radier-tri');
  });

  it('recalcul serveur reussi via le dispatch sur une fixture reelle de chaque moteur', () => {
    const cases: Array<{ slug: string; input: unknown; engineId: string }> = [
      {
        slug: 'plane-strain',
        input: PLANE_STRAIN_FIXTURES[0]?.input,
        engineId: 'plane-strain',
      },
      { slug: 'axi', input: AXI_FIXTURES[0]?.input, engineId: 'axi-plaque' },
      {
        slug: 'tri-raft',
        input: TRI_RAFT_FIXTURES[0]?.input,
        engineId: 'radier-tri',
      },
    ];
    for (const c of cases) {
      const d = findEngineDispatch(c.slug);
      expect(d).toBeDefined();
      const env = d!.run(c.input);
      // On compare des OBJETS porteurs du slug : en cas d'echec, le message jest montre
      // quel moteur a devie (equivalent au 2e arg de vitest, non supporte par jest).
      expect({ slug: c.slug, ok: env.ok, engineId: env.meta.engineId }).toEqual(
        {
          slug: c.slug,
          ok: true,
          engineId: c.engineId,
        },
      );
    }
  });

  it('resolution inverse registryId -> dispatch coherente', () => {
    expect(findEngineDispatchByRegistryId('plane-strain')?.run).toBe(
      runPlaneStrain,
    );
    expect(findEngineDispatchByRegistryId('axi-plaque')?.run).toBe(runAxi);
    expect(findEngineDispatchByRegistryId('radier-tri')?.run).toBe(runTriRaft);
  });

  it('un slug inconnu ne route vers aucun moteur (fail-closed)', () => {
    expect(findEngineDispatch('geoplaque-inconnu')).toBeUndefined();
    // Les 3 slugs GEOPLAQUE sont bien enregistres (en plus des 6 preexistants).
    expect(Object.keys(ENGINE_DISPATCH)).toEqual(
      expect.arrayContaining(['plane-strain', 'axi', 'tri-raft']),
    );
  });
});
