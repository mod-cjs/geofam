import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { IS_PUBLIC_KEY, NO_TENANT_KEY } from '../auth/decorators';
import type { AuthedRequest } from '../auth/request-context';

import type { ConsumeKind, EntitlementRef } from './decorators';
import { CONSUMES_KEY, REQUIRES_ENTITLEMENT_KEY } from './decorators';
import { NoSubscriptionException } from './subscription.errors';
import { SubscriptionsService } from './subscriptions.service';

/**
 * SubscriptionGuard — enforcement d'abonnement (ADR 0009/0011 §2). Place dans la
 * chaine APRES TenantGuard (l'org est resolue, le membership prouve : req.tenant)
 * et AVANT RolesGuard :
 *
 *   ... -> JwtAuthGuard -> TenantGuard -> SubscriptionGuard -> RolesGuard
 *
 * Ne s'applique QU'AUX routes qui DECLARENT consommer un entitlement, via
 * @RequiresEntitlement(engineId | {param}) et/ou @Consumes('CALC'|'PV'). Une
 * route sans ces decorateurs (ex. lecture, liste, /auth/*) passe sans verif :
 * deny-by-default cote METIER (on ne barre que ce qui consomme).
 *
 *  - @Public / @NoTenant : pas de contexte tenant -> pas d'abonnement a verifier
 *    (le guard laisse passer ; l'auth/tenant ont deja statue). Coherent avec
 *    l'invariant « @Public honore par TOUS les guards ».
 *
 * Le pre-check est OPTIMISTE (UX rapide) ; il NE decremente RIEN. Le decompte
 * faisant autorite est l'increment atomique de SubscriptionsService.reserveUnit,
 * effectue DANS la transaction qui ecrit le resultat (§3).
 *
 * SECURITE : le guard lit l'abonnement EN BASE (sous RLS), JAMAIS le JWT. Le
 * claim `orgs`/`role` (ADR 0010) ne porte aucun entitlement -> il n'influe pas
 * (TM-7). C'est LE point qui fait que le serveur barre meme si l'UI est contournee.
 */
@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // @Public : aucune chaine de garde (coherence avec les autres guards).
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    // @NoTenant : route authentifiee mais hors contexte tenant -> pas d'abo a
    // verifier (un abonnement est PAR ORG ; sans org, rien a faire).
    const noTenant = this.reflector.getAllAndOverride<boolean>(NO_TENANT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (noTenant) return true;

    const entitlementRef = this.reflector.getAllAndOverride<EntitlementRef>(
      REQUIRES_ENTITLEMENT_KEY,
      [context.getHandler(), context.getClass()],
    );
    const consumes = this.reflector.getAllAndOverride<ConsumeKind>(
      CONSUMES_KEY,
      [context.getHandler(), context.getClass()],
    );

    // Route non consommante (ni entitlement requis, ni decompte) : pas de verif.
    if (!entitlementRef && !consumes) return true;

    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const orgId = req.tenant?.orgId;
    if (!orgId) {
      // TenantGuard aurait du poser req.tenant pour une route tenant. Absence =
      // configuration KO -> on refuse (fail-closed) plutot que d'ignorer l'abo.
      throw new NoSubscriptionException();
    }

    const engineId = resolveEngineId(entitlementRef, req);
    // assertAccess fait le pre-check (403 hors pack / 402 expire|quota). Lecture
    // seule, dans sa propre tx tenant (le guard precede l'interceptor d'ALS).
    await this.subscriptions.assertAccess(orgId, engineId, consumes);
    return true;
  }
}

/**
 * Groupement d'entitlement par LOGICIEL. Les modes GEOPLAQUE (deformations planes,
 * axisymetrique, radier triangulaire) sont des variantes du meme logiciel que le radier :
 * ils partagent l'entitlement 'radier' (GEOPLAQUE = 1 module, 4 modes — pas de re-vente).
 * Seul le CONTROLE d'entitlement est groupe ici ; le dispatch moteur et le ledger d'usage
 * conservent le slug reel (plane-strain/axi/tri-raft). (Tarification eventuelle des modes
 * avances = decision titulaire separee, n'affecte pas ce groupement technique.)
 */
const ENTITLEMENT_GROUP: Record<string, string> = {
  'plane-strain': 'radier',
  axi: 'radier',
  'tri-raft': 'radier',
};

/**
 * Resout le `engineId` requis : chaine fixe, ou valeur d'un parametre de route
 * (ex. /calc/:engine). `undefined` si aucune contrainte de module (route qui
 * consomme du quota sans exiger un moteur precis, ex. emission PV).
 */
function resolveEngineId(
  ref: EntitlementRef | undefined,
  req: AuthedRequest,
): string | undefined {
  if (!ref) return undefined;
  const raw =
    ref.kind === 'fixed'
      ? ref.engineId
      : (req.params as Record<string, string> | undefined)?.[ref.param];
  if (raw === undefined) return undefined;
  return ENTITLEMENT_GROUP[raw] ?? raw;
}
