import { Module } from '@nestjs/common';

import { TerzaghiController } from './terzaghi.controller';

/**
 * CalcModule — endpoints de RECALCUL SERVEUR des moteurs de calcul.
 * Le calcul confidentiel (@roadsen/engines) ne s'execute QUE cote serveur (DoD §8).
 * Demarre avec terzaghi (#45, pilote) ; les 5 autres moteurs s'y ajouteront.
 */
@Module({
  controllers: [TerzaghiController],
})
export class CalcModule {}
