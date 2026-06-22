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
 * TraceIdMiddleware — pose `req.traceId` et l'en-tete de reponse `x-trace-id`
 * TRES TOT (avant les gardes), pour que meme un 401/403/404 emette un traceId.
 * On respecte un `x-trace-id` deja fourni par un proxy amont (correlation de
 * bout en bout) ; sinon on en genere un.
 */
@Injectable()
export class TraceIdMiddleware implements NestMiddleware {
  use(req: TracedRequest, res: Response, next: NextFunction): void {
    const incoming = req.headers[TRACE_ID_HEADER];
    const traceId =
      typeof incoming === 'string' && incoming.trim().length > 0
        ? incoming.trim()
        : randomUUID();
    req.traceId = traceId;
    res.setHeader(TRACE_ID_HEADER, traceId);
    next();
  }
}
