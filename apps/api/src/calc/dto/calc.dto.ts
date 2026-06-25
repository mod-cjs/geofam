import {
  BurmisterInputSchema,
  BurmisterOutputSchema,
  LaboInputSchema,
  LaboOutputSchema,
  PieuxInputSchema,
  PieuxOutputSchema,
  PressiometreInputSchema,
  PressiometreOutputSchema,
  RadierInputSchema,
  RadierOutputSchema,
  TerzaghiInputSchema,
  TerzaghiOutputSchema,
} from '@roadsen/engines';
import { createZodDto } from 'nestjs-zod';

/**
 * DTO d'ENTREE des six endpoints `POST /calc/*`, derives DIRECTEMENT des schemas
 * de contrat Zod de @roadsen/engines (aucune duplication de la forme). Deux roles :
 *  1. `createZodDto` permet a @nestjs/swagger d'exposer le SCHEMA COMPLET du corps
 *     dans le document OpenAPI une fois `cleanupOpenApiDoc()` applique (cf.
 *     app.config.ts, nestjs-zod v5) -> la recette STARFIRE voit les champs/bornes
 *     et le « Try it out » de /docs envoie un corps valide ;
 *  2. la validation a l'entree reste assuree par le ZodValidationPipe GLOBAL
 *     (nestjs-zod, enregistre dans configureApp) : une entree hors-contrat -> 400,
 *     sans changement de semantique vs le pipe explicite precedent (fail-closed).
 *
 * Confidentialite (DoD §8) : seuls les schemas de CONTRAT (entree/sortie publiques)
 * transitent ici — aucune formule ni intermediaire de calcul. La sortie reste la
 * whitelist stricte du contrat (cf. controleurs).
 */
export class TerzaghiInputDto extends createZodDto(TerzaghiInputSchema) {}
export class BurmisterInputDto extends createZodDto(BurmisterInputSchema) {}
export class PressiometreInputDto extends createZodDto(
  PressiometreInputSchema,
) {}
export class PieuxInputDto extends createZodDto(PieuxInputSchema) {}
export class RadierInputDto extends createZodDto(RadierInputSchema) {}
export class LaboInputDto extends createZodDto(LaboInputSchema) {}

/**
 * DTO de SORTIE (whitelist stricte du contrat) — sert uniquement a DOCUMENTER la
 * forme du champ `output` de l'enveloppe { ok, meta, output } dans @ApiResponse 200.
 * Ce ne sont pas des parametres d'entree : ils ne sont jamais valides en requete.
 */
export class TerzaghiOutputDto extends createZodDto(TerzaghiOutputSchema) {}
export class BurmisterOutputDto extends createZodDto(BurmisterOutputSchema) {}
export class PressiometreOutputDto extends createZodDto(
  PressiometreOutputSchema,
) {}
export class PieuxOutputDto extends createZodDto(PieuxOutputSchema) {}
export class RadierOutputDto extends createZodDto(RadierOutputSchema) {}
export class LaboOutputDto extends createZodDto(LaboOutputSchema) {}
