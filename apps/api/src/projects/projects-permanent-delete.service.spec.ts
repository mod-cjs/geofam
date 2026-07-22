import { ConflictException } from '@nestjs/common';

import type { PrismaService } from '../prisma/prisma.service';
import { tenantStorage } from '../tenant/tenant-context';

import { ProjectsService } from './projects.service';

/**
 * SUPPRESSION DEFINITIVE D'UN PROJET — unitaire dense (la preuve d'isolation
 * REELLE est aux e2e : test/projects-permanent-delete.e2e-spec.ts).
 *
 * PORTEE HONNETE : la base est stubbee ici. Ce fichier prouve la LOGIQUE et la
 * PLOMBERIE (ordre des controles, refus, orgId du contexte ALS) — ni SET LOCAL,
 * ni RLS, ni WITH CHECK, ni CASCADE ne sont exerces. Ne jamais lire ce fichier
 * comme une preuve d'isolation.
 *
 * CE QU'IL VERROUILLE (given/when/then)
 *  #1 projet absent / hors tenant (RLS -> findUnique null) -> `null`, traduit en
 *     404 tenant-safe par le controleur, SANS aucune suppression tentee ;
 *  #2 projet portant >= 1 PV scelle -> ConflictException (409) et AUCUNE
 *     suppression : on n'orpheline jamais un livrable scelle (DoD §5) ;
 *  #3 chemin nominal : enfants supprimes EXPLICITEMENT (calc_snapshots puis
 *     calc_results) AVANT le projet, DANS le meme withTenant — c'est ce qui
 *     soumet chaque DELETE a la policy RLS plutot qu'aux triggers de CASCADE
 *     (qui, eux, ne sont pas soumis a la RLS) ;
 *  #4 aucun calcul -> aucune suppression d'enfant inutile, le projet part quand
 *     meme ;
 *  #5 le LEDGER de facturation n'est JAMAIS touche (append-only) : aucun appel a
 *     usageLedger ni a subscription. Sentinelle : si quelqu'un « nettoie » un
 *     jour la consommation a la suppression, ce test rougit ;
 *  #6 l'ecriture passe par withTenant avec l'orgId du CONTEXTE ALS, jamais une
 *     valeur d'argument ;
 *  #7 ligne devenue invisible entre la lecture et le DELETE (count 0) -> `null`
 *     (404), pas une exception P2025 remontee en 500 ;
 *  #8 le VERROU EXCLUSIF sur la ligne projet est le TOUT PREMIER ordre, AVANT le
 *     comptage des PV — sans cet ordre, le refus #2 est contournable par une
 *     course (une emission de PV en vol s'insere entre le comptage et le DELETE).
 *     La preuve REELLE de la course est a l'e2e : test/pv-delete-race.e2e-spec.ts,
 *     deux transactions entrelacees contre Postgres reel. Ici, sentinelle d'ordre.
 */
const ORG_ID = '33333333-3333-3333-3333-333333333333';

function withOrg<T>(fn: () => Promise<T>): Promise<T> {
  return tenantStorage.run({ orgId: ORG_ID, userId: 'user-1' }, fn);
}

