/**
 * DEFAUT A — ON POUVAIT ECRIRE SUR UN PROJET ARCHIVE. e2e contre Postgres REEL.
 *
 * POURQUOI CE FICHIER EXISTE (revue adverse PR #120)
 * --------------------------------------------------
 * `ProjectsService` exclut ARCHIVED de TOUTES ses lectures et de TOUTES ses
 * mutations (list / getById / rename / archive). Mais TROIS points d'ecriture
 * situes AILLEURS ne le faisaient pas — ils se contentaient de verifier que le
 * projet EXISTE dans le tenant :
 *   - CalcResultsService.runAndPersist  -> tx.project.findUnique SANS filtre statut ;
 *   - PvService.emitFromCalc            -> idem, a l'emission du PV ;
 *   - CalcSnapshotsService.capture      -> aucun controle du projet du tout
 *     (seulement calc.projectId === projectId).
 *
 * Consequences REELLES, par ordre de gravite :
 *   1. On BRULE DU QUOTA (reserveUnit + ligne de ledger APPEND-ONLY, donc
 *      irreversible) sur un projet que l'utilisateur croit supprime ;
 *   2. On SCELLE UN PV rattache a un projet INVISIBLE dans toutes les listes :
 *      livrable orphelin, alors que le scellement est notre garantie la plus
 *      forte (DoD §5).
 *
 * CE QUE CE FICHIER VERROUILLE (given/when/then)
 *  #1 CONTROLE POSITIF (projet ACTIF) : calcul -> 201 + ligne en base + quota +1 ;
 *     capture -> 200 + ligne calc_snapshots ; emission PV -> 201 + ligne
 *     official_pvs. SANS ce controle, un 404 systematique du a un tout autre bug
 *     ferait passer les tests de refus ci-dessous pour des succes.
 *  #2 CALCUL sur projet ARCHIVE -> 404 tenant-safe, ET CONTRE-PREUVE EN BASE :
 *     AUCUNE ligne calc_results creee, consommation d'abonnement INCHANGEE,
 *     AUCUNE ligne usage_ledger ajoutee.
 *  #3 CAPTURE sur projet ARCHIVE -> 404, ET aucune ligne calc_snapshots creee.
 *  #4 EMISSION DE PV sur projet ARCHIVE -> 404, ET aucun official_pv, ET le
 *     compteur de numerotation n'a pas avance (aucun numero brule).
 *  #5 INDISCERNABILITE : « archive », « inexistant » et « hors tenant » rendent
 *     le MEME 404 avec le MEME message (anti-enumeration), comme le fait deja
 *     `rename`.
 *  #6 RESTAURATION : apres restore, l'ecriture redevient possible — la garde
 *     bloque bien sur le STATUT, pas sur l'identite du projet.
 *
 * Le calcul cible est cree via l'API sur le projet ENCORE ACTIF, puis le projet
 * est archive en base : la ligne calc_results est donc REELLE et reproductible
 * par le moteur. Un 404 obtenu ensuite ne peut venir que de la garde de statut —
 * pas d'un calcul invalide qui aurait de toute facon echoue.
 *
 * ANTI-SKIP : DATABASE_URL absent ET CI -> echec dur. Hors CI sans base ->
 * non-execute (honnete), jamais compte comme reussi. Les cas a execution
 * conditionnelle portent `expect.hasAssertions()` : un test non execute ne peut
 * pas ressembler a un test reussi.
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
  ok?: unknown;
}
interface PvBody {
  id?: unknown;
  pvNumber?: unknown;
}
interface ErreurBody {
  message?: unknown;
}

const ADMIN_URL = process.env.DATABASE_URL ?? '';
const ENFORCE = process.env.CI === 'true' || ADMIN_URL.length > 0;

/** HTML de capture INERTE (passe la garde §8 : aucun script/handler/marqueur). */
const DISPLAY_HTML = '<html><body><p>Rapport — affichage</p></body></html>';
const PRINT_HTML = '<html><body><p>Rapport — impression</p></body></html>';

function loadPgClient(): PgClientCtor {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('pg') as { Client: PgClientCtor };
  return mod.Client;
}

