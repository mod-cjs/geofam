import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';

import type { AuthedRequest } from './request-context';

/**
 * Aides de test pour les guards. Fichier sans `.spec` -> jest ne l'execute pas
 * comme suite. Pas de fausse assertion ici : on ne fabrique que des mocks
 * minimaux passes aux guards reels, qui restent seuls juges.
 */

/** Reflector mocke : renvoie les valeurs de metadonnees fournies, par cle. */
export function fakeReflector(meta: Record<string, unknown>): Reflector {
  return {
    getAllAndOverride: (key: string) => meta[key],
  } as unknown as Reflector;
}

/** ExecutionContext mocke autour d'une requete HTTP donnee. */
export function httpContext(req: Partial<AuthedRequest>): ExecutionContext {
  const handler = () => undefined;
  class FakeClass {}
  return {
    switchToHttp: () => ({
      getRequest: <T>() => req as T,
    }),
    getHandler: () => handler,
    getClass: () => FakeClass,
  } as unknown as ExecutionContext;
}
