/**
 * Test d'ISOLATION multi-tenant (RLS FORCE) — preuve cote base.
 *
 * Ce test exige une base PostgreSQL REELLE avec les migrations 0001 ET 0002
 * appliquees (pnpm db:up && prisma migrate deploy). Il valide, en se connectant
 * comme un role applicatif NON-proprietaire/NON-superuser (roadsen_app,
 * NOBYPASSRLS) :
 *
 *   projects :
 *     1) Sans `app.current_org` pose  -> AUCUNE ligne visible (fail-closed).
 *     2) org A pose -> voit seulement A, jamais B (etancheite SELECT).
 *     3) WITH CHECK : impossible d'INSERER une ligne pour un autre org.
 *     4) FORCE : meme un UPDATE "aveugle" ne touche pas les lignes d'un autre org.
 *   organizations (policy 0002, scope id = app.current_org) :
 *     5) org A pose -> SELECT ne renvoie QUE orgA, jamais orgB.
 *     6) WITH CHECK : impossible d'INSERER une organisation pour un autre id.
 *   users (policy 0002, scope membership partage) :
 *     7) org A pose -> SELECT ne renvoie QUE userA ; userB ET son password_hash
 *        sont invisibles (enjeu CDP / PII).
 *
 * DEUX CONNEXIONS DISTINCTES :
 *   - admin/seed  = DATABASE_URL (en CI = role 'roadsen', SUPERUSER du service
 *     Postgres -> bypasse RLS, y compris FORCE). Sert UNIQUEMENT au seed et au
 *     teardown. C'est le pattern correct de setup privilegie : depuis 0002,
 *     organizations & users sont sous RLS FORCE, donc un seed sous roadsen_app
 *     buterait sur les WITH CHECK (ex. inserer orgB pendant que app.current_org
 *     = orgA est rejete). Le superuser bypasse RLS et seede proprement.
 *   - app/assertions = RLS_TEST_DATABASE_URL (role roadsen_app, NOBYPASSRLS).
 *     Sert UNIQUEMENT aux assertions d'isolation : c'est sous CE role que FORCE
 *     ROW LEVEL SECURITY s'exerce reellement.
 *
 * SUIVI (hors-scope de ce ticket) : la creation d'un user en PRODUCTION (hors
 * test) ne peut PAS passer par un superuser. Elle devra emprunter une voie
 * SECURITY DEFINER dediee (ex. provision_user) couplee au flux d'auth (#41),
 * sur le modele de provision_org de 0002. C'est un point a formaliser, pas
 * l'objet de ce test : ici le seed superuser EST le setup privilegie attendu.
 *
 * ANTI-SKIP (gating CI) : en CI (process.env.CI === 'true') OU des qu'une URL
 * de base est fournie, l'absence de connexion joignable est un ECHEC DUR, pas
 * un skip silencieux. Un test final exige qu'AU MOINS 6 cas d'isolation aient
 * REELLEMENT passe. "0 cas execute" en CI = CI rouge. En dev local sans base,
 * et SANS marqueur CI, les cas sont marques non-executes (honnetete
 * d'ingenieur) mais ce chemin est interdit en CI.
 *
 * Connexion : on utilise le client `pg` brut plutot que Prisma pour pouvoir
 * choisir le ROLE par connexion (superuser pour le seed, roadsen_app pour les
 * assertions) et exercer FORCE ROW LEVEL SECURITY (le proprietaire/superuser
 * le contournerait, d'ou le besoin du role applicatif cote assertions).
 */
import { randomUUID } from 'node:crypto';

// pg n'est pas encore une dependance du socle : import paresseux + skip propre
// si indisponible, plutot qu'un echec de compilation.
type PgClient = {
  connect: () => Promise<void>;
  query: <R = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ) => Promise<{ rows: R[] }>;
  end: () => Promise<void>;
};

// Connexion ASSERTIONS : role applicatif NOBYPASSRLS. RLS_TEST_DATABASE_URL
// prime ; fallback DATABASE_URL en dernier ressort (poste dev mono-URL), mais
// en CI les deux URLs sont distinctes (cf. ci.yml).
const APP_URL =
  process.env.RLS_TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? '';
// Connexion SEED/admin : superuser qui bypasse RLS pour le setup privilegie.
const ADMIN_URL = process.env.DATABASE_URL ?? '';

// En CI, ou des qu'une URL est fournie, on EXIGE une vraie preuve d'isolation.
// GitHub Actions pose toujours CI=true. On ne tolere le mode "non execute" que
// hors-CI ET sans aucune URL (poste developpeur sans base locale).
const ENFORCE =
  process.env.CI === 'true' || APP_URL.length > 0 || ADMIN_URL.length > 0;

function loadPgClient(): new (cfg: { connectionString: string }) => PgClient {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pg = require('pg') as {
      Client: new (cfg: { connectionString: string }) => PgClient;
    };
    return pg.Client;
  } catch {
    throw new Error(
      "Dependance 'pg' introuvable : le test d'isolation ne peut pas se " +
        'connecter. Installer pg (devDependency @roadsen/api).',
    );
  }
}

