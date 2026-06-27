import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaClient } from '@prisma/client';

/**
 * PrismaService — client Prisma + scoping multi-tenant.
 *
 * Defense en profondeur :
 *  1) RLS FORCE cote base (migration 0001) : filet de securite ultime.
 *  2) `withTenant(orgId, fn)` ci-dessous : ouvre une transaction, y pose
 *     `SET LOCAL app.current_org = '<orgId>'`, puis execute le travail avec
 *     ce contexte. `SET LOCAL` est borne a la transaction : aucune fuite de
 *     contexte entre requetes/connexions du pool.
 *
 * Regle : tout acces a une table multi-tenant passe par `withTenant`.
 * En dehors d'une transaction scopee, RLS rend les lignes invisibles
 * (fail-closed : current_setting('app.current_org', true) = NULL).
 *
 * RUNTIME `SET ROLE roadsen_app` — BARRIERE B1 EFFECTIVE EN MONO-UTILISATEUR (#42)
 * --------------------------------------------------------------------------------
 * Sur un Postgres MANAGE (Render), la connexion se fait avec l'UTILISATEUR managed,
 * qui est le PROPRIETAIRE des tables. Un proprietaire garde TOUS les privilcges de
 * table : le `REVOKE` d'identite de la migration 0007 (barriere B1) ne s'exerce
 * donc PAS tant que l'app opere comme proprietaire. Pour rendre B1 reelle, CHAQUE
 * transaction/chemin DB bascule explicitement en `roadsen_app` via
 * `SET LOCAL ROLE "roadsen_app"` :
 *   - `current_user` devient roadsen_app -> les verifications de privilege et la RLS
 *     s'appliquent comme pour le runtime non-proprietaire (REVOKE identite + FORCE
 *     RLS + NOBYPASSRLS effectifs). Un acces direct a users/orgs/memberships echoue
 *     (insufficient_privilege), meme si la connexion physique est le proprietaire.
 *   - les fonctions SECURITY DEFINER (owned by roadsen_auth) s'executent QUAND MEME
 *     avec les droits de roadsen_auth : SECURITY DEFINER ignore le SET ROLE de
 *     l'appelant. Login / membership / provision / pv_emitter_context restent OK.
 *
 * Pourquoi `SET LOCAL ROLE` (et non `SET ROLE`) : SET LOCAL est borne a la
 * transaction -> il MEURT au COMMIT/ROLLBACK, sans polluer la connexion poolee
 * reutilisee ensuite. On ne fait JAMAIS de `SET ROLE` persistant hors tx (qui
 * laisserait une connexion du pool bloquee en roadsen_app pour une requete suivante).
 *
 * Pre-requis base : le user de connexion DOIT etre membre de roadsen_app
 * (GRANT "roadsen_app" TO <user>, pose en migration) pour pouvoir SET ROLE.
 *
 * INVARIANT D'AUTH (migration 0007) : NE JAMAIS appeler une fonction DEFINER
 * d'auth/bootstrap a l'INTERIEUR d'un `withTenant`. Ces fonctions posent un drapeau
 * de confiance `app.auth_bootstrap` (tx-local, referme avant RETURN) qui ouvre la
 * branche RLS d'IDENTITE. Les melanger a une requete tenant exposerait une fenetre
 * ou le drapeau serait actif. AuthService lit donc l'identite HORS withTenant, via
 * `asAppRole(...)` (transaction dediee, role roadsen_app, sans contexte tenant).
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Execute `fn` dans une transaction scopee au tenant `orgId`, SOUS le role
   * roadsen_app. Le client transactionnel passe a `fn` voit RLS applique sur ce
   * seul org ET opere avec les privileges (restreints) de roadsen_app.
   *
   * Ordre des SET LOCAL : ROLE d'abord, PUIS app.current_org. set_config(...,true)
   * et SET LOCAL ROLE sont tous deux tx-local -> ils tombent ensemble au COMMIT.
   *
   * @throws si `orgId` n'est pas un UUID — on refuse de poser un contexte
   *         non valide (qui resterait fail-closed mais masquerait un bug).
   */
  async withTenant<T>(
    orgId: string,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    assertUuid(orgId);
    return this.$transaction(async (tx) => {
      // 1) bascule en roadsen_app (barriere B1) — borne a la transaction.
      await tx.$executeRaw`SET LOCAL ROLE "roadsen_app"`;
      // 2) pose le tenant courant. set_config(name, value, is_local=true) == SET
      //    LOCAL, mais accepte un parametre lie -> pas d'interpolation (anti-injection).
      await tx.$executeRaw`SELECT set_config('app.current_org', ${orgId}, true)`;
      return fn(tx);
    });
  }

  /**
   * Execute `fn` dans une transaction SOUS le role roadsen_app, SANS contexte
   * tenant. Voie des chemins d'AUTH (login, membership-lookup, provision, profil,
   * pv_emitter_context appele hors withTenant) : ils n'ont pas d'org en main et
   * lisent l'identite UNIQUEMENT via les fonctions SECURITY DEFINER.
   *
   * Pourquoi une transaction explicite et roadsen_app : si l'app tournait comme
   * PROPRIETAIRE (connexion managed) en auto-commit, un acces direct a l'identite
   * passerait (privilege owner). En forcant roadsen_app ici, tout acces DIRECT a
   * users/orgs/memberships echoue (insufficient_privilege) ; SEULES les fonctions
   * DEFINER franchissent — defense en profondeur : meme une regression future qui
   * lirait l'identite en direct sur le chemin d'auth echouerait FERME au lieu de
   * fuiter sous les privileges du proprietaire.
   *
   * `SET LOCAL ROLE` borne a la tx -> pas de pollution du pool.
   */
  async asAppRole<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL ROLE "roadsen_app"`;
      return fn(tx);
    });
  }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertUuid(value: string): void {
  if (!UUID_RE.test(value)) {
    throw new Error(`org_id invalide (UUID attendu) : ${value}`);
  }
}
