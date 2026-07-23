/**
 * COURSE « EMISSION DE PV » x « SUPPRESSION DEFINITIVE » — e2e de CONCURRENCE
 * REELLE contre Postgres reel (deux requetes HTTP en vol, entrelacement IMPOSE).
 *
 * LE DEFAUT QUE CE TEST REPRODUIT (revue adverse — TOCTOU)
 * -------------------------------------------------------
 * `deletePermanently` lit le projet, COMPTE les PV scelles, puis supprime. Le
 * chemin d'emission lit le projet (garde d'ecriture) puis insere l'official_pv.
 * Aucun verrou, transactions en READ COMMITTED : les deux fenetres se recouvrent.
 *   T1 : POST .../calc-results/:id/pv  -> lit le projet : ECRIVABLE ;
 *   T2 : DELETE .../permanent          -> compte 0 PV, supprime, COMMIT ;
 *   T1 : INSERT official_pv            -> PV SCELLE, NUMEROTE, FACTURE, dont le
 *        projet n'existe plus.
 * La base ne l'arrete pas : official_pvs n'a AUCUNE FK vers projects (choix
 * « autoportant » du schema). Le seul objet non protege est donc exactement le
 * livrable que le 409 pretend garantir. Le meme entrelacement sur un CALCUL ou
 * une CAPTURE echoue proprement, lui, grace a la FK composite (org_id, project_id).
 *
 * COMMENT L'ENTRELACEMENT EST RENDU DETERMINISTE (pas de sleep, pas de hasard)
 * --------------------------------------------------------------------------
 * On ne peut pas suspendre le service depuis le test (aucun crochet de test dans
 * le code de production, et on n'en ajoute pas). On utilise donc un VERROU DE
 * LIGNE POSTGRES pose par une 3e connexion (`bloqueur`) sur un objet que la
 * transaction cible DOIT verrouiller a un point precis de son deroule :
 *
 *  - scenario A (emission puis suppression) : verrou sur `pv_counters` (org, annee).
 *    L'emission bloque dans `allocate_pv_number` — donc APRES sa lecture du projet
 *    et AVANT son INSERT. C'est exactement la fenetre du defaut.
 *  - scenario B (suppression puis emission) : verrou sur la ligne `calc_results`.
 *    La suppression bloque sur son `DELETE FROM calc_results` — donc APRES sa
 *    lecture/comptage et AVANT son COMMIT.
 *
 * Le test ATTEND (sondage de pg_stat_activity, jamais un `sleep` arbitraire) que
 * la transaction soit REELLEMENT bloquee avant de lancer la seconde ; il ECHOUE
 * DUR si l'attente expire (un entrelacement non obtenu = test NON concluant, pas
 * un test vert).
 *
 * CE QUI EST EXIGE (given/when/then)
 *  #A GIVEN une emission de PV en vol sur un projet sans PV, WHEN une suppression
 *     definitive du meme projet s'execute en parallele, THEN les deux ne peuvent
 *     PAS reussir toutes les deux, et AUCUN PV orphelin n'existe en base.
 *  #B GIVEN une suppression definitive en vol, WHEN une emission de PV demarre sur
 *     le meme projet, THEN l'emission ne scelle RIEN sur un projet detruit (404)
 *     et AUCUN PV orphelin n'existe en base.
 *  #C CONTRE-PREUVE EN BASE (DoD §3) : aucun `official_pvs` cree par ce test n'a
 *     un `project_id` sans ligne dans `projects`, et le nombre d'orphelins de la
 *     base ENTIERE n'a pas augmente (mesure avant/apres — la base de dev en porte
 *     deja quelques-uns, residus d'autres suites : on interdit toute AUGMENTATION,
 *     on ne pretend pas nettoyer l'existant).
 *  #E ARCHIVAGE CONCURRENT : archiver EST le geste « supprimer » de l'interface,
 *     et un PV scelle sur un projet archive est INVISIBLE dans toutes les listes
 *     (defaut PR #120). Le verrou partage doit donc empecher un archivage de
 *     s'intercaler entre le controle du projet et l'INSERT du PV — pas seulement
 *     une destruction physique.
 *  #D NON-SERIALISATION : deux emissions concurrentes sur le MEME projet ne se
 *     bloquent pas l'une l'autre a cause du verrou partage (elles ne serialisent
 *     que sur le compteur de numeros, comme avant). Sans ce cas, on pourrait
 *     « corriger » la course avec un verrou exclusif et degrader tout le service
 *     sans qu'aucun test ne proteste.
 *
 * ANTI-SKIP : DATABASE_URL absent ET CI -> echec dur. Hors CI sans base ->
 * non-execute (honnete), jamais compte comme reussi.
 */
