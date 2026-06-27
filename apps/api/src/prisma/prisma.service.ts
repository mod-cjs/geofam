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
 * INVARIANT D'AUTH (migration 0007) : NE JAMAIS appeler une fonction DEFINER
 * d'auth/bootstrap (auth_find_user_by_email, auth_user_has_membership,
 * auth_get_platform_role, auth_get_user_profile, provision_user, provision_org)
 * a l'INTERIEUR d'un `withTenant`. Ces fonctions posent un drapeau de confiance
 * `app.auth_bootstrap` qui ouvre la branche RLS d'IDENTITE ; il est tx-local et
 * referme avant leur RETURN. Appelees en AUTO-COMMIT (hors transaction, comme le
 * fait AuthService via $queryRaw), le drapeau ne survit pas a l'appel. Les glisser
 * dans la MEME transaction qu'une requete tenant exposerait une fenetre ou le
 * drapeau pourrait etre actif pour d'autres requetes de la tx. AuthService lit donc
 * l'identite HORS withTenant ; withTenant ne sert QU'aux tables de donnees tenant.
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
   * Execute `fn` dans une transaction scopee au tenant `orgId`.
   * Le client transactionnel passe a `fn` voit RLS applique sur ce seul org.
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
      // set_config(name, value, is_local=true) == SET LOCAL, mais accepte un
      // parametre lie -> pas d'interpolation de chaine (anti-injection).
      await tx.$executeRaw`SELECT set_config('app.current_org', ${orgId}, true)`;
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
