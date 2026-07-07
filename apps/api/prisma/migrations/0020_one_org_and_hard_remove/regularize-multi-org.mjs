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
//  PORTEE (0021) : « un user = une org » vaut pour TOUTE appartenance — ACTIVE **ou
//  INACTIVE**. Un user suspendu (is_active=false) dans une autre org compte comme un
//  rattachement (il pourrait etre reactive : cf. garde one-org de la reactivation,
//  0021). On regularise donc les doublons INACTIFS aussi, pas seulement les actifs.
//
//  REGLE DE CONSERVATION (par user en surnombre) : on GARDE UNE SEULE appartenance et
//  on RETIRE les autres. Choix de celle a conserver, dans l'ordre :
//    1) une appartenance OWNER ACTIVE (priorite absolue : ne jamais orphaniser une org) ;
//    2) a defaut, la PLUS ANCIENNE des ACTIVES — l'org « vivante » du user ;
//    3) a defaut (aucune active), une OWNER (meme inactive : preserve l'org) ;
//    4) a defaut, la PLUS ANCIENNE tout court.
//  Les autres appartenances (ACTIVES OU INACTIVES) sont retirees (HARD DELETE).
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

/**
 * Choisit l'appartenance a CONSERVER (cf. en-tete, ordre 1->4) : OWNER active
 * d'abord, sinon la plus ancienne ACTIVE, sinon une OWNER (meme inactive), sinon
 * la plus ancienne tout court. `rows` contient TOUTES les appartenances (actives
 * ET inactives), deja triees created_at ASC par l'appelant.
 */
function pickKeep(rows) {
  const byAge = (a, b) =>
    new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  const actives = rows.filter((r) => r.is_active);
  const activeOwner = actives.find((r) => r.role === 'OWNER');
  if (activeOwner) return activeOwner; // 1
  if (actives.length > 0) return [...actives].sort(byAge)[0]; // 2
  const anyOwner = rows.find((r) => r.role === 'OWNER');
  if (anyOwner) return anyOwner; // 3
  return [...rows].sort(byAge)[0]; // 4
}

try {
  await client.connect();

  // 1) Users avec > 1 appartenance TOTALE (ACTIVE OU INACTIVE) : un doublon inactif
  //    dans une autre org viole aussi « un user = une org » (il pourrait etre reactive).
  const { rows: dupUsers } = await client.query(
    `SELECT user_id, count(*)::int AS n
     FROM memberships
     GROUP BY user_id
     HAVING count(*) > 1
     ORDER BY user_id`,
  );

  if (dupUsers.length === 0) {
    console.log('Aucun user multi-org (actif ou inactif) : rien a regulariser.');
    process.exit(0);
  }

  console.log(`${dupUsers.length} user(s) multi-org detecte(s) (actifs ou inactifs).\n`);

  const toRemove = []; // { org_id, user_id, role }
  const skipped = []; // cas a arbitrer a la main

  for (const { user_id } of dupUsers) {
    const { rows } = await client.query(
      `SELECT org_id, user_id, role, is_active, created_at
       FROM memberships
       WHERE user_id = $1
       ORDER BY created_at ASC`,
      [user_id],
    );
    const keep = pickKeep(rows);
    console.log(
      `user ${user_id} : conserve org ${keep.org_id} (${keep.role}` +
        `${keep.is_active ? '' : ', inactive'})`,
    );

    for (const m of rows) {
      if (m.org_id === keep.org_id) continue;

      // Garde-fou : ne pas laisser l'org de m SANS owner actif. On ne retire une ligne
      // OWNER que si l'org a un AUTRE owner actif (une ligne OWNER inactive ne fournit
      // deja aucun owner actif, mais on applique la meme prudence : jamais de retrait
      // qui laisse l'org sans owner actif).
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
      console.log(
        `  - retire org ${m.org_id} (${m.role}${m.is_active ? '' : ', inactive'})`,
      );
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
