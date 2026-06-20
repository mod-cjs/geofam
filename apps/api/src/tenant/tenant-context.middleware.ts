import type { NestMiddleware } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { tenantStorage } from './tenant-context';

/**
 * TenantContextMiddleware — etablit le contexte tenant pour la requete.
 *
 * SOURCE D'IDENTITE — etat actuel (socle) :
 *  La voie par en-tetes de developpement (`x-org-id`, `x-user-id`) est un
 *  raccourci de DEV UNIQUEMENT. Un en-tete client n'est PAS une source
 *  d'identite fiable : l'accepter en prod = contournement TOTAL du
 *  cloisonnement (n'importe qui choisit son org). On la verrouille donc
 *  derriere un double interrupteur :
 *    - ROADSEN_DEV_HEADERS === '1'  (opt-in explicite), ET
 *    - NODE_ENV !== 'production'    (jamais en prod, quoi qu'il arrive).
 *  Hors de ce cas, les en-tetes sont IGNORES : aucun store n'est pose, l'acces
 *  reste fail-closed (RLS ne voit aucune ligne, requireOrgId() leve).
 *
 * TODO(auth #41) : remplacer cette voie par l'identite issue du JWT VERIFIE
 *  (signature + expiration) PUIS un controle d'appartenance (membership de
 *  l'utilisateur a l'org demandee) avant de poser le contexte tenant.
 *  C'est la seule source d'identite admissible en preprod/prod.
 *
 * Quand le contexte est resolu, il est range dans l'AsyncLocalStorage pour
 * toute la duree de la requete. Les services appellent ensuite
 * PrismaService.withTenant(requireOrgId(), ...) -> SET LOCAL + RLS.
 */
@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    // Voie en-tete : autorisee UNIQUEMENT en dev avec opt-in explicite.
    const devHeadersAllowed =
      process.env.ROADSEN_DEV_HEADERS === '1' &&
      process.env.NODE_ENV !== 'production';

    if (!devHeadersAllowed) {
      // Pas de source d'identite fiable disponible (auth #41 non livree).
      // On NE pose aucun contexte : acces multi-tenant fail-closed.
      return next();
    }

    const orgId = headerValue(req, 'x-org-id');
    const userId = headerValue(req, 'x-user-id');

    if (!orgId || !userId) {
      // Pas de contexte : on laisse passer SANS store. Les acces aux tables
      // multi-tenant resteront fail-closed (RLS ne voit aucune ligne) et les
      // services exigeant requireOrgId() leveront — comportement voulu.
      return next();
    }

    tenantStorage.run({ orgId, userId }, () => next());
  }
}

function headerValue(req: Request, name: string): string | undefined {
  const raw = req.headers[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value && value.trim().length > 0 ? value.trim() : undefined;
}
