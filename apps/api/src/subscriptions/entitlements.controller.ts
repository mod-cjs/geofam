import { Controller, Get, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import type { AuthedRequest } from '../auth/request-context';

import type { EntitlementsView } from './subscriptions.service';
import { SubscriptionsService } from './subscriptions.service';

/**
 * EntitlementsController — GET /me/entitlements (ADR 0011 §4).
 *
 * SCOPE TENANT (l'abonnement est par org) : la route passe par la chaine de
 * gardes globale (JwtAuthGuard -> TenantGuard -> ...). Elle exige X-Org-Id (org
 * courante, resolue par le middleware ADR 0010). Le shell la consomme pour gater
 * l'UI (modules verrouilles, bandeau expire, quota restant) — DEFENSE EN
 * PROFONDEUR : l'UI gate, le serveur barre (au SubscriptionGuard / decompte).
 *
 * PAS de @RequiresEntitlement/@Consumes ici : lire son etat d'abonnement ne
 * consomme rien et n'exige aucun module. Le SubscriptionGuard laisse donc passer.
 */
@ApiTags('subscriptions')
@Controller('me')
export class EntitlementsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Get('entitlements')
  @ApiOperation({
    summary:
      "Etat d'abonnement de l'org courante (modules, expiration serveur, quota).",
  })
  entitlements(@Req() req: AuthedRequest): Promise<EntitlementsView> {
    // req.tenant.orgId est pose par TenantGuard (org membre prouvee). Source de
    // verite serveur : on ne lit jamais l'org d'un en-tete non verifie.
    return this.subscriptions.getEntitlements(req.tenant!.orgId);
  }
}
