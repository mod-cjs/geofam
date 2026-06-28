import { ForbiddenException, HttpException, HttpStatus } from '@nestjs/common';

/**
 * Erreurs d'enforcement d'abonnement (ADR 0011 §4 — contrat d'erreur). Le code
 * HTTP seul ne suffit pas a l'UX : on porte un `reason` typé dans le body pour
 * que le frontend distingue les etats (bandeau expire vs quota vs hors pack).
 * Messages GENERIQUES et tenant-safe (pas de fuite d'existence de ressource).
 */
export type SubscriptionDenialReason =
  | 'MODULE_NOT_IN_PACK'
  | 'EXPIRED'
  | 'QUOTA'
  | 'NO_SUBSCRIPTION';

/** 403 — module structurellement hors pack (pas un probleme de temps/quota). */
export class ModuleNotInPackException extends ForbiddenException {
  constructor() {
    super({
      statusCode: HttpStatus.FORBIDDEN,
      reason: 'MODULE_NOT_IN_PACK' satisfies SubscriptionDenialReason,
      message: 'Module non inclus dans votre abonnement',
    });
  }
}

/** 403 — org sans abonnement (mauvais provisionnement, pas un quota epuise). */
export class NoSubscriptionException extends ForbiddenException {
  constructor() {
    super({
      statusCode: HttpStatus.FORBIDDEN,
      reason: 'NO_SUBSCRIPTION' satisfies SubscriptionDenialReason,
      message: 'Aucun abonnement actif pour cette organisation',
    });
  }
}

/** 402 — acces ferme par EXPIRATION (now_serveur > date_fin). */
export class SubscriptionExpiredException extends HttpException {
  constructor() {
    super(
      {
        statusCode: HttpStatus.PAYMENT_REQUIRED,
        reason: 'EXPIRED' satisfies SubscriptionDenialReason,
        message: 'Abonnement expiré',
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}

/** 402 — acces ferme par QUOTA (consommation >= quota). */
export class QuotaExhaustedException extends HttpException {
  constructor() {
    super(
      {
        statusCode: HttpStatus.PAYMENT_REQUIRED,
        reason: 'QUOTA' satisfies SubscriptionDenialReason,
        message: "Quota d'utilisation atteint",
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}
