import { Module } from '@nestjs/common';

import { CalcResultsService } from './calc-results.service';
import { PvController } from './pv.controller';
import { PvService } from './pv.service';

/**
 * PvModule — surface TENANT du pipeline PV (#63, incr. B) : calcul persistant,
 * emission de PV officiel scelle, lecture + verification d'integrite.
 *
 * Distinct de CalcModule (surface RECETTE @Public derriere X-Recette-Key, sans
 * etat) : ici tout est authentifie + tenant (chaine de gardes globale d'AppModule).
 * Reutilise @roadsen/engines (memes run<Engine>, equivalence) et @roadsen/shared
 * (primitive de scellement de l'incrément A).
 */
@Module({
  controllers: [PvController],
  providers: [CalcResultsService, PvService],
  exports: [CalcResultsService, PvService],
})
export class PvModule {}
