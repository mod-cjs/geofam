import { randomUUID } from 'node:crypto';

import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/**
 * En-tete de correlation des requetes (un identifiant par requete). Permet de
 * relier une reponse d'erreur cote client a la trace serveur sans exposer de
 * detail interne.
 */
export const TRACE_ID_HEADER = 'x-trace-id';

/** Requete portant le traceId pose par le middleware ci-dessous. */
export interface TracedRequest extends Request {
  traceId?: string;
}

/**
 * Format accepte pour un traceId fourni en amont : alphanumerique + `._-`,
 * 1 a 128 caracteres. STRICT a dessein : interdit les CR/LF et caracteres de
 * controle (sinon log-injection via l'interpolation cote serveur, et
 * ERR_INVALID_CHAR lors du `setHeader`) et borne la taille (anti-abus). Tout id
 * non conforme est IGNORE -> on en genere un propre.
 */
const TRACE_ID_RE = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * TraceIdMiddleware — pose `req.traceId` et l'en-tete de reponse `x-trace-id`
 * TRES TOT (avant les gardes), pour que meme un 401/403/404 emette un traceId.
 * On respecte un `x-trace-id` fourni par un proxy amont (correlation de bout en
 * bout) UNIQUEMENT s'il est conforme a `TRACE_ID_RE` ; sinon on en genere un.
 */
@Injectable()
export class TraceIdMiddleware implements NestMiddleware {
  use(req: TracedRequest, res: Response, next: NextFunction): void {
    const incoming = req.headers[TRACE_ID_HEADER];
    const traceId =
      typeof incoming === 'string' && TRACE_ID_RE.test(incoming)
        ? incoming
        : randomUUID();
    req.traceId = traceId;
    res.setHeader(TRACE_ID_HEADER, traceId);
    next();
  }
}
