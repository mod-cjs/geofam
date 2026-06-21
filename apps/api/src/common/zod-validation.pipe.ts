import type { PipeTransform } from '@nestjs/common';
import { BadRequestException, Injectable } from '@nestjs/common';
import type { ZodSchema } from 'zod';

/**
 * ZodValidationPipe — valide/parse une entree contre un schema Zod a la
 * frontiere HTTP. En cas d'echec : 400 avec les chemins en erreur (pas de
 * fuite de la valeur recue). On NE renvoie jamais l'objet brut non valide.
 *
 * Usage : @Body(new ZodValidationPipe(loginSchema)) body: LoginDto
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: 'Entree invalide',
        issues: result.error.issues.map((i) => ({
          path: i.path.join('.'),
          code: i.code,
        })),
      });
    }
    return result.data;
  }
}
