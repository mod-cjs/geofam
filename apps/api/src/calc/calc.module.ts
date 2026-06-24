import { Module } from '@nestjs/common';

import { BurmisterController } from './burmister.controller';
import { LaboController } from './labo.controller';
import { PieuxController } from './pieux.controller';
import { PressiometreController } from './pressiometre.controller';
import { RadierController } from './radier.controller';
import { TerzaghiController } from './terzaghi.controller';

/**
 * CalcModule — endpoints de RECALCUL SERVEUR des moteurs de calcul.
 * Le calcul confidentiel (@roadsen/engines) ne s'execute QUE cote serveur (DoD §8).
 * terzaghi (#45), burmister (#46, chaussees), pressiometre (#47, Menard), pieux (#48,
 * fondations profondes NF P 94-262), radier (#54, plaque sur sol multicouche EF), labo
 * (#49-53, essais de labo & classification GTR NF P 11-300). Serie des 6 moteurs GeoSuite
 * complete.
 */
@Module({
  controllers: [
    TerzaghiController,
    BurmisterController,
    PressiometreController,
    PieuxController,
    RadierController,
    LaboController,
  ],
})
export class CalcModule {}
