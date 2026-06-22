import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { Catch, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { ZodValidationException } from 'nestjs-zod';
import { ZodError } from 'zod';

import type { TracedRequest } from './trace';

/**
 * Format d'erreur STANDARD de l'API. Tout endpoint renvoie cette forme en cas
 * d'echec, quel que soit le statut (400/401/403/404/409/500...).
 *  - `statusCode` : code HTTP.
 *  - `error`      : libelle stable et generique du statut (pas de detail interne).
 *  - `message`    : message lisible, deja assaini (jamais de stack/valeur brute).
 *  - `details`    : optionnel — diagnostics structures (ex. erreurs de validation).
 *  - `traceId`    : correle la reponse a la trace serveur (cf. TraceIdMiddleware).
 */
export interface ApiErrorBody {
  statusCode: number;
  error: string;
  message: string;
  details?: unknown;
  traceId: string;
}

/** Forme minimale d'une issue de validation Zod consommee par le filtre. */
interface ZodIssueLike {
  path: ReadonlyArray<string | number | symbol>;
  code: string;
}

// Libelles stables par statut (decouples des messages internes de Nest).
const STATUS_LABELS: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'Bad Request',
  [HttpStatus.UNAUTHORIZED]: 'Unauthorized',
  [HttpStatus.FORBIDDEN]: 'Forbidden',
  [HttpStatus.NOT_FOUND]: 'Not Found',
  [HttpStatus.CONFLICT]: 'Conflict',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'Unprocessable Entity',
  [HttpStatus.INTERNAL_SERVER_ERROR]: 'Internal Server Error',
};

/**
 * AllExceptionsFilter — filtre GLOBAL, unique porte de sortie des erreurs.
 *
 * Trois familles :
 *  1) Erreur de validation Zod (ZodValidationException / ZodError) -> 400, on
 *     expose les chemins+codes en `details`, JAMAIS la valeur recue.
 *  2) HttpException Nest (y compris notre ZodValidationPipe maison qui leve un
 *     BadRequestException { message, issues }) -> on reprend le statut et on
 *     assainit le corps.
 *  3) Tout le reste -> 500 generique. La cause reelle est LOGGEE cote serveur
 *     (avec la stack), jamais renvoyee au client. En prod comme ailleurs : zero
 *     fuite de stack/detail interne.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<TracedRequest>();
    // Le middleware a normalement pose un traceId ; filet de securite sinon.
    const traceId = req.traceId ?? 'unknown';

    const body = this.toErrorBody(exception, traceId);
    res.status(body.statusCode).json(body);
  }

  private toErrorBody(exception: unknown, traceId: string): ApiErrorBody {
    // 1) Validation Zod (nestjs-zod ou ZodError brute remontee).
    const issues = this.extractZodIssues(exception);
    if (issues) {
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        error: 'Bad Request',
        message: 'Entree invalide',
        // On n'expose QUE le chemin + le code, jamais la valeur recue.
        details: issues.map((i) => ({
          path: i.path.map((p) => String(p)).join('.'),
          code: i.code,
        })),
        traceId,
      };
    }

    // 2) HttpException Nest (statut maitrise).
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      return {
        statusCode: status,
        error: STATUS_LABELS[status] ?? 'Error',
        message: this.messageFrom(payload, status),
        ...this.detailsFrom(payload),
        traceId,
      };
    }

    // 3) Erreur non maitrisee -> 500 generique, cause loggee (pas renvoyee).
    this.logger.error(
      `Erreur non geree (traceId=${traceId})`,
      exception instanceof Error ? exception.stack : String(exception),
    );
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'Internal Server Error',
      message: 'Erreur interne',
      traceId,
    };
  }

  /**
   * Extrait les `issues` d'une erreur de validation Zod, qu'elle vienne de
   * nestjs-zod (ZodValidationException) ou soit une ZodError remontee nue. On ne
   * renvoie QUE la forme consommee ({path, code}) -> decouple des differences de
   * typage de ZodError entre versions de zod (nestjs-zod v5 vs notre zod v3).
   */
  private extractZodIssues(exception: unknown): ZodIssueLike[] | null {
    if (exception instanceof ZodValidationException) {
      return (exception.getZodError() as { issues: ZodIssueLike[] }).issues;
    }
    if (exception instanceof ZodError) {
      return exception.issues;
    }
    return null;
  }

  /** Extrait un message lisible du corps d'une HttpException, sans fuite. */
  private messageFrom(payload: unknown, status: number): string {
    if (typeof payload === 'string') {
      return payload;
    }
    if (payload && typeof payload === 'object' && 'message' in payload) {
      const msg = payload.message;
      if (typeof msg === 'string') return msg;
      // Nest agrege parfois plusieurs messages en tableau -> on joint.
      if (Array.isArray(msg)) return msg.map(String).join(', ');
    }
    return STATUS_LABELS[status] ?? 'Erreur';
  }

  /**
   * Reprend des diagnostics structures du corps si presents (ex. `issues` de
   * notre ZodValidationPipe maison). Anti-fuite PAR CONSTRUCTION : on ne propage
   * QUE {path, code} de chaque issue — jamais le reste du payload (valeur recue,
   * message verbeux, detail SQL/colonne d'une exception future). On ne fait donc
   * pas confiance a la forme amont : on la normalise ici.
   */
  private detailsFrom(payload: unknown): { details?: unknown } {
    if (payload && typeof payload === 'object' && 'issues' in payload) {
      const issues = payload.issues;
      if (Array.isArray(issues)) {
        return { details: issues.map((i) => this.normalizeIssue(i)) };
      }
    }
    return {};
  }

  /** Reduit une issue arbitraire a la forme stricte {path, code}. */
  private normalizeIssue(issue: unknown): { path: string; code: string } {
    const o = (issue && typeof issue === 'object' ? issue : {}) as Record<
      string,
      unknown
    >;
    const path = Array.isArray(o.path)
      ? o.path.map((p) => String(p)).join('.')
      : typeof o.path === 'string'
        ? o.path
        : '';
    const code = typeof o.code === 'string' ? o.code : 'invalid';
    return { path, code };
  }
}