describe('Écriture sur projet ARCHIVÉ — refus fail-closed (e2e Postgres réel)', () => {
  let app: INestApplication | null = null;
  let admin: PgClient | null = null;
  let connectError: Error | null = null;

  const orgA = randomUUID();
  const orgB = randomUUID();
  const slugA = `awg-a-${orgA.slice(0, 8)}`;
  const slugB = `awg-b-${orgB.slice(0, 8)}`;
  const ownerA = randomUUID();
  const ownerB = randomUUID();
  const projActif = randomUUID(); // contrôle positif
  const projArchive = randomUUID(); // cible : archivé en cours de route
  const PASSWORD = 'Sup3r-Secret-ArchGuard!';

  /** calc_result créé via l'API sur projArchive AVANT son archivage. */
  let calcSurArchive = '';

  const burmisterInput = BURMISTER_FIXTURES[0].input;

  jest.setTimeout(90_000);

  const mailA = () => `awg-a-${ownerA.slice(0, 8)}@roadsen.test`;
  const mailB = () => `awg-b-${ownerB.slice(0, 8)}@roadsen.test`;

  beforeAll(async () => {
    try {
      const Client = loadPgClient();
      admin = new Client({ connectionString: ADMIN_URL });
      await admin.connect();
    } catch (err) {
      connectError = err as Error;
      if (ENFORCE) throw connectError;
      return;
    }

    const hash = await hashPassword(PASSWORD);
    await admin.query(
      `INSERT INTO users (id, email, password_hash, full_name, updated_at) VALUES
        ($1,$2,$5,'AWG Owner A',now()), ($3,$4,$5,'AWG Owner B',now())`,
      [ownerA, mailA(), ownerB, mailB(), hash],
    );
    await admin.query(
      `INSERT INTO organizations (id, name, slug, "updatedAt") VALUES ($1,'AWG A',$2,now()), ($3,'AWG B',$4,now())`,
      [orgA, slugA, orgB, slugB],
    );
    await admin.query(
      `INSERT INTO memberships (id, org_id, user_id, role) VALUES ($1,$2,$3,'OWNER'), ($4,$5,$6,'OWNER')`,
      [randomUUID(), orgA, ownerA, randomUUID(), orgB, ownerB],
    );
    // Les DEUX projets d'orgA démarrent ACTIFS : projArchive n'est archivé qu'une
    // fois son calcul réellement produit par l'API (calcul VALIDE et reproductible).
    await admin.query(
      `INSERT INTO projects (id, org_id, name, created_by_id, status, updated_at) VALUES
        ($1,$2,'AWG — actif',$3,'ACTIVE',now()),
        ($4,$2,'AWG — à archiver',$3,'ACTIVE',now())`,
      [projActif, orgA, ownerA, projArchive],
    );
    // Abonnements orgA ET orgB : quota large + entitlement burmister (l'enforcement
    // ADR 0011 n'est pas l'objet de ce fichier). orgB en a besoin pour que sa
    // tentative cross-tenant ATTEIGNE la garde projet (sinon elle serait barrée en
    // amont par un 403 « pas d'abonnement » et ne prouverait rien de l'isolation).
    await admin.query(
      `INSERT INTO subscriptions
         (id, org_id, pack, entitlements, date_debut, date_fin, quota, consommation, created_at, updated_at)
       VALUES
         ($1,$2,'ROUTES', ARRAY['burmister'], now() - interval '1 day', now() + interval '365 days', 1000, 0, now(), now()),
         ($3,$4,'ROUTES', ARRAY['burmister'], now() - interval '1 day', now() + interval '365 days', 1000, 0, now(), now())`,
      [randomUUID(), orgA, randomUUID(), orgB],
    );

    process.env.ROADSEN_DEV_HEADERS = '0';
    process.env.NODE_ENV = 'test';
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  }, 90_000);

  afterAll(async () => {
    if (admin) {
      try {
        // official_pvs IMMUABLE (trigger 0006) et usage_ledger APPEND-ONLY (0008) :
        // il faut désactiver les triggers pour purger. try/finally OBLIGATOIRE — un
        // échec de DELETE ne doit JAMAIS laisser une base de recette avec ses
        // triggers d'immuabilité désactivés (la protection sauterait en silence).
        try {
          await admin.query(`ALTER TABLE official_pvs DISABLE TRIGGER USER`);
          await admin.query(
            `DELETE FROM official_pvs WHERE org_id IN ($1,$2)`,
            [orgA, orgB],
          );
        } finally {
          await admin.query(`ALTER TABLE official_pvs ENABLE TRIGGER USER`);
        }
        await admin.query(`DELETE FROM pv_counters WHERE org_id IN ($1,$2)`, [
          orgA,
          orgB,
        ]);
        await admin.query(
          `DELETE FROM calc_snapshots WHERE org_id IN ($1,$2)`,
          [orgA, orgB],
        );
        await admin.query(`DELETE FROM calc_results WHERE org_id IN ($1,$2)`, [
          orgA,
          orgB,
        ]);
        await admin.query(`DELETE FROM projects WHERE org_id IN ($1,$2)`, [
          orgA,
          orgB,
        ]);
        try {
          await admin.query(`ALTER TABLE usage_ledger DISABLE TRIGGER USER`);
          await admin.query(
            `DELETE FROM usage_ledger WHERE org_id IN ($1,$2)`,
            [orgA, orgB],
          );
        } finally {
          await admin.query(`ALTER TABLE usage_ledger ENABLE TRIGGER USER`);
        }
        await admin.query(`DELETE FROM subscriptions WHERE org_id IN ($1,$2)`, [
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
          ownerA,
          ownerB,
        ]);
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

  const cache = new Map<string, string>();
  async function login(email: string): Promise<string> {
    const hit = cache.get(email);
    if (hit) return hit;
    const res = await request(server())
      .post('/auth/login')
      .send({ email, password: PASSWORD });
    expect(res.status).toBe(200);
    const t = String((res.body as { accessToken?: unknown }).accessToken);
    cache.set(email, t);
    return t;
  }
  const auth = (t: string, org: string) => ({
    Authorization: `Bearer ${t}`,
    'X-Org-Id': org,
  });

  // --- Sondes en base (contre-preuves) ---------------------------------------

  const compte = async (sql: string, params: unknown[]): Promise<number> => {
    const r = await admin!.query<{ n: string }>(sql, params);
    return Number(r.rows[0]?.n ?? 0);
  };
  const nbCalcs = (projectId: string) =>
    compte(
      `SELECT count(*)::int AS n FROM calc_results WHERE project_id = $1`,
      [projectId],
    );
  const nbPvs = (projectId: string) =>
    compte(
      `SELECT count(*)::int AS n FROM official_pvs WHERE project_id = $1`,
      [projectId],
    );
  const nbSnapshots = (calcResultId: string) =>
    compte(
      `SELECT count(*)::int AS n FROM calc_snapshots WHERE calc_result_id = $1`,
      [calcResultId],
    );
  const nbLedger = () =>
    compte(`SELECT count(*)::int AS n FROM usage_ledger WHERE org_id = $1`, [
      orgA,
    ]);
  const consommation = () =>
    compte(
      `SELECT consommation::int AS n FROM subscriptions WHERE org_id = $1`,
      [orgA],
    );
  const dernierNumero = () =>
    compte(
      `SELECT coalesce(max(last_seq),0)::int AS n FROM pv_counters WHERE org_id = $1`,
      [orgA],
    );

  // --- Requêtes d'écriture ---------------------------------------------------

  const calculer = (token: string, org: string, projectId: string) =>
    request(server())
      .post(`/projects/${projectId}/calc/burmister`)
      .set(auth(token, org))
      .send(burmisterInput);
  const capturer = (
    token: string,
    org: string,
    projectId: string,
    calcId: string,
  ) =>
    request(server())
      .post(`/projects/${projectId}/calc-results/${calcId}/snapshot`)
      .set(auth(token, org))
      .send({ displayHtml: DISPLAY_HTML, printHtml: PRINT_HTML });
  const emettrePv = (
    token: string,
    org: string,
    projectId: string,
    calcId: string,
  ) =>
    request(server())
      .post(`/projects/${projectId}/calc-results/${calcId}/pv`)
      .set(auth(token, org));

  // --- #1 CONTRÔLE POSITIF ---------------------------------------------------

  it('#1 CONTRÔLE POSITIF — sur un projet ACTIF : calcul, capture et émission de PV RÉUSSISSENT', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const t = await login(mailA());

    const consoAvant = await consommation();
    const ledgerAvant = await nbLedger();

    const calc = await calculer(t, orgA, projActif);
    expect(calc.status).toBeLessThan(300);
    expect((calc.body as CalcBody).ok).toBe(true);
    const calcId = String((calc.body as CalcBody).calcResultId);
    expect(calcId).toMatch(/^[0-9a-f-]{36}$/);

    // Écriture RÉELLE en base + quota RÉELLEMENT consommé : c'est l'étalon auquel
    // les refus ci-dessous seront comparés.
    expect(await nbCalcs(projActif)).toBe(1);
    expect(await consommation()).toBe(consoAvant + 1);
    expect(await nbLedger()).toBe(ledgerAvant + 1);

    const snap = await capturer(t, orgA, projActif, calcId);
    expect(snap.status).toBeLessThan(300);
    expect(await nbSnapshots(calcId)).toBe(1);

    const pv = await emettrePv(t, orgA, projActif, calcId);
    expect(pv.status).toBeLessThan(300);
    expect(String((pv.body as PvBody).pvNumber)).toContain('PV-RDS-');
    expect(await nbPvs(projActif)).toBe(1);
  });

  // --- #1-bis Préparation : un calcul RÉEL, puis archivage du projet ----------

  it('#1-bis PRÉPARATION — un calcul réel est produit sur projArchive, PUIS le projet est archivé', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const t = await login(mailA());

    const calc = await calculer(t, orgA, projArchive);
    expect(calc.status).toBeLessThan(300);
    calcSurArchive = String((calc.body as CalcBody).calcResultId);
    expect(calcSurArchive).toMatch(/^[0-9a-f-]{36}$/);

    // Archivage par l'API (le chemin réel de l'utilisateur), pas par SQL.
    const arch = await request(server())
      .delete(`/projects/${projArchive}`)
      .set(auth(t, orgA));
    expect(arch.status).toBe(200);

    // Le projet est bien devenu invisible : point de départ des refus attendus.
    const detail = await request(server())
      .get(`/projects/${projArchive}`)
      .set(auth(t, orgA));
    expect(detail.status).toBe(404);
  });

  // --- #2 CALCUL sur projet archivé ------------------------------------------

  it('#2 CALCUL sur projet ARCHIVÉ → 404, ET aucun calc_result, ET aucun quota consommé', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const t = await login(mailA());

    const calcsAvant = await nbCalcs(projArchive);
    const consoAvant = await consommation();
    const ledgerAvant = await nbLedger();

    const res = await calculer(t, orgA, projArchive);
    expect(res.status).toBe(404);

    // CONTRE-PREUVE EN BASE — c'est elle qui prouve le défaut, pas le code HTTP :
    // avant correctif, la ligne était créée ET le quota brûlé (ledger append-only,
    // donc irréversible) alors que l'utilisateur croit le projet supprimé.
    expect(await nbCalcs(projArchive)).toBe(calcsAvant);
    expect(await consommation()).toBe(consoAvant);
    expect(await nbLedger()).toBe(ledgerAvant);
  });

  // --- #3 CAPTURE sur projet archivé -----------------------------------------

  it('#3 CAPTURE de document sur projet ARCHIVÉ → 404, ET aucune ligne calc_snapshots', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const t = await login(mailA());

    const res = await capturer(t, orgA, projArchive, calcSurArchive);
    expect(res.status).toBe(404);
    expect(await nbSnapshots(calcSurArchive)).toBe(0);
  });

  // --- #4 ÉMISSION DE PV sur projet archivé ----------------------------------

  it('#4 ÉMISSION DE PV sur projet ARCHIVÉ → 404, ET aucun official_pv, ET aucun numéro brûlé', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const t = await login(mailA());

    const pvsAvant = await nbPvs(projArchive);
    const numeroAvant = await dernierNumero();
    const consoAvant = await consommation();

    const res = await emettrePv(t, orgA, projArchive, calcSurArchive);
    expect(res.status).toBe(404);

    // CONTRE-PREUVE : avant correctif, un PV SCELLÉ était rattaché à un projet
    // INVISIBLE dans toutes les listes — un livrable orphelin (DoD §5).
    expect(await nbPvs(projArchive)).toBe(pvsAvant);
    expect(await dernierNumero()).toBe(numeroAvant);
    expect(await consommation()).toBe(consoAvant);
  });

  // --- #5 INDISCERNABILITÉ (anti-énumération) --------------------------------

  it('#5 ANTI-ÉNUMÉRATION — « archivé », « inexistant » et « hors tenant » rendent le MÊME 404', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const tA = await login(mailA());
    const tB = await login(mailB());

    const archive = await calculer(tA, orgA, projArchive);
    const inexistant = await calculer(tA, orgA, randomUUID());
    // orgB agit dans SON org mais vise un projet d'orgA (RLS -> invisible).
    const horsTenant = await calculer(tB, orgB, projActif);

    expect(archive.status).toBe(404);
    expect(inexistant.status).toBe(404);
    expect(horsTenant.status).toBe(404);

    const msgArchive = (archive.body as ErreurBody).message;
    const msgInexistant = (inexistant.body as ErreurBody).message;
    const msgHorsTenant = (horsTenant.body as ErreurBody).message;
    expect(typeof msgArchive).toBe('string');
    // Le message d'un projet ARCHIVÉ ne doit rien révéler de plus que celui d'un
    // projet inexistant ou d'un projet d'un autre bureau : sinon l'appelant
    // énumère les projets archivés (et les projets des autres tenants).
    expect(msgArchive).toBe(msgInexistant);
    expect(msgArchive).toBe(msgHorsTenant);
    expect(String(msgArchive).toLowerCase()).not.toContain('archiv');

    // CONTRE-PREUVE d'isolation : la tentative d'orgB n'a rien écrit chez orgA.
    expect(await nbCalcs(projActif)).toBe(1);
  });

  // --- #6 RESTAURATION : la garde porte sur le STATUT ------------------------

  it('#6 RESTAURATION — après restore, le calcul redevient possible (la garde porte sur le statut)', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const t = await login(mailA());

    const restore = await request(server())
      .post(`/projects/${projArchive}/restore`)
      .set(auth(t, orgA));
    expect(restore.status).toBeLessThan(300);

    const calcsAvant = await nbCalcs(projArchive);
    const res = await calculer(t, orgA, projArchive);
    expect(res.status).toBeLessThan(300);
    expect(await nbCalcs(projArchive)).toBe(calcsAvant + 1);
  });
});
