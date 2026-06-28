import { SetMetadata } from '@nestjs/common';

/**
 * Decorateurs de l'enforcement d'abonnement (ADR 0011 §2). Deny-by-default cote
 * metier : une route qui consomme un entitlement le DECLARE explicitement.
 *
 *  - @RequiresEntitlement(engineId) : module/moteur requis. Le SubscriptionGuard
 *    refuse 403 si `engineId ∉ subscription.entitlements`. Le `engineId` est
 *    statique ici (porte par la route) ; si une route sert plusieurs moteurs via
 *    un param (:engine), passer le RESOLVEUR (cf. resolveEngineId ci-dessous).
 *  - @Consumes('CALC' | 'PV') : marque qu'un appel REUSSI decremente le quota.
 *    Le guard ne decremente PAS (cf. §3 : le decompte atomique a lieu dans la tx
 *    qui ecrit le resultat) ; ce decorateur sert au pre-check de quota du guard
 *    et documente l'intention (le service de calcul/PV fait le decompte reel).
 */
export const REQUIRES_ENTITLEMENT_KEY = 'roadsen:requiresEntitlement';
export const CONSUMES_KEY = 'roadsen:consumes';

export type ConsumeKind = 'CALC' | 'PV';

/**
 * Source du `engineId` requis. Soit une CHAINE fixe (route mono-moteur), soit le
 * nom d'un PARAMETRE de route (ex. 'engine' pour /calc/:engine) dont la valeur
 * sera lue a la requete. On distingue les deux par un objet discrimine pour ne
 * jamais confondre « le moteur s'appelle `engine` » avec « lis le param `engine` ».
 */
export type EntitlementRef =
  | { kind: 'fixed'; engineId: string }
  | { kind: 'param'; param: string };

/** @RequiresEntitlement('burmister') ou @RequiresEntitlement({ param: 'engine' }). */
export const RequiresEntitlement = (ref: string | { param: string }) =>
  SetMetadata<string, EntitlementRef>(
    REQUIRES_ENTITLEMENT_KEY,
    typeof ref === 'string'
      ? { kind: 'fixed', engineId: ref }
      : { kind: 'param', param: ref.param },
  );

/** @Consumes('CALC' | 'PV'). */
export const Consumes = (kind: ConsumeKind) =>
  SetMetadata<string, ConsumeKind>(CONSUMES_KEY, kind);
