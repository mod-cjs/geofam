import { Injectable } from '@nestjs/common';
import type { Prisma, Subscription } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

import type { ConsumeKind } from './decorators';
import {
  ModuleNotInPackException,
  NoSubscriptionException,
  QuotaExhaustedException,
  SubscriptionExpiredException,
} from './subscription.errors';

/** Vue d'entitlements renvoyee par GET /me/entitlements (ADR 0011 §4). */
export interface EntitlementsView {
  orgId: string;
  pack: string;
  modules: string[];
  expiresAt: string; // ISO (= date_fin, source serveur)
  expired: boolean; // now_serveur > date_fin (calcule en base)
  quota: { limit: number; used: number; remaining: number };
  serverTime: string; // ANCRE de temps : l'UI ne juge JAMAIS l'expiration a Date.now()
}

/**
 * Etat d'abonnement evalue PAR LE SERVEUR (now() base). Le `expired` est calcule
 * cote Postgres, jamais a partir d'une date cliente (TM-1 : temps = now() base).
 */
interface SubscriptionState {
  sub: Subscription;
  expired: boolean;
}

/**
 * SubscriptionsService — lecture d'abonnement, pre-check du guard, decompte
 * ATOMIQUE du quota (ADR 0011). L'enforcement est SERVEUR ; l'UI ne fait que du
 * gating de confort.
 *
 * ISOLATION : chaque lecture/ecriture passe par withTenant(orgId) -> RLS FORCE +
 * app_current_org() garantissent qu'un tenant ne lit/decremente JAMAIS l'abo d'un
 * autre, meme si l'org_id etait force cote app (la policy re-filtre). A prouver
 * par T-ISO (qa-test, Postgres reel).
 *
 * TEMPS : toujours `now()` Postgres. Aucune date cliente n'entre dans le jugement
 * d'expiration (TM-1).
 */
