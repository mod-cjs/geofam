/**
 * CLI GARDÉ — bootstrap du premier SUPERADMIN du back-office STARFIRE.
 * =====================================================================
 * Pourquoi ce script existe : le SUPERADMIN (privilège MAXIMAL, cross-tenant) est
 * VOLONTAIREMENT injoignable par l'application — `provision_user` (et donc
 * POST /admin/users) ne pose JAMAIS `platform_role`, et aucune route ne l'assigne.
 * C'est un choix de sécurité (pas d'escalade possible vers SUPERADMIN via l'API).
 * Le seul moyen de créer un SUPERADMIN = une écriture d'identité privilégiée en base.
 * Ce script encapsule ce bootstrap avec des GARDE-FOUS, pour ne plus toucher au SQL à la main.
 *
 * ⚠️ À exécuter avec le credential ADMIN de la base (DATABASE_URL = propriétaire/superuser),
 *    JAMAIS avec roadsen_app (NOBYPASSRLS ne peut pas écrire platform_role).
 *
 * Autonome À DESSEIN (aucun import de src/) : évite les soucis de résolution nodenext et
 * garde le bootstrap exécutable même sans build. Le hachage reproduit EXACTEMENT
 * src/auth/password.ts (argon2id, paramètres par défaut) — argon2.verify au login accepte
 * ce hash. La validation reproduit src/auth/dto.ts createUserSchema (email · mdp ≥ 12 · nom).
 *
 * Usage (variables d'environnement — le mot de passe N'EST PAS en argv, pour ne pas
 * fuiter dans l'historique shell / la liste des process) :
 *
 *   DATABASE_URL='postgres://...(admin)...' \
 *   SUPERADMIN_EMAIL='admin@exemple.sn' \
 *   SUPERADMIN_PASSWORD='un-mot-de-passe-fort-de-12-caracteres-min' \
 *   SUPERADMIN_FULL_NAME='Super Admin STARFIRE' \
 *   CONFIRM_CREATE_SUPERADMIN=oui \
 *   pnpm --filter @roadsen/api create-superadmin
 *
 * Promouvoir un compte EXISTANT (change le rôle, NE touche PAS au mot de passe) :
 *   ajouter PROMOTE=oui (le mot de passe devient inutile).
 *
 * Idempotent : si l'email est déjà SUPERADMIN, ne fait rien.
 */
import * as argon2 from 'argon2';
import { Client } from 'pg';
import { z } from 'zod';

// Mêmes règles que src/auth/dto.ts createUserSchema (source de vérité de l'app).
const inputSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  password: z.string().min(12).max(1024),
  fullName: z.string().trim().min(1).max(200),
});

function fail(msg: string): never {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  // --- Garde-fous d'entrée -------------------------------------------------
  const url = process.env.DATABASE_URL;
  if (!url) {
    fail(
      'DATABASE_URL requis — utilisez le credential ADMIN de la base (propriétaire), pas roadsen_app.',
    );
  }
  if (process.env.CONFIRM_CREATE_SUPERADMIN !== 'oui') {
    fail(
      'Garde-fou : cette action crée un privilège MAXIMAL. Relancez avec CONFIRM_CREATE_SUPERADMIN=oui.',
    );
  }
  const promote = process.env.PROMOTE === 'oui';

  // En mode PROMOTE, le mot de passe n'est pas requis : placeholder valide, jamais utilisé.
  const parsed = inputSchema.safeParse({
    email: process.env.SUPERADMIN_EMAIL,
    password: promote
      ? 'promotion-placeholder-non-utilise'
      : process.env.SUPERADMIN_PASSWORD,
    fullName: process.env.SUPERADMIN_FULL_NAME,
  });
  if (!parsed.success) {
    fail(
      'Entrées invalides (SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD >= 12 / SUPERADMIN_FULL_NAME) :\n  ' +
        parsed.error.issues
          .map((i) => `${i.path.join('.') || '(racine)'} — ${i.message}`)
          .join('\n  '),
    );
  }
  const { email, password, fullName } = parsed.data;

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    // Montre l'ENVIRONNEMENT cible (base/host/rôle) — le mot de passe n'est JAMAIS affiché.
    const who = await client.query<{
      db: string;
      host: string | null;
      usr: string;
    }>(
      `SELECT current_database() AS db, inet_server_addr()::text AS host, current_user AS usr`,
    );
    const info = who.rows[0];
    console.log(
      `\nCible : base « ${info?.db} » (host ${info?.host ?? 'local/socket'}) en tant que « ${info?.usr} ».`,
    );

    const existing = await client.query<{
      id: string;
      platform_role: string | null;
    }>(`SELECT id, platform_role FROM users WHERE email = $1`, [email]);

    if (existing.rows.length > 0) {
      const row = existing.rows[0];
      if (row.platform_role === 'SUPERADMIN') {
        console.log(
          `✓ ${email} est DÉJÀ SUPERADMIN — rien à faire (idempotent).\n`,
        );
        return;
      }
      if (!promote) {
        fail(
          `Le compte ${email} existe déjà (platform_role=${row.platform_role ?? 'NULL'}). ` +
            `Pour le promouvoir SANS changer son mot de passe, relancez avec PROMOTE=oui.`,
        );
      }
      await client.query(
        `UPDATE users SET platform_role='SUPERADMIN', updated_at=now() WHERE id=$1`,
        [row.id],
      );
      console.log(`✓ ${email} PROMU SUPERADMIN (mot de passe inchangé).\n`);
      return;
    }

    if (promote) {
      fail(
        `PROMOTE=oui demandé mais aucun compte ${email} n'existe. Créez-le d'abord (sans PROMOTE) ou vérifiez l'email.`,
      );
    }

    // Création : hachage argon2id (mêmes paramètres que src/auth/password.ts) + INSERT.
    const hash = await argon2.hash(password, { type: argon2.argon2id });
    const res = await client.query<{ id: string }>(
      `INSERT INTO users (id, email, password_hash, full_name, platform_role, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, 'SUPERADMIN', now())
       RETURNING id`,
      [email, hash, fullName],
    );
    console.log(
      `✓ SUPERADMIN créé : ${email} (id ${res.rows[0]?.id}).\n  Connexion via POST /auth/login puis /admin.\n`,
    );
  } finally {
    await client.end();
  }
}

main().catch((e: unknown) => fail(e instanceof Error ? e.message : String(e)));