describe('ProjectsService.deletePermanently — suppression définitive', () => {
  let tx: {
    $queryRaw: jest.Mock;
    project: { findUnique: jest.Mock; deleteMany: jest.Mock };
    officialPv: { count: jest.Mock };
    calcResult: { findMany: jest.Mock; deleteMany: jest.Mock };
    calcSnapshot: { deleteMany: jest.Mock };
    usageLedger: { deleteMany: jest.Mock; create: jest.Mock };
    subscription: { updateMany: jest.Mock };
  };
  let prisma: { withTenant: jest.Mock };
  let service: ProjectsService;
  let orgVue: string | undefined;
  let ordre: string[];

  const projet = { id: 'proj-1', orgId: ORG_ID, status: 'ACTIVE' };

  beforeEach(() => {
    orgVue = undefined;
    ordre = [];
    tx = {
      // Verrou explicite `SELECT ... FOR UPDATE` (SQL brut : Prisma n'exprime pas
      // de clause de verrouillage). Il RAMENE la ligne verrouillee, ou rien.
      $queryRaw: jest.fn(() => {
        ordre.push('verrou');
        return Promise.resolve([{ id: 'proj-1' }]);
      }),
      project: {
        findUnique: jest.fn().mockResolvedValue(projet),
        deleteMany: jest.fn(() => {
          ordre.push('project');
          return Promise.resolve({ count: 1 });
        }),
      },
      officialPv: {
        count: jest.fn(() => {
          ordre.push('comptagePv');
          return Promise.resolve(0);
        }),
      },
      calcResult: {
        findMany: jest.fn().mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]),
        deleteMany: jest.fn(() => {
          ordre.push('calcResult');
          return Promise.resolve({ count: 2 });
        }),
      },
      calcSnapshot: {
        deleteMany: jest.fn(() => {
          ordre.push('calcSnapshot');
          return Promise.resolve({ count: 1 });
        }),
      },
      usageLedger: { deleteMany: jest.fn(), create: jest.fn() },
      subscription: { updateMany: jest.fn() },
    };
    prisma = {
      withTenant: jest.fn((orgId: string, cb: (t: typeof tx) => unknown) => {
        orgVue = orgId;
        return cb(tx);
      }),
    };
    service = new ProjectsService(prisma as unknown as PrismaService);
  });

  it('#1 GIVEN un projet absent ou hors tenant (0 ligne verrouillée) — WHEN suppression définitive — THEN null, et RIEN n’est supprimé', async () => {
    // La ligne n'existe pas, ou la RLS la rend INVISIBLE : le SELECT verrouillant
    // ne ramene rien. C'est desormais LUI qui statue sur le 404.
    tx.$queryRaw.mockResolvedValue([]);

    const out = await withOrg(() => service.deletePermanently('proj-x'));

    expect(out).toBeNull();
    // Le 404 ne doit pas masquer une destruction : aucun DELETE n'est meme tente.
    expect(tx.project.deleteMany).not.toHaveBeenCalled();
    expect(tx.calcResult.deleteMany).not.toHaveBeenCalled();
    expect(tx.calcSnapshot.deleteMany).not.toHaveBeenCalled();
    // Ni comptage de PV ni lecture : on sort des le verrou infructueux.
    expect(tx.officialPv.count).not.toHaveBeenCalled();
  });

  it('#1-bis GIVEN une ligne verrouillée mais illisible ensuite — THEN null (fail-closed), aucune suppression', async () => {
    // Cas defensif : le verrou a ramene un id mais la relecture ne rend rien
    // (ne devrait pas arriver — la ligne est figee). On refuse plutot que de
    // supprimer a l'aveugle.
    tx.project.findUnique.mockResolvedValue(null);

    const out = await withOrg(() => service.deletePermanently('proj-1'));

    expect(out).toBeNull();
    expect(tx.project.deleteMany).not.toHaveBeenCalled();
  });

  it('#8 GIVEN une suppression définitive — THEN le VERROU sur le projet est pris AVANT le comptage des PV (sinon le refus 409 est contournable par une course)', async () => {
    await withOrg(() => service.deletePermanently('proj-1'));

    // C'EST LE POINT : compter d'abord puis verrouiller laisserait une emission
    // de PV en vol s'inserer entre les deux — PV scelle, projet detruit. La
    // preuve REELLE de la course est a l'e2e (test/pv-delete-race.e2e-spec.ts) ;
    // cette sentinelle empeche l'ordre d'etre inverse par inadvertance.
    expect(ordre.indexOf('verrou')).toBe(0);
    expect(ordre.indexOf('verrou')).toBeLessThan(ordre.indexOf('comptagePv'));
    // Et le verrou est bien EXCLUSIF (il doit exclure les ecritures partagees).
    const appels = tx.$queryRaw.mock.calls as unknown[][];
    const sql = (appels[0][0] as string[]).join('?').replace(/\s+/g, ' ');
    expect(sql).toContain('FOR UPDATE');
  });

  it('#2 GIVEN un projet portant un PV SCELLÉ — WHEN suppression définitive — THEN 409 et AUCUNE suppression', async () => {
    tx.officialPv.count.mockResolvedValue(2);

    await expect(
      withOrg(() => service.deletePermanently('proj-1')),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(tx.project.deleteMany).not.toHaveBeenCalled();
    expect(tx.calcResult.deleteMany).not.toHaveBeenCalled();
  });

  it('#2-bis GIVEN un refus 409 — THEN le message oriente vers l’archivage (exploitable par l’interface)', async () => {
    tx.officialPv.count.mockResolvedValue(1);

    // Le message doit dire QUOI FAIRE : sans « archivez », l'utilisateur se
    // heurte a une erreur opaque sur un geste qu'il vient d'initier.
    await expect(
      withOrg(() => service.deletePermanently('proj-1')),
    ).rejects.toThrow(/[Aa]rchivez/);
  });

  it('#3 GIVEN un projet avec des calculs — WHEN suppression — THEN enfants d’abord, projet ensuite', async () => {
    const out = await withOrg(() => service.deletePermanently('proj-1'));

    expect(out).toBe(projet);
    // L'ORDRE est le contrat : du plus profond au plus haut, chaque DELETE sous
    // withTenant (donc filtre par la policy RLS), et non par la CASCADE — les
    // triggers d'integrite referentielle, eux, ne sont pas soumis a la RLS.
    expect(ordre).toEqual([
      'verrou',
      'comptagePv',
      'calcSnapshot',
      'calcResult',
      'project',
    ]);
    expect(tx.calcSnapshot.deleteMany).toHaveBeenCalledWith({
      where: { calcResultId: { in: ['c1', 'c2'] } },
    });
    expect(tx.calcResult.deleteMany).toHaveBeenCalledWith({
      where: { projectId: 'proj-1' },
    });
    expect(tx.project.deleteMany).toHaveBeenCalledWith({
      where: { id: 'proj-1' },
    });
  });

  it('#4 GIVEN un projet SANS calcul — WHEN suppression — THEN aucun DELETE d’enfant, le projet part quand même', async () => {
    tx.calcResult.findMany.mockResolvedValue([]);

    const out = await withOrg(() => service.deletePermanently('proj-1'));

    expect(out).toBe(projet);
    expect(tx.calcSnapshot.deleteMany).not.toHaveBeenCalled();
    expect(tx.calcResult.deleteMany).not.toHaveBeenCalled();
    expect(ordre).toEqual(['verrou', 'comptagePv', 'project']);
  });

  it('#5 GIVEN une suppression réussie — THEN le LEDGER de facturation n’est JAMAIS touché (append-only)', async () => {
    await withOrg(() => service.deletePermanently('proj-1'));

    // Le quota deja consomme RESTE consomme. Sentinelle : si quelqu'un « corrige »
    // un jour la consommation a la suppression, ce test rougit.
    expect(tx.usageLedger.deleteMany).not.toHaveBeenCalled();
    expect(tx.usageLedger.create).not.toHaveBeenCalled();
    expect(tx.subscription.updateMany).not.toHaveBeenCalled();
  });

  it('#6 GIVEN un contexte tenant — THEN l’écriture est scopée sur l’orgId du contexte ALS', async () => {
    await withOrg(() => service.deletePermanently('proj-1'));

    expect(prisma.withTenant).toHaveBeenCalledTimes(1);
    // Jamais une valeur fournie par l'appelant : toujours le contexte prouve.
    expect(orgVue).toBe(ORG_ID);
  });

  it('#7 GIVEN une ligne devenue invisible entre la lecture et le DELETE — THEN null (404), pas une exception', async () => {
    tx.project.deleteMany.mockResolvedValue({ count: 0 });

    const out = await withOrg(() => service.deletePermanently('proj-1'));

    // deleteMany (et non delete) : pas de P2025 remontee en 500 sur une course.
    expect(out).toBeNull();
  });
});
