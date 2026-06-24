import { Module } from '@nestjs/common';

import { BurmisterController } from './burmister.controller';
import { TerzaghiController } from './terzaghi.controller';

/**
 * CalcModule — endpoints de RECALCUL SERVEUR des moteurs de calcul.
 * Le calcul confidentiel (@roadsen/engines) ne s'execute QUE cote serveur (DoD §8).
 * Demarre avec terzaghi (#45) puis burmister (#46, chaussees) ; les 4 autres
 * moteurs s'y ajouteront.
 */
@Module({
  controllers: [TerzaghiController, BurmisterController],
})
export class CalcModule {}
