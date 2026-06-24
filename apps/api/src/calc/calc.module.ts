import { Module } from '@nestjs/common';

import { BurmisterController } from './burmister.controller';
import { PieuxController } from './pieux.controller';
import { PressiometreController } from './pressiometre.controller';
import { RadierController } from './radier.controller';
import { TerzaghiController } from './terzaghi.controller';

/**
 * CalcModule — endpoints de RECALCUL SERVEUR des moteurs de calcul.
 * Le calcul confidentiel (@roadsen/engines) ne s'execute QUE cote serveur (DoD §8).
 * Demarre avec terzaghi (#45), burmister (#46, chaussees), pressiometre (#47,
 * Menard), pieux (#48, fondations profondes NF P 94-262), radier (#54, plaque sur sol
 * multicouche elastique EF) ; les autres moteurs s'y ajouteront.
 */
@Module({
  controllers: [
    TerzaghiController,
    BurmisterController,
    PressiometreController,
    PieuxController,
    RadierController,
  ],
})
export class CalcModule {}
