// =====================================================================
//  REGULARISATION des users MULTI-ORG preexistants (decision one-org, 0020).
//
//  ⚠️ NON APPLIQUE automatiquement. A relire, puis lancer A LA MAIN par un HUMAIN,
//     APRES la migration 0020 et APRES revue. Il MODIFIE des donnees d'identite.
//
//  Usage :
//    DRY-RUN (defaut, n'ecrit RIEN, se contente d'AFFICHER le plan) :
//        DATABASE_URL="postgres://..." node regularize-multi-org.mjs
//    APPLICATION REELLE (ecrit) :
//        DATABASE_URL="postgres://..." APPLY=1 node regularize-multi-org.mjs
//
//  REGLE DE CONSERVATION (par user en surnombre) : on GARDE UNE SEULE appartenance et
//  on RETIRE les autres. Choix de celle a conserver, dans l'ordre :
//    1) une appartenance OWNER (priorite absolue : ne jamais laisser une org sans owner) ;
//    2) a defaut, la PLUS ANCIENNE (created_at min) — l'org « historique » du user.
//  Les autres appartenances ACTIVES du user sont retirees (HARD DELETE, comme remove_member).
//
//  GARDE-FOU CRITIQUE : on ne retire JAMAIS une appartenance si cela laisserait SON org
//  SANS OWNER ACTIF. Concretement : on ne retire une ligne OWNER que si l'org a un AUTRE
//  OWNER actif. Si le retrait romprait ce garde-fou pour une org, la ligne est CONSERVEE
//  et le cas est SIGNALE (a arbitrer a la main : transfert d'owner d'abord). On ne casse
//  donc jamais « un owner unique d'une org ».
//
//  Ce script s'execute en connexion ADMIN (DATABASE_URL de deploiement) : il ecrit
//  memberships directement (comme les seeds/teardown des e2e), hors du chemin runtime.
//  Il ne touche PAS admin_audit_log (regularisation manuelle, hors journal admin).
// =====================================================================
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL requis.');
  process.exit(1);
}
const APPLY = process.env.APPLY === '1';

const client = new pg.Client({ connectionString: url });

/** Choisit l'appartenance a CONSERVER : OWNER d'abord, sinon la plus ancienne. */
function pickKeep(rows) {
  const owner = rows.find((r) => r.role === 'OWNER');
  if (owner) return owner;
  return [...rows].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  )[0];
}

try {
  await client.connect();

  // 1) Users avec > 1 appartenance ACTIVE.
  const { rows: dupUsers } = await client.query(
    `SELECT user_id, count(*)::int AS n
     FROM memberships
     WHERE is_active = true
     GROUP BY user_id
     HAVING count(*) > 1
     ORDER BY user_id`,
  );

  if (dupUsers.length === 0) {
    console.log('Aucun user multi-org actif : rien a regulariser.');
    process.exit(0);
  }

  console.log(`${dupUsers.length} user(s) multi-org actif(s) detecte(s).\n`);

  const toRemove = []; // { org_id, user_id, role }
  const skipped = []; // cas a arbitrer a la main

  for (const { user_id } of dupUsers) {
    const { rows } = await client.query(
      `SELECT org_id, user_id, role, created_at
       FROM memberships
       WHERE user_id = $1 AND is_active = true
       ORDER BY created_at ASC`,
      [user_id],
    );
    const keep = pickKeep(rows);
    console.log(`user ${user_id} : conserve org ${keep.org_id} (${keep.role})`);

    for (const m of rows) {
      if (m.org_id === keep.org_id) continue;

      // Garde-fou : ne pas laisser l'org de m SANS owner actif.
      if (m.role === 'OWNER') {
        const { rows: others } = await client.query(
          `SELECT count(*)::int AS n
           FROM memberships
           WHERE org_id = $1 AND role = 'OWNER' AND is_active = true AND user_id <> $2`,
          [m.org_id, user_id],
        );
        if (others[0].n === 0) {
          console.log(
            `  ! SKIP org ${m.org_id} : ce user en est le SEUL OWNER actif ` +
              `-> a arbitrer (transfert d'owner d'abord).`,
          );
          skipped.push({ user_id, org_id: m.org_id });
          continue;
        }
      }
      console.log(`  - retire org ${m.org_id} (${m.role})`);
      toRemove.push({ org_id: m.org_id, user_id, role: m.role });
    }
  }

  console.log(
    `\nPlan : ${toRemove.length} appartenance(s) a retirer, ${skipped.length} cas a arbitrer.`,
  );

  if (!APPLY) {
    console.log('\nDRY-RUN (APPLY!=1) : aucune ecriture. Relancer avec APPLY=1 pour appliquer.');
    process.exit(0);
  }

  await client.query('BEGIN');
  for (const m of toRemove) {
    await client.query(
      `DELETE FROM memberships WHERE org_id = $1 AND user_id = $2`,
      [m.org_id, m.user_id],
    );
  }
  await client.query('COMMIT');
  console.log(`\nApplique : ${toRemove.length} appartenance(s) retiree(s).`);
} catch (err) {
  try {
    await client.query('ROLLBACK');
  } catch {
    /* rien */
  }
  console.error('Echec regularisation (rollback effectue) :', err.message ?? err);
  process.exit(1);
} finally {
  await client.end();
}
