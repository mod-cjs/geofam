// =====================================================================
//  Application MANUELLE de la migration 0020 en recette (node pg).
//
//  Usage :  DATABASE_URL="postgres://..." node apply-recette.mjs
//
//  A jouer par un HUMAIN, apres 0019, sous le compte de deploiement (membre de
//  roadsen_auth + CREATE sur public ; PAS besoin de BYPASSRLS). Ce script :
//    - pose SET lock_timeout (echec franc plutot que hang sur une ligne memberships
//      verrouillee) ;
//    - ouvre UNE transaction (BEGIN) : soit tout passe, soit rien (0020 est reversible) ;
//    - applique migration.sql (CREATE OR REPLACE des 3 fonctions + GRANT DELETE — idempotent) ;
//    - enregistre la ligne _prisma_migrations avec le checksum sha256 du fichier (format
//      Prisma) pour qu'un `prisma migrate deploy` ulterieur la voie APPLIQUEE sans conflit ;
//    - COMMIT.
//  Rollback documente : down.sql (restaure les corps 0011/0007/0013 + REVOKE DELETE).
//
//  ⚠️ NE regularise PAS les users multi-org preexistants : voir regularize-multi-org.mjs
//     (script SEPARE, applique a la main APRES decision humaine).
//
//  ⚠️ NE PAS lancer en prod sans la revue d'isolation ingenieur-securite + un plan de
//  rollback (regle CLAUDE.md : migration multi-tenant = binome + test d'isolation post-migration).
// =====================================================================
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const HERE = dirname(fileURLToPath(import.meta.url));
const NAME = '0020_one_org_and_hard_remove';
const sql = readFileSync(join(HERE, 'migration.sql'), 'utf8');
// Checksum Prisma = sha256 (hex) des octets du fichier migration.sql.
const checksum = createHash('sha256').update(readFileSync(join(HERE, 'migration.sql'))).digest('hex');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL requis.');
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });

try {
  await client.connect();
  await client.query("SET lock_timeout = '3s'");
  await client.query('BEGIN');
  await client.query(sql);
  await client.query(
    `INSERT INTO _prisma_migrations
       (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
     VALUES ($1, $2, now(), $3, NULL, NULL, now(), 1)
     ON CONFLICT (id) DO NOTHING`,
    [randomUUID(), checksum, NAME],
  );
  await client.query('COMMIT');
  console.log(`0020 applique + enregistre (checksum ${checksum.slice(0, 12)}...).`);
} catch (err) {
  try {
    await client.query('ROLLBACK');
  } catch {
    /* rien : la tx est deja avortee/fermee */
  }
  console.error('Echec 0020 (rollback effectue) :', err.message ?? err);
  process.exit(1);
} finally {
  await client.end();
}
