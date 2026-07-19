import { NotFoundException } from '@nestjs/common';

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
  };
  let controller: PvController;

  beforeEach(() => {
    jest.clearAllMocks();
    calcResults = {
      listForProject: jest.fn(),
      getForProject: jest.fn(),
    };
    // PvService / CalcSnapshotsService non sollicites par ces routes : stubs minimaux.
    const pv = {} as unknown as PvService;
    const snapshots = {} as unknown as CalcSnapshotsService;
    controller = new PvController(
      calcResults as unknown as CalcResultsService,
      snapshots,
      pv,
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
});
