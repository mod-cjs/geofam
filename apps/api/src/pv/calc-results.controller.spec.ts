import { ConflictException, NotFoundException } from '@nestjs/common';

import type { CalcResultsService } from './calc-results.service';
import type { CalcSnapshotsService } from './calc-snapshots.service';
import { PvController } from './pv.controller';
import type { PvService } from './pv.service';

/**
 * PvController — routes de LECTURE des calc_results (master-detail, AUDIT swap
 * mock->reel) : GET /projects/:projectId/calc-results et
 * GET /projects/:projectId/calc-results/:calcId.
 *
 * Couche controleur : on prouve que le controleur delegue au service avec les
 * bons parametres (scope projet) et qu'il PROPAGE le 404 tenant-safe du service
 * (calcul absent / hors tenant / autre projet -> meme 404 « introuvable »), sans
 * jamais re-mapper l'erreur ni divulguer la cause. La preuve d'isolation REELLE
 * (RLS, cross-org -> 404 ; autre projet meme org -> 404) est aux e2e (qa-test) :
 * ici, aucun faux-vert d'integration n'est fabrique (services mockes).
 */
describe('PvController — lecture calc_results (master-detail)', () => {
  let calcResults: {
    listForProject: jest.Mock;
    getForProject: jest.Mock;
    rename: jest.Mock;
    deleteUnsealed: jest.Mock;
  };
  let pvSvc: { rename: jest.Mock; emitFromCalc: jest.Mock };
  let controller: PvController;

  beforeEach(() => {
    jest.clearAllMocks();
    calcResults = {
      listForProject: jest.fn(),
      getForProject: jest.fn(),
      rename: jest.fn(),
      deleteUnsealed: jest.fn(),
    };
    pvSvc = { rename: jest.fn(), emitFromCalc: jest.fn() };
    // CalcSnapshotsService non sollicite par ces routes : stub minimal.
    const snapshots = {} as unknown as CalcSnapshotsService;
    controller = new PvController(
      calcResults as unknown as CalcResultsService,
      snapshots,
      pvSvc as unknown as PvService,
    );
  });

  describe('GET /calc-results — liste du projet', () => {
    it('given un projet : delegue listForProject(projectId) et renvoie la liste', async () => {
      const rows = [{ id: 'calc-1' }, { id: 'calc-2' }];
      calcResults.listForProject.mockResolvedValue(rows);

      await expect(controller.listCalcResults('proj-1')).resolves.toBe(rows);
      expect(calcResults.listForProject).toHaveBeenCalledWith('proj-1');
    });

    it('given un projet sans calcul (ou hors tenant) : renvoie [] (tenant-safe, pas d erreur)', async () => {
      calcResults.listForProject.mockResolvedValue([]);

      await expect(controller.listCalcResults('proj-vide')).resolves.toEqual(
        [],
      );
    });
  });

  describe('GET /calc-results/:calcId — detail', () => {
    it('given un calcul du projet : delegue getForProject({projectId, calcResultId}) et le renvoie', async () => {
      const calc = { id: 'calc-1', projectId: 'proj-1' };
      calcResults.getForProject.mockResolvedValue(calc);

      await expect(controller.getCalcResult('proj-1', 'calc-1')).resolves.toBe(
        calc,
      );
      expect(calcResults.getForProject).toHaveBeenCalledWith({
        projectId: 'proj-1',
        calcResultId: 'calc-1',
      });
    });

    it('given un calcul absent/hors tenant/autre projet : PROPAGE le 404 du service (tenant-safe)', async () => {
      // Le service leve un NotFound borne pour TOUS ces cas (cf.
      // CalcResultsService.getForProject). Le controleur ne doit pas l'avaler ni
      // le re-mapper -> il remonte tel quel.
      calcResults.getForProject.mockRejectedValue(
        new NotFoundException(
          'Calcul introuvable dans ce projet/cette organisation.',
        ),
      );

      await expect(
        controller.getCalcResult('proj-1', 'calc-fantome'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('PATCH /calc-results/:id — renommage (0027)', () => {
    it('given le service renvoie la ligne : delegue rename({projectId, calcResultId, name}) et la renvoie', async () => {
      const calc = { id: 'calc-1', name: 'Variante' };
      calcResults.rename.mockResolvedValue(calc);
      await expect(
        controller.renameCalcResult('proj-1', 'calc-1', { name: 'Variante' }),
      ).resolves.toBe(calc);
      expect(calcResults.rename).toHaveBeenCalledWith({
        projectId: 'proj-1',
        calcResultId: 'calc-1',
        name: 'Variante',
      });
    });

    it('given name=null : transmis tel quel (retour mnemonique)', async () => {
      calcResults.rename.mockResolvedValue({ id: 'calc-1', name: null });
      await controller.renameCalcResult('proj-1', 'calc-1', { name: null });
      expect(calcResults.rename).toHaveBeenCalledWith({
        projectId: 'proj-1',
        calcResultId: 'calc-1',
        name: null,
      });
    });

    it('given service null (absent / hors tenant / autre projet) : 404 tenant-safe', async () => {
      calcResults.rename.mockResolvedValue(null);
      await expect(
        controller.renameCalcResult('proj-1', 'fantome', { name: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('DELETE /calc-results/:id — suppression (0027)', () => {
    it('given le service renvoie la ligne : delegue deleteUnsealed et la renvoie', async () => {
      const calc = { id: 'calc-1' };
      calcResults.deleteUnsealed.mockResolvedValue(calc);
      await expect(
        controller.deleteCalcResult('proj-1', 'calc-1'),
      ).resolves.toBe(calc);
      expect(calcResults.deleteUnsealed).toHaveBeenCalledWith({
        projectId: 'proj-1',
        calcResultId: 'calc-1',
      });
    });

    it('given service null : 404 tenant-safe', async () => {
      calcResults.deleteUnsealed.mockResolvedValue(null);
      await expect(
        controller.deleteCalcResult('proj-1', 'fantome'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('given service leve 409 (calcul scelle) : PROPAGE le conflit tel quel', async () => {
      calcResults.deleteUnsealed.mockRejectedValue(
        new ConflictException('Ce calcul a été scellé en PV officiel.'),
      );
      await expect(
        controller.deleteCalcResult('proj-1', 'calc-1'),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('PATCH /pvs/:id — renommage d etiquette du PV (0027)', () => {
    it('given le service renvoie la vue : delegue rename({projectId, pvId, name}) et la renvoie', async () => {
      const view = { pv: { id: 'pv-1', name: 'Rapport' }, sealValid: true };
      pvSvc.rename.mockResolvedValue(view);
      await expect(
        controller.renamePv('proj-1', 'pv-1', { name: 'Rapport' }),
      ).resolves.toBe(view);
      expect(pvSvc.rename).toHaveBeenCalledWith({
        projectId: 'proj-1',
        pvId: 'pv-1',
        name: 'Rapport',
      });
    });

    it('given service null : 404 tenant-safe', async () => {
      pvSvc.rename.mockResolvedValue(null);
      await expect(
        controller.renamePv('proj-1', 'fantome', { name: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('POST /calc-results/:id/pv — emission avec name optionnel (0027)', () => {
    it('given un name : le transmet a emitFromCalc (avec userId JWT)', async () => {
      pvSvc.emitFromCalc.mockResolvedValue({ id: 'pv-1', name: 'X' });
      const req = { auth: { userId: 'u-1' } } as never;
      await controller.emitPv('proj-1', 'calc-1', { name: 'X' }, req);
      expect(pvSvc.emitFromCalc).toHaveBeenCalledWith({
        calcResultId: 'calc-1',
        projectId: 'proj-1',
        userId: 'u-1',
        name: 'X',
      });
    });

    it('given aucun name (corps vide) : name=null (jamais undefined)', async () => {
      pvSvc.emitFromCalc.mockResolvedValue({ id: 'pv-1', name: null });
      const req = { auth: { userId: 'u-1' } } as never;
      await controller.emitPv('proj-1', 'calc-1', {}, req);
      expect(pvSvc.emitFromCalc).toHaveBeenCalledWith({
        calcResultId: 'calc-1',
        projectId: 'proj-1',
        userId: 'u-1',
        name: null,
      });
    });
  });
});