import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { BURMISTER_FIXTURES } from '@roadsen/engines';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { hashPassword } from '../src/auth/password';

type PgClient = {
  connect: () => Promise<void>;
  query: <R = unknown>(
    sql: string,
    params?: unknown[],
  ) => Promise<{ rows: R[] }>;
  end: () => Promise<void>;
};
type PgClientCtor = new (cfg: { connectionString: string }) => PgClient;

interface CalcBody {
  calcResultId?: unknown;
}
interface ErreurBody {
  message?: string;
}

const ADMIN_URL = process.env.DATABASE_URL ?? '';
const ENFORCE = process.env.CI === 'true' || ADMIN_URL.length > 0;

function loadPgClient(): PgClientCtor {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('pg') as { Client: PgClientCtor };
  return mod.Client;
}

describe('Course émission de PV × suppression définitive (e2e Postgres réel)', () => {
  let app: INestApplication | null = null;
  let admin: PgClient | null = null;
  let bloqueur: PgClient | null = null;
  let connectError: Error | null = null;

  const org = randomUUID();
  const slug = `race-${org.slice(0, 8)}`;
  const owner = randomUUID();

  const projA = randomUUID(); // scénario A : émission en vol, puis suppression
  const projB = randomUUID(); // scénario B : suppression en vol, puis émission
  const projD = randomUUID(); // scénario D : deux émissions concurrentes
  const projE = randomUUID(); // scénario E : archivage concurrent d'un scellement
  const projF = randomUUID(); // scénario F : suppression de CALCUL concurrente

  const PASSWORD = 'Sup3r-Secret-RaceCondition!';
  const burmisterInput = BURMISTER_FIXTURES[0].input;
  const ANNEE = new Date().getFullYear();

  /** Orphelins de la base ENTIÈRE au démarrage (résidus d'autres suites). */
  let orphelinsAvant = 0;

  jest.setTimeout(120_000);

  const mail = () => `race-o-${owner.slice(0, 8)}@roadsen.test`;

  beforeAll(async () => {
    try {
      const Client = loadPgClient();
      admin = new Client({ connectionString: ADMIN_URL });
      await admin.connect();
      bloqueur = new Client({ connectionString: ADMIN_URL });
      await bloqueur.connect();
    } catch (err) {
      connectError = err as Error;
      if (ENFORCE) throw connectError;
      return;
    }

    const hash = await hashPassword(PASSWORD);
    await admin.query(
      `INSERT INTO users (id, email, password_hash, full_name, updated_at)
       VALUES ($1,$2,$3,'Race Owner',now())`,
      [owner, mail(), hash],
    );
    await admin.query(
      `INSERT INTO organizations (id, name, slug, "updatedAt") VALUES ($1,'Race Org',$2,now())`,
      [org, slug],
    );
    await admin.query(
      `INSERT INTO memberships (id, org_id, user_id, role) VALUES ($1,$2,$3,'OWNER')`,
      [randomUUID(), org, owner],
    );
    await admin.query(
      `INSERT INTO projects (id, org_id, name, created_by_id, status, updated_at) VALUES
        ($1,$2,'Race — A',$3,'ACTIVE',now()),
        ($4,$2,'Race — B',$3,'ACTIVE',now()),
        ($5,$2,'Race — D',$3,'ACTIVE',now()),
        ($6,$2,'Race — E',$3,'ACTIVE',now()),
        ($7,$2,'Race — F',$3,'ACTIVE',now())`,
      [projA, org, owner, projB, projD, projE, projF],
    );
    await admin.query(
      `INSERT INTO subscriptions
         (id, org_id, pack, entitlements, date_debut, date_fin, quota, consommation, created_at, updated_at)
       VALUES ($1,$2,'ROUTES', ARRAY['burmister'], now() - interval '1 day', now() + interval '365 days', 1000, 0, now(), now())`,
      [randomUUID(), org],
    );
    // Compteur de PV pré-créé : c'est la ligne que le bloqueur verrouillera au
    // scénario A pour suspendre l'émission DANS sa fenêtre critique.
    await admin.query(
      `INSERT INTO pv_counters (org_id, year, last_seq) VALUES ($1,$2,0)`,
      [org, ANNEE],
    );

    orphelinsAvant = await orphelinsGlobaux();

    process.env.ROADSEN_DEV_HEADERS = '0';
    process.env.NODE_ENV = 'test';
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  }, 120_000);

  afterAll(async () => {
    if (bloqueur) {
      try {
        // Filet : si un scénario a échoué en laissant une transaction ouverte, on
        // la termine — sinon les DELETE du teardown resteraient bloqués.
        await bloqueur.query('ROLLBACK');
      } catch {
        /* aucune transaction en cours : rien à annuler */
      }
      await bloqueur.end();
    }
    if (admin) {
      try {
        try {
          await admin.query(`ALTER TABLE official_pvs DISABLE TRIGGER USER`);
          await admin.query(`DELETE FROM official_pvs WHERE org_id = $1`, [
            org,
          ]);
        } finally {
          await admin.query(`ALTER TABLE official_pvs ENABLE TRIGGER USER`);
        }
        await admin.query(`DELETE FROM pv_counters WHERE org_id = $1`, [org]);
        await admin.query(`DELETE FROM calc_snapshots WHERE org_id = $1`, [
          org,
        ]);
        await admin.query(`DELETE FROM calc_results WHERE org_id = $1`, [org]);
        await admin.query(`DELETE FROM projects WHERE org_id = $1`, [org]);
        try {
          await admin.query(`ALTER TABLE usage_ledger DISABLE TRIGGER USER`);
          await admin.query(`DELETE FROM usage_ledger WHERE org_id = $1`, [
            org,
          ]);
        } finally {
          await admin.query(`ALTER TABLE usage_ledger ENABLE TRIGGER USER`);
        }
        await admin.query(`DELETE FROM subscriptions WHERE org_id = $1`, [org]);
        await admin.query(`DELETE FROM memberships WHERE org_id = $1`, [org]);
        await admin.query(`DELETE FROM organizations WHERE id = $1`, [org]);
        await admin.query(`DELETE FROM users WHERE id = $1`, [owner]);
      } finally {
        await admin.end();
      }
    }
    if (app) await app.close();
  });

  const ready = () => {
    if (!app) {
      if (ENFORCE)
        throw connectError ?? new Error('App/base indisponible en CI.');
      console.warn('[NON EXECUTE] base/app indisponible (hors CI).');
      return false;
    }
    return true;
  };
  const server = (): import('http').Server =>
    app!.getHttpServer() as import('http').Server;

  let jeton = '';
  async function login(): Promise<string> {
    if (jeton) return jeton;
    const res = await request(server())
      .post('/auth/login')
      .send({ email: mail(), password: PASSWORD });
    expect(res.status).toBe(200);
    jeton = String((res.body as { accessToken?: unknown }).accessToken);
    return jeton;
  }
  const auth = (t: string) => ({
    Authorization: `Bearer ${t}`,
    'X-Org-Id': org,
  });

  // --- Sondes en base --------------------------------------------------------

  const compte = async (sql: string, params: unknown[]): Promise<number> => {
    const r = await admin!.query<{ n: string }>(sql, params);
    return Number(r.rows[0]?.n ?? 0);
  };
  const nbProjets = (id: string) =>
    compte(`SELECT count(*)::int AS n FROM projects WHERE id = $1`, [id]);
  const nbPvs = (projectId: string) =>
    compte(
      `SELECT count(*)::int AS n FROM official_pvs WHERE project_id = $1`,
      [projectId],
    );
  /** PV du projet donné dont le projet n'a PLUS de ligne : la contre-preuve #C. */
  const nbPvsOrphelins = (projectId: string) =>
    compte(
      `SELECT count(*)::int AS n FROM official_pvs o
        WHERE o.project_id = $1
          AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = o.project_id)`,
      [projectId],
    );
  /** Orphelins de la base ENTIÈRE (invariant global, mesuré en delta). */
  async function orphelinsGlobaux(): Promise<number> {
    const r = await admin!.query<{ n: string }>(
      `SELECT count(*)::int AS n FROM official_pvs o
        WHERE NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = o.project_id)`,
    );
    return Number(r.rows[0]?.n ?? 0);
  }

  /**
   * Nombre de connexions REELLEMENT bloquées sur un verrou, dont la requête en
   * cours correspond au motif. On ne dort jamais « au jugé » : on observe l'état
   * du serveur. `pid <> pg_backend_pid()` exclut la sonde elle-même.
   *
   * Motif '%' = « bloquée sur n'importe quoi ». On l'utilise pour attendre la
   * SECONDE transaction : le test ne doit RIEN présumer de l'ordre SQL par lequel
   * l'implémentation se bloque (verrou explicite, DELETE, FK...) — sinon il
   * mesurerait le code plutôt que le comportement, et un correctif différent le
   * ferait échouer pour la mauvaise raison.
   */
  const bloquees = (motif: string) =>
    compte(
      `SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname = current_database()
          AND pid <> pg_backend_pid()
          AND wait_event_type = 'Lock'
          AND query ILIKE $1`,
      [motif],
    );

  /**
   * Attend qu'une condition devienne vraie. ECHEC DUR a l'expiration : un
   * entrelacement non obtenu rend le test NON concluant — jamais vert par défaut.
   */
  async function attendre(
    quoi: string,
    condition: () => Promise<boolean>,
    limiteMs = 4000,
  ): Promise<void> {
    const debut = Date.now();
    for (;;) {
      if (await condition()) return;
      if (Date.now() - debut > limiteMs) {
        throw new Error(
          `[course] condition jamais atteinte : ${quoi} (${limiteMs} ms). ` +
            `L'entrelacement n'a pas pu être imposé : test NON concluant.`,
        );
      }
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  /** Crée un calcul RÉEL (donc scellable) sur le projet donné. */
  async function creerCalcul(projectId: string): Promise<string> {
    const t = await login();
    const calc = await request(server())
      .post(`/projects/${projectId}/calc/burmister`)
      .set(auth(t))
      .send(burmisterInput);
    expect(calc.status).toBeLessThan(300);
    const id = String((calc.body as CalcBody).calcResultId);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    return id;
  }

  // --- #A émission en vol, suppression concurrente ---------------------------

  it('#A GIVEN une émission de PV en vol WHEN une suppression définitive du même projet passe en parallèle THEN elles ne peuvent pas réussir toutes les deux (aucun PV orphelin)', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const t = await login();
    const calcA = await creerCalcul(projA);

    // Le bloqueur fige le compteur de PV : l'émission ira jusqu'à
    // `allocate_pv_number` (donc APRÈS sa lecture du projet) puis attendra.
    await bloqueur!.query('BEGIN');
    await bloqueur!.query(
      `SELECT last_seq FROM pv_counters WHERE org_id = $1 AND year = $2 FOR UPDATE`,
      [org, ANNEE],
    );

    let emissionFinie = false;
    let suppressionFinie = false;
    let emission: Promise<request.Response> | null = null;
    let suppression: Promise<request.Response> | null = null;
    try {
      emission = request(server())
        .post(`/projects/${projA}/calc-results/${calcA}/pv`)
        .set(auth(t))
        .then((r) => {
          emissionFinie = true;
          return r;
        });

      // T1 est REELLEMENT dans sa fenêtre critique (projet lu, PV pas encore inséré).
      await attendre(
        'émission bloquée sur allocate_pv_number',
        async () => (await bloquees('%allocate_pv_number%')) >= 1,
      );
      expect(emissionFinie).toBe(false);
      const bloqueesAvant = await bloquees('%');

      suppression = request(server())
        .delete(`/projects/${projA}/permanent`)
        .set(auth(t))
        .then((r) => {
          suppressionFinie = true;
          return r;
        });

      // La suppression, soit aboutit (défaut : rien ne la retient), soit se met à
      // attendre un verrou (correctif). On attend l'un OU l'autre.
      await attendre(
        'suppression terminée ou bloquée à son tour',
        async () => suppressionFinie || (await bloquees('%')) > bloqueesAvant,
      );
    } finally {
      // TOUJOURS relâcher : si une attente expire, la transaction bloquante ne
      // doit pas rester ouverte (sinon les requêtes en vol traînent jusqu'au
      // délai Prisma et polluent les cas suivants — constaté en test de mutation).
      await bloqueur!.query('COMMIT');
    }
    const [resEmission, resSuppression] = await Promise.all([
      emission,
      suppression,
    ]);

    // COEUR DU CAS : le PV et la destruction du projet ne peuvent pas gagner tous
    // les deux. C'est CE qui échoue sans verrou (émission 201 + suppression 200).
    const pvEmis = resEmission.status < 300;
    const projetDetruit = resSuppression.status === 200;
    expect(pvEmis && projetDetruit).toBe(false);

    if (pvEmis) {
      // L'émission a gagné : le projet EXISTE toujours et la suppression a été
      // refusée par la règle métier (409 « PV scellé »), pas par un 500 de course.
      expect(await nbProjets(projA)).toBe(1);
      expect(await nbPvs(projA)).toBe(1);
      expect(resSuppression.status).toBe(409);
      const message = (
        (resSuppression.body as ErreurBody).message ?? ''
      ).toLowerCase();
      expect(message).toContain('scell');
    } else {
      // La suppression a gagné : aucun PV n'a été scellé, et l'émission a rendu
      // un 404 tenant-safe (le projet n'existe plus).
      expect(resEmission.status).toBe(404);
      expect(await nbPvs(projA)).toBe(0);
      expect(await nbProjets(projA)).toBe(0);
    }

    // #C CONTRE-PREUVE EN BASE : aucun PV scellé sans projet.
    expect(await nbPvsOrphelins(projA)).toBe(0);
  });

  // --- #B suppression en vol, émission concurrente ---------------------------

  it('#B GIVEN une suppression définitive en vol WHEN une émission de PV démarre sur le même projet THEN rien n’est scellé sur un projet détruit (404, aucun PV orphelin)', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const t = await login();
    const calcB = await creerCalcul(projB);

    // Le bloqueur fige la ligne de calcul : la suppression ira jusqu'à son
    // `DELETE FROM calc_results` (donc APRÈS avoir compté 0 PV) puis attendra.
    await bloqueur!.query('BEGIN');
    await bloqueur!.query(
      `SELECT id FROM calc_results WHERE id = $1 FOR UPDATE`,
      [calcB],
    );

    let suppressionFinie = false;
    let emissionFinie = false;
    let suppression: Promise<request.Response> | null = null;
    let emission: Promise<request.Response> | null = null;
    try {
      suppression = request(server())
        .delete(`/projects/${projB}/permanent`)
        .set(auth(t))
        .then((r) => {
          suppressionFinie = true;
          return r;
        });

      await attendre(
        'suppression bloquée sur DELETE calc_results',
        async () => (await bloquees('%DELETE FROM%calc_results%')) >= 1,
      );
      expect(suppressionFinie).toBe(false);
      const bloqueesAvant = await bloquees('%');

      emission = request(server())
        .post(`/projects/${projB}/calc-results/${calcB}/pv`)
        .set(auth(t))
        .then((r) => {
          emissionFinie = true;
          return r;
        });

      // L'émission, soit aboutit (défaut : elle scelle sur un projet en cours de
      // destruction), soit attend le verrou partagé du projet (correctif).
      await attendre(
        'émission terminée ou bloquée à son tour',
        async () => emissionFinie || (await bloquees('%')) > bloqueesAvant,
      );
    } finally {
      await bloqueur!.query('COMMIT');
    }
    const [resSuppression, resEmission] = await Promise.all([
      suppression,
      emission,
    ]);

    // La suppression était première et rien ne devait la retenir : elle aboutit.
    expect(resSuppression.status).toBe(200);
    expect(await nbProjets(projB)).toBe(0);
    // COEUR DU CAS : l'émission ne scelle RIEN sur un projet détruit.
    expect(resEmission.status).toBe(404);
    expect(await nbPvs(projB)).toBe(0);
    expect(await nbPvsOrphelins(projB)).toBe(0);
  });

  // --- #E archivage concurrent (le geste « supprimer » de l’interface) -------

  it('#E GIVEN un scellement de PV en vol WHEN un ARCHIVAGE du même projet passe en parallèle THEN l’archivage ne prend pas effet tant que le PV n’est pas scellé', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const t = await login();
    const calcE = await creerCalcul(projE);

    await bloqueur!.query('BEGIN');
    await bloqueur!.query(
      `SELECT last_seq FROM pv_counters WHERE org_id = $1 AND year = $2 FOR UPDATE`,
      [org, ANNEE],
    );

    let emissionFinie = false;
    let archivageFinie = false;
    let emission: Promise<request.Response> | null = null;
    let archivage: Promise<request.Response> | null = null;
    let archivagePasseAvant = false;
    try {
      emission = request(server())
        .post(`/projects/${projE}/calc-results/${calcE}/pv`)
        .set(auth(t))
        .then((r) => {
          emissionFinie = true;
          return r;
        });
      await attendre(
        'émission bloquée sur allocate_pv_number',
        async () => (await bloquees('%allocate_pv_number%')) >= 1,
      );
      const bloqueesAvant = await bloquees('%');

      // ARCHIVER est le geste « Supprimer » de l'interface : un PV scellé sur un
      // projet archivé est INVISIBLE dans toutes les listes — c'est le défaut de
      // PR #120, que la garde ne fermait qu'en séquentiel.
      archivage = request(server())
        .delete(`/projects/${projE}`)
        .set(auth(t))
        .then((r) => {
          archivagePasseAvant = !emissionFinie; // a-t-il commité avant le sceau ?
          archivageFinie = true;
          return r;
        });
      await attendre(
        'archivage terminé ou bloqué à son tour',
        async () => archivageFinie || (await bloquees('%')) > bloqueesAvant,
      );
    } finally {
      await bloqueur!.query('COMMIT');
    }
    const [resEmission, resArchivage] = await Promise.all([
      emission,
      archivage,
    ]);

    // COEUR DU CAS : l'archivage n'a PAS pu s'intercaler entre le contrôle du
    // projet et l'INSERT du PV. Sans le verrou partagé, il commitait aussitôt et
    // le PV se scellait sur un projet déjà archivé.
    expect(archivagePasseAvant).toBe(false);
    expect(resEmission.status).toBeLessThan(300);
    expect(resArchivage.status).toBe(200);
    expect(await nbPvs(projE)).toBe(1);
  });

  // --- #F suppression de CALCUL en vol, émission concurrente -----------------

  it('#F GIVEN une suppression de CALCUL en vol WHEN une émission de PV démarre sur ce calcul THEN rien n’est scellé sur un calcul détruit (404, aucun PV orphelin) — le PROJET, lui, survit', async () => {
    // Différence essentielle avec #B : ici seul le CALCUL est supprimé, le projet
    // reste ACTIF. Ce n'est donc PAS la garde projet (assertProjetEcrivable) qui
    // produit le 404 — le projet passe la garde — mais la RELECTURE DU CALCUL
    // après le verrou (calcEncorePresent, revue ingenieur-securite B1). Sans elle,
    // l'émission scellait un PV numéroté et facturé dont le calc_result source
    // n'existe plus (official_pvs n'a aucune FK vers calc_results).
    expect.hasAssertions();
    if (!ready()) return;
    const t = await login();
    const calcF = await creerCalcul(projF);

    // Le bloqueur fige la ligne de calcul : la suppression de calcul ira jusqu'à
    // son `DELETE FROM calc_results` (donc APRÈS avoir pris le FOR UPDATE projet
    // et compté 0 PV) puis attendra.
    await bloqueur!.query('BEGIN');
    await bloqueur!.query(
      `SELECT id FROM calc_results WHERE id = $1 FOR UPDATE`,
      [calcF],
    );

    let suppressionFinie = false;
    let emissionFinie = false;
    let suppression: Promise<request.Response> | null = null;
    let emission: Promise<request.Response> | null = null;
    try {
      suppression = request(server())
        .delete(`/projects/${projF}/calc-results/${calcF}`)
        .set(auth(t))
        .then((r) => {
          suppressionFinie = true;
          return r;
        });

      // La suppression détient le FOR UPDATE projet et bloque sur le DELETE du
      // calcul (verrouillé par le bloqueur).
      await attendre(
        'suppression de calcul bloquée sur DELETE calc_results',
        async () => (await bloquees('%DELETE FROM%calc_results%')) >= 1,
      );
      expect(suppressionFinie).toBe(false);
      const bloqueesAvant = await bloquees('%');

      emission = request(server())
        .post(`/projects/${projF}/calc-results/${calcF}/pv`)
        .set(auth(t))
        .then((r) => {
          emissionFinie = true;
          return r;
        });

      // L'émission lit le calcul (encore présent, le DELETE est bloqué), puis
      // demande le FOR SHARE projet → elle BLOQUE (la suppression tient le
      // FOR UPDATE). L'ordre « projet en premier des deux côtés » évite tout
      // interblocage.
      await attendre(
        'émission bloquée à son tour sur le verrou projet',
        async () => emissionFinie || (await bloquees('%')) > bloqueesAvant,
      );
    } finally {
      // Relâche le verrou du bloqueur : la suppression finit son DELETE, commit,
      // libère le projet ; l'émission obtient alors le FOR SHARE et relit le
      // calcul — disparu → 404.
      await bloqueur!.query('COMMIT');
    }
    const [resSuppression, resEmission] = await Promise.all([
      suppression,
      emission,
    ]);

    // La suppression était première, le calcul n'était pas scellé : elle aboutit.
    expect(resSuppression.status).toBe(200);
    // COEUR DU CAS : l'émission ne scelle RIEN sur un calcul détruit. C'est le
    // calcEncorePresent (post-verrou) qui rend ce 404, pas la garde projet.
    expect(resEmission.status).toBe(404);
    expect(await nbPvs(projF)).toBe(0);
    // Le projet, lui, EXISTE toujours (seul le calcul a été supprimé).
    expect(await nbProjets(projF)).toBe(1);
    expect(await nbPvsOrphelins(projF)).toBe(0);
  });

  // --- #D non-régression de performance : pas de sérialisation abusive -------

  it('#D GIVEN deux émissions de PV concurrentes sur le MÊME projet WHEN elles s’exécutent en parallèle THEN aucune ne bloque l’autre sur le projet (le verrou partagé reste partagé)', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const t = await login();
    const calc1 = await creerCalcul(projD);
    const calc2 = await creerCalcul(projD);

    // Aucun bloqueur ici : les deux émissions doivent passer, ensemble, sans
    // qu'un verrou EXCLUSIF sur le projet n'en fasse échouer une (ni P2028 par
    // dépassement du délai de transaction Prisma).
    const [r1, r2] = await Promise.all([
      request(server())
        .post(`/projects/${projD}/calc-results/${calc1}/pv`)
        .set(auth(t)),
      request(server())
        .post(`/projects/${projD}/calc-results/${calc2}/pv`)
        .set(auth(t)),
    ]);
    expect(r1.status).toBeLessThan(300);
    expect(r2.status).toBeLessThan(300);
    expect(await nbPvs(projD)).toBe(2);
    expect(await nbProjets(projD)).toBe(1);
  });

  // --- #C invariant global ---------------------------------------------------

  it('#C CONTRE-PREUVE — la base ne contient AUCUN PV orphelin de plus qu’avant la suite', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    // Delta et non zéro absolu : la base de dev porte déjà des orphelins résiduels
    // d'autres suites (teardowns qui suppriment le projet avant le PV immuable).
    // On interdit toute AUGMENTATION ; on ne prétend pas nettoyer l'existant.
    expect(await orphelinsGlobaux()).toBe(orphelinsAvant);
  });
});