@Injectable()
export class SubscriptionsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lit l'etat d'abonnement de l'org courante, expiration evaluee PAR LE SERVEUR.
   * Une seule requete : on selectionne la ligne ET (now() > date_fin) cote base.
   * `null` si l'org n'a pas d'abonnement (provisionnement manquant -> le guard
   * tranche en 403 NoSubscription).
   */
  private async loadState(
    tx: Prisma.TransactionClient,
  ): Promise<SubscriptionState | null> {
    // now() EN BASE pour l'expiration (jamais l'horloge app/cliente). RLS scope
    // deja a l'org courante -> au plus 1 ligne (org_id UNIQUE).
    const rows = await tx.$queryRaw<Array<Subscription & { expired: boolean }>>`
      SELECT s.*, (now() > s.date_fin) AS expired
      FROM subscriptions s
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) return null;
    const { expired, ...sub } = row;
    return { sub: sub, expired };
  }

  /**
   * PRE-CHECK du SubscriptionGuard (ADR 0011 §2). Lecture seule, dans sa PROPRE
   * transaction tenant (le guard s'execute AVANT l'interceptor qui pose l'ALS du
   * handler). Ne decremente RIEN (cf. §3 : le decompte a lieu a l'usage effectif).
   *
   *  - pas d'abonnement       -> 403 NoSubscription
   *  - engineId hors pack      -> 403 ModuleNotInPack
   *  - expire (now > date_fin) -> 402 EXPIRED
   *  - quota epuise            -> 402 QUOTA
   *
   * @param engineId moteur requis si la route porte @RequiresEntitlement, sinon
   *        undefined (route consommante sans contrainte de module).
   * @param consumes 'CALC'|'PV' si la route consomme (active le pre-check quota),
   *        sinon undefined.
   */
  async assertAccess(
    orgId: string,
    engineId: string | undefined,
    consumes: ConsumeKind | undefined,
  ): Promise<void> {
    await this.prisma.withTenant(orgId, async (tx) => {
      const state = await this.loadState(tx);
      if (!state) throw new NoSubscriptionException();

      // 1) Module hors pack : 403 (probleme structurel, pas de remede temps/quota).
      //    Verifie AVANT expiration/quota : « tu n'as pas ce module » prime sur
      //    « ton abo est expire » (sinon un client hors-pack croirait qu'un
      //    renouvellement debloquerait le module).
      if (
        engineId !== undefined &&
        !state.sub.entitlements.includes(engineId)
      ) {
        throw new ModuleNotInPackException();
      }

      // 2) Expiration : 402 EXPIRED. Evaluee par now() base (state.expired).
      if (state.expired) throw new SubscriptionExpiredException();

      // 3) Quota (pre-check optimiste, seulement si la route consomme). Le decompte
      //    FAISANT AUTORITE est l'increment atomique de reserveUnit (§3) ; ici on
      //    barre tot pour ne pas lancer un calcul couteux a coup sur perdant.
      if (consumes && state.sub.consommation >= state.sub.quota) {
        throw new QuotaExhaustedException();
      }
    });
  }

  /**
   * DECOMPTE ATOMIQUE (ADR 0011 §3) — appele DANS la transaction tenant qui ecrit
   * le resultat consommant (calc_result / official_pv). Increment CONDITIONNEL :
   * reserve une unite SSI quota non atteint ET non expire, EN BASE (now()), puis
   * insere la ligne de ledger. Si 0 ligne affectee -> quota epuise OU expire
   * entre-temps -> on leve 402 (la tx appelante ROLLBACK -> rien n'est consomme).
   *
   * @returns subscriptionId (pour le rattachement du ledger par l'appelant si besoin).
   * @throws QuotaExhaustedException / SubscriptionExpiredException / NoSubscription.
   */
  async reserveUnit(
    tx: Prisma.TransactionClient,
    args: {
      orgId: string;
      kind: ConsumeKind;
      refId: string | null;
      userId: string;
    },
  ): Promise<string> {
    // 1) Reserve l'unite atomiquement. Le WHERE serialise sur la ligne (verrou
    //    Postgres) -> deux requetes concurrentes a quota-1 : une seule passe.
    //    now() <= date_fin : garde d'expiration cote serveur (TM-1).
    const reserved = await tx.$queryRaw<Array<{ id: string }>>`
      UPDATE subscriptions
         SET consommation = consommation + 1,
             updated_at   = now()
       WHERE org_id        = app_current_org()  -- isolation (RLS le re-impose aussi)
         AND consommation  < quota              -- garde quota (anti-course)
         AND now()        <= date_fin           -- garde expiration (temps SERVEUR)
      RETURNING id
    `;

    if (reserved.length === 0) {
      // 0 ligne : soit pas d'abonnement, soit quota epuise, soit expire. On
      // distingue pour le bon code/reason (l'UI doit afficher le bon etat).
      const state = await this.loadState(tx);
      if (!state) throw new NoSubscriptionException();
      if (state.expired) throw new SubscriptionExpiredException();
      throw new QuotaExhaustedException();
    }

    const subscriptionId = reserved[0].id;

    // 2) Trace l'unite au LEDGER (append-only). created_at = now() (defaut base).
    //    Meme tx -> tout-ou-rien : si l'ecriture du resultat echoue ensuite,
    //    le rollback annule AUSSI la reservation (TM-5 : echec ne consomme pas).
    await tx.usageLedger.create({
      data: {
        orgId: args.orgId,
        subscriptionId,
        kind: args.kind,
        refId: args.refId,
        userId: args.userId,
      },
    });

    return subscriptionId;
  }

  /**
   * GET /me/entitlements (ADR 0011 §4). Etat consommable par le shell pour gater
   * l'UI (defense en profondeur). serverTime = ANCRE de temps (l'UI calcule
   * l'expiration par rapport a elle, jamais Date.now()).
   *
   * @throws NoSubscriptionException si l'org n'a pas d'abonnement (provisionnement).
   */
  async getEntitlements(orgId: string): Promise<EntitlementsView> {
    return this.prisma.withTenant(orgId, async (tx) => {
      const state = await this.loadState(tx);
      if (!state) throw new NoSubscriptionException();
      // serverTime depuis la base (meme horloge que l'expiration), en ISO.
      const nowRows = await tx.$queryRaw<Array<{ now: Date }>>`
        SELECT now() AS now
      `;
      const serverTime = nowRows[0].now.toISOString();
      const { sub, expired } = state;
      const used = sub.consommation;
      const limit = sub.quota;
      return {
        orgId,
        pack: sub.pack,
        modules: sub.entitlements,
        expiresAt: sub.dateFin.toISOString(),
        expired,
        quota: { limit, used, remaining: Math.max(0, limit - used) },
        serverTime,
      };
    });
  }

  /**
   * Provisionne l'abonnement d'une org A LA CREATION D'ORG (ADR 0009/0011 §5,
   * manuel en P1). Appele HORS contexte tenant (au moment de provision_org : pas
   * encore d'app.current_org pose) -> via la fonction SECURITY DEFINER
   * provision_subscription (0008), seule voie d'INSERT « a froid » sous le
   * runtime NOBYPASSRLS. Idempotent (ON CONFLICT org_id DO NOTHING cote base) :
   * re-provisionner la meme org renvoie l'abonnement existant.
   *
   * @returns l'uuid de l'abonnement (cree ou deja en place).
   */
  async provision(input: {
    orgId: string;
    pack: string;
    entitlements: string[];
    dateDebut: Date;
    dateFin: Date;
    quota: number;
  }): Promise<string> {
    const rows = await this.prisma.asAppRole(
      (tx) => tx.$queryRaw<Array<{ provision_subscription: string }>>`
        SELECT provision_subscription(
          ${input.orgId}::uuid,
          ${input.pack},
          ${input.entitlements},
          ${input.dateDebut},
          ${input.dateFin},
          ${input.quota}::int
        )
      `,
    );
    return rows[0].provision_subscription;
  }
}