async function connectAs(url: string, label: string): Promise<PgClient> {
  if (!url) {
    throw new Error(
      `${label} absent : impossible de prouver l'isolation. En CI, fournir ` +
        'DATABASE_URL (superuser, seed) ET RLS_TEST_DATABASE_URL (roadsen_app).',
    );
  }
  const Client = loadPgClient();
  const client = new Client({ connectionString: url });
  await client.connect(); // une base injoignable doit ECHOUER, pas etre masquee
  return client;
}

describe('Isolation multi-tenant RLS FORCE (projects + organizations + users)', () => {
  let admin: PgClient | null = null; // seed/teardown : superuser, bypasse RLS
  let app: PgClient | null = null; // assertions : roadsen_app, NOBYPASSRLS
  let connectError: Error | null = null;
  let passedCases = 0; // nombre de cas d'isolation REELLEMENT verifies
  const orgA = randomUUID();
  const orgB = randomUUID();
  const userA = randomUUID();
  const userB = randomUUID();

  beforeAll(async () => {
    try {
      // Connexion admin (seed) puis app (assertions). Les deux doivent etre
      // joignables : en CI, l'une manquante = echec dur (pas de faux-vert).
      admin = await connectAs(ADMIN_URL, 'DATABASE_URL (seed/superuser)');
      app = await connectAs(APP_URL, 'RLS_TEST_DATABASE_URL (roadsen_app)');
    } catch (err) {
      connectError = err as Error;
      // En CI / avec URL : on NE masque PAS. L'echec remonte ici meme, ce qui
      // fait echouer tout le describe (aucun faux-vert possible).
      if (ENFORCE) throw connectError;
      return; // hors-CI sans base : chemin "non execute" tolere uniquement ici
    }

    // SEED via la connexion ADMIN (superuser -> bypasse RLS, y compris FORCE).
    // Depuis 0002, organizations & users sont sous RLS FORCE : ce bypass est la
    // SEULE facon propre de seeder un etat multi-org sans buter sur les WITH
    // CHECK. On NE pose donc PAS app.current_org cote seed (inutile : bypass).
    //
    // On materialise un graphe complet a 2 tenants :
    //   users        : userA, userB
    //   organizations: orgA, orgB
    //   memberships  : userA in orgA, userB in orgB
    //   projects     : projectA (orgA, by userA), projectB (orgB, by userB)
    // memberships est indispensable : la policy users de 0002 ne rend visible un
    // user que s'il PARTAGE un membership avec l'org courante. Sans ces lignes,
    // le cas users ne prouverait rien.
    await admin.query(
      `INSERT INTO users (id, email, password_hash, full_name, updated_at)
       VALUES ($1,$2,$3,$4,now())`,
      [userA, `a-${userA.slice(0, 8)}@roadsen.test`, 'hash-A-SECRET', 'User A'],
    );
    await admin.query(
      `INSERT INTO users (id, email, password_hash, full_name, updated_at)
       VALUES ($1,$2,$3,$4,now())`,
      [userB, `b-${userB.slice(0, 8)}@roadsen.test`, 'hash-B-SECRET', 'User B'],
    );
    await admin.query(
      `INSERT INTO organizations (id, name, slug, "updatedAt") VALUES ($1,$2,$3,now())`,
      [orgA, 'Org A', `org-a-${orgA.slice(0, 8)}`],
    );
    await admin.query(
      `INSERT INTO organizations (id, name, slug, "updatedAt") VALUES ($1,$2,$3,now())`,
      [orgB, 'Org B', `org-b-${orgB.slice(0, 8)}`],
    );
    await admin.query(
      `INSERT INTO memberships (id, org_id, user_id, role) VALUES ($1,$2,$3,'OWNER')`,
      [randomUUID(), orgA, userA],
    );
    await admin.query(
      `INSERT INTO memberships (id, org_id, user_id, role) VALUES ($1,$2,$3,'OWNER')`,
      [randomUUID(), orgB, userB],
    );
    await admin.query(
      `INSERT INTO projects (id, org_id, name, created_by_id, updated_at) VALUES ($1,$2,'P-A',$3,now())`,
      [randomUUID(), orgA, userA],
    );
    await admin.query(
      `INSERT INTO projects (id, org_id, name, created_by_id, updated_at) VALUES ($1,$2,'P-B',$3,now())`,
      [randomUUID(), orgB, userB],
    );
  });

  afterAll(async () => {
    // Teardown via la connexion ADMIN (bypasse RLS -> peut tout supprimer).
    // Ordre respectant les FK : projects/memberships -> users/organizations.
    if (admin) {
      try {
        await admin.query(`DELETE FROM projects WHERE org_id IN ($1,$2)`, [
          orgA,
          orgB,
        ]);
        await admin.query(`DELETE FROM memberships WHERE org_id IN ($1,$2)`, [
          orgA,
          orgB,
        ]);
        await admin.query(`DELETE FROM organizations WHERE id IN ($1,$2)`, [
          orgA,
          orgB,
        ]);
        await admin.query(`DELETE FROM users WHERE id IN ($1,$2)`, [
          userA,
          userB,
        ]);
      } finally {
        await admin.end();
      }
    }
    if (app) await app.end();
  });

  const guarded = (name: string, fn: () => Promise<void>) => {
    it(name, async () => {
      if (!app) {
        if (ENFORCE) {
          // Ne devrait jamais arriver (beforeAll a deja throw), mais on verrouille :
          throw (
            connectError ??
            new Error(`Base RLS non joignable en CI : ${name} non prouve.`)
          );
        }

        console.warn(
          `[NON EXECUTE] ${name} — aucune base RLS joignable (hors CI).`,
        );
        return; // marque comme non execute, PAS comme reussi (dev local seulement)
      }
      await fn();
      passedCases += 1; // un cas n'est compte que s'il est alle au bout sans throw
    });
  };

  // --- projects -------------------------------------------------------------

  guarded('1) projects : sans org pose -> 0 ligne (fail-closed)', async () => {
    await app!.query(`RESET app.current_org`);
    const { rows } = await app!.query('SELECT * FROM projects');
    expect(rows).toHaveLength(0);
  });

  guarded('2) projects : org A ne voit que ses projets', async () => {
    await app!.query(`SET app.current_org = '${orgA}'`);
    const { rows } = await app!.query<{ org_id: string; name: string }>(
      'SELECT org_id, name FROM projects',
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.org_id === orgA)).toBe(true);
    expect(rows.some((r) => r.name === 'P-B')).toBe(false);
  });

  guarded('3) projects : WITH CHECK refuse un INSERT cross-org', async () => {
    await app!.query(`SET app.current_org = '${orgA}'`);
    await expect(
      app!.query(
        `INSERT INTO projects (id, org_id, name, created_by_id, updated_at) VALUES ($1,$2,'fraude',$3,now())`,
        [randomUUID(), orgB, userA],
      ),
    ).rejects.toThrow();
  });

  guarded(
    '4) projects : UPDATE aveugle ne touche pas les lignes de B',
    async () => {
      await app!.query(`SET app.current_org = '${orgA}'`);
      const { rows } = await app!.query<{ org_id: string }>(
        `UPDATE projects SET name = 'pwn' RETURNING org_id`,
      );
      expect(rows.every((r) => r.org_id === orgA)).toBe(true);
    },
  );

  // --- organizations (policy 0002 : id = app.current_org) -------------------

  guarded(
    '5) organizations : org A ne voit QUE orgA, jamais orgB',
    async () => {
      await app!.query(`SET app.current_org = '${orgA}'`);
      const { rows } = await app!.query<{ id: string }>(
        'SELECT id FROM organizations',
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(orgA);
      expect(rows.some((r) => r.id === orgB)).toBe(false);
    },
  );

  guarded(
    '6) organizations : WITH CHECK refuse de creer une org pour un autre id',
    async () => {
      // Sous orgA, tenter d'inserer orgB : le WITH CHECK (id = app.current_org)
      // doit rejeter (id != orgA). Preuve que le runtime ne peut pas fabriquer
      // d'organisation hors de son tenant courant.
      await app!.query(`SET app.current_org = '${orgA}'`);
      await expect(
        app!.query(
          `INSERT INTO organizations (id, name, slug, "updatedAt") VALUES ($1,$2,$3,now())`,
          [orgB, 'fraude', `fraude-${randomUUID().slice(0, 8)}`],
        ),
      ).rejects.toThrow();
    },
  );

  // --- users (policy 0002 : membership partage avec l'org courante) ---------

  guarded(
    '7) users : org A ne voit QUE userA ; userB et son password_hash invisibles',
    async () => {
      await app!.query(`SET app.current_org = '${orgA}'`);
      const { rows } = await app!.query<{ id: string; password_hash: string }>(
        'SELECT id, password_hash FROM users',
      );
      // Seul userA partage un membership avec orgA -> seul user visible.
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(userA);
      // userB totalement invisible : ni la ligne, ni son hash ne fuitent.
      expect(rows.some((r) => r.id === userB)).toBe(false);
      expect(rows.some((r) => r.password_hash === 'hash-B-SECRET')).toBe(false);
    },
  );

  // GARDE-FOU ANTI-FAUX-VERT : en CI / avec URL, on EXIGE qu'au moins 6 cas
  // d'isolation aient reellement passe (4 projects + 2 organizations + 1 users
  // = 7 cas ; seuil pose a 6 pour garder une marge sans masquer une suite videe).
  // Si la suite avait ete videe, mal matchee, ou silencieusement sautee, ce test
  // echoue (CI rouge).
  it('couverture : >= 6 cas d isolation reellement executes (en CI/avec URL)', () => {
    if (!ENFORCE) {
      console.warn(
        '[NON EXECUTE] verification de couverture ignoree hors CI et sans URL.',
      );
      return;
    }
    expect(passedCases).toBeGreaterThanOrEqual(6);
  });
});
