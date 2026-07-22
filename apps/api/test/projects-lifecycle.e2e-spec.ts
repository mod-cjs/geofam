/**
 * Test e2e — CYCLE DE VIE PROJET (renommage + suppression) contre la VRAIE base.
 *
 * Fonde les actions UI « renommer » et « supprimer » d'un projet (audit UI :
 * MAJEUR persistance rename + MAJEUR suppression absente). Prouve, via HTTP
 * (supertest) sur l'app NestJS reelle branchee sur PostgreSQL (seed/teardown via
 * connexion SUPERUSER DATABASE_URL — meme patron que pv-emission.e2e) :
 *
 *   RENOMMAGE (PATCH /projects/:id)
 *     1) ENGINEER renomme un projet -> 200, nom a jour ; un RE-GET renvoie le
 *        NOUVEAU nom (la persistance est REELLE, pas un optimistic UI menteur).
 *     2) VALIDATION : nom vide -> 400 (borne Zod, jamais un nom vide en base).
 *     3) ISOLATION : ownerB (orgB) ne peut PAS renommer un projet d'orgA (404
 *        tenant-safe, RLS) — et le nom d'orgA reste INCHANGE.
 *     4) RBAC : un VIEWER ne peut pas renommer (403).
 *
 *   SUPPRESSION (DELETE /projects/:id) — SOFT-DELETE
 *     5) ENGINEER supprime un projet -> il DISPARAIT de la liste ET du detail
 *        (404), mais le PV OFFICIEL scelle qu'il portait est PRESERVE (toujours
 *        listable/lisible, sceau VALIDE) et la ligne official_pvs subsiste en
 *        base (integrite non cassee par un DELETE physique).
 *     6) IDEMPOTENCE : re-supprimer un projet deja archive -> 404.
 *     7) RBAC : un VIEWER ne peut pas supprimer (403).
 *
 * NB — le PV pre-seede porte un sceau REEL (calcule ici via @roadsen/shared) : la
 * preservation n'exerce PAS le pipeline d'emission (teste ailleurs), seulement le
 * fait qu'un soft-delete ne detruit ni ne masque le PV du projet.
 *
 * ANTI-SKIP : DATABASE_URL absent ET CI -> echec dur. Hors CI sans base ->
 * non-execute (honnete), interdit en CI.
 */
import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  canonicalize,
  sealContentHash,
  sealHmac,
  type SealableValue,
} from '@roadsen/shared';
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

interface ProjectBody {
  id?: unknown;
  name?: unknown;
  status?: unknown;
  orgId?: unknown;
}
interface PvViewBody {
  pv?: { id?: unknown };
  sealValid?: unknown;
}

const ADMIN_URL = process.env.DATABASE_URL ?? '';
const ENFORCE = process.env.CI === 'true' || ADMIN_URL.length > 0;
const SIGNING_SECRET = process.env.PV_SIGNING_SECRET ?? '';

function loadPgClient(): PgClientCtor {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('pg') as { Client: PgClientCtor };
  return mod.Client;
}

describe('Cycle de vie projet — rename + soft-delete (e2e)', () => {
  let app: INestApplication | null = null;
  let admin: PgClient | null = null;
  let connectError: Error | null = null;

  const orgA = randomUUID();
  const orgB = randomUUID();
  const slugA = `plc-a-${orgA.slice(0, 8)}`;
  const slugB = `plc-b-${orgB.slice(0, 8)}`;
  const engineerA = randomUUID(); // ENGINEER orgA
  const viewerA = randomUUID(); // VIEWER orgA
  const ownerB = randomUUID(); // OWNER orgB

  // Projets d'orgA : un pour le renommage, un pour la suppression+PV.
  const projRename = randomUUID();
  const projDelete = randomUUID();
  const projB = randomUUID(); // projet d'orgB (cible cross-tenant)
  const pvId = randomUUID(); // PV officiel pre-seede sur projDelete
  const PASSWORD = 'Sup3r-Secret-Lifecycle!';

  jest.setTimeout(60_000);

  const emailEng = () => `plc-eng-${engineerA.slice(0, 8)}@roadsen.test`;
  const emailView = () => `plc-view-${viewerA.slice(0, 8)}@roadsen.test`;
  const emailB = () => `plc-b-${ownerB.slice(0, 8)}@roadsen.test`;

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
        ($1,$2,$7,'PLC Eng',now()),
        ($3,$4,$7,'PLC View',now()),
        ($5,$6,$7,'PLC Owner B',now())`,
      [engineerA, emailEng(), viewerA, emailView(), ownerB, emailB(), hash],
    );
    await admin.query(
      `INSERT INTO organizations (id, name, slug, "updatedAt") VALUES ($1,'PLC A',$2,now()), ($3,'PLC B',$4,now())`,
      [orgA, slugA, orgB, slugB],
    );
    await admin.query(
      `INSERT INTO memberships (id, org_id, user_id, role) VALUES
        ($1,$2,$3,'ENGINEER'), ($4,$2,$5,'VIEWER'), ($6,$7,$8,'OWNER')`,
      [
        randomUUID(),
        orgA,
        engineerA,
        randomUUID(),
        viewerA,
        randomUUID(),
        orgB,
        ownerB,
      ],
    );
    // Projets seedes (nom initial connu pour prouver la persistance du renommage).
    await admin.query(
      `INSERT INTO projects (id, org_id, name, created_by_id, updated_at) VALUES
        ($1,$2,'Nom initial',$3,now()),
        ($4,$2,'A supprimer',$3,now()),
        ($5,$6,'Projet B',$7,now())`,
      [projRename, orgA, engineerA, projDelete, projB, orgB, ownerB],
    );

    // PV officiel PRE-SEEDE sur projDelete, avec un SCEAU REEL (calcule ici avec
    // le meme secret que le serveur) -> GET .../pvs renverra sealValid=true. Le
    // verify serveur ne re-derive PAS la canonique depuis les autres colonnes : il
    // recompute hash+hmac SUR input_canonical (cf. PvService.verify) -> il suffit
    // que la canonique et son sceau soient mutuellement coherents.
    const sealedAtIso = new Date().toISOString();
    const content: SealableValue = {
      pvNumber: `PV-RDS-${slugA}-${new Date().getFullYear()}-000001`,
      verdict: 'CONFORME',
      sealedAt: sealedAtIso,
      identity: { projectId: projDelete, orgDisplayName: 'PLC A' },
    };
    const canonical = canonicalize(content);
    const contentHash = sealContentHash(canonical);
    const hmac = sealHmac(canonical, SIGNING_SECRET);
    await admin.query(
      `INSERT INTO official_pvs
         (id, org_id, calc_result_id, project_id, pv_number, user_id, project_name,
          engine_id, engine_version, input_canonical, output, science_status,
          verdict, content_hash, hmac, sealed_at)
       VALUES ($1,$2,$3,$4,$5,$6,'A supprimer',
          'chaussee-burmister','1.0.0',$7,'{}'::jsonb,'unsigned',
          'CONFORME',$8,$9,$10)`,
      [
        pvId,
        orgA,
        randomUUID(), // calc_result_id : reference figee (pas de FK vivante)
        projDelete,
        `PV-RDS-${slugA}-${new Date().getFullYear()}-000001`,
        engineerA,
        canonical,
        contentHash,
        hmac,
        sealedAtIso,
      ],
    );

    process.env.ROADSEN_DEV_HEADERS = '0';
    process.env.NODE_ENV = 'test';
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  }, 60_000);

  afterAll(async () => {
    if (admin) {
      try {
        // official_pvs immuable (trigger) : DISABLE TRIGGER USER le temps de purger.
        try {
          await admin.query(`ALTER TABLE official_pvs DISABLE TRIGGER USER`);
          await admin.query(
            `DELETE FROM official_pvs WHERE org_id IN ($1,$2)`,
            [orgA, orgB],
          );
        } finally {
          // try/finally : un echec de DELETE ne doit JAMAIS laisser la base de
          // recette avec son trigger d'immuabilite desactive.
          await admin.query(`ALTER TABLE official_pvs ENABLE TRIGGER USER`);
        }
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
        await admin.query(`DELETE FROM users WHERE id IN ($1,$2,$3)`, [
          engineerA,
          viewerA,
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

  const tokenCache = new Map<string, string>();
  async function login(email: string): Promise<string> {
    const cached = tokenCache.get(email);
    if (cached) return cached;
    const res = await request(server())
      .post('/auth/login')
      .send({ email, password: PASSWORD });
    expect(res.status).toBe(200);
    const token = String((res.body as { accessToken?: unknown }).accessToken);
    tokenCache.set(email, token);
    return token;
  }

  const getProject = (token: string, org: string, id: string) =>
    request(server())
      .get(`/projects/${id}`)
      .set('authorization', `Bearer ${token}`)
      .set('x-org-id', org);
  const listProjects = (token: string, org: string) =>
    request(server())
      .get('/projects')
      .set('authorization', `Bearer ${token}`)
      .set('x-org-id', org);
  const patchName = (token: string, org: string, id: string, body: unknown) =>
    request(server())
      .patch(`/projects/${id}`)
      .set('authorization', `Bearer ${token}`)
      .set('x-org-id', org)
      .send(body as object);
  const del = (token: string, org: string, id: string) =>
    request(server())
      .delete(`/projects/${id}`)
      .set('authorization', `Bearer ${token}`)
      .set('x-org-id', org);

  // --- 1) RENOMMAGE PERSISTE (re-GET renvoie le nouveau nom) -----------------

  it('1) PATCH /projects/:id renomme ET le renommage PERSISTE (re-GET = nouveau nom)', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const token = await login(emailEng());

    // Etat initial connu.
    const before = await getProject(token, orgA, projRename);
    expect(before.status).toBe(200);
    expect((before.body as ProjectBody).name).toBe('Nom initial');

    const patched = await patchName(token, orgA, projRename, {
      name: 'Chantier renomme',
    });
    expect(patched.status).toBe(200);
    expect((patched.body as ProjectBody).name).toBe('Chantier renomme');

    // PREUVE DE PERSISTANCE : une NOUVELLE lecture (pas la reponse du PATCH) doit
    // renvoyer le nouveau nom. Sans persistance reelle, ce re-GET virerait ROUGE.
    const after = await getProject(token, orgA, projRename);
    expect(after.status).toBe(200);
    expect((after.body as ProjectBody).name).toBe('Chantier renomme');
  });

  // --- 2) VALIDATION : nom vide -> 400 ---------------------------------------

  it('2) PATCH avec un nom vide -> 400 (borne Zod, jamais de nom vide en base)', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const token = await login(emailEng());
    const res = await patchName(token, orgA, projRename, { name: '   ' });
    expect(res.status).toBe(400);
    // Le nom n'a pas change (rien n'a ete ecrit).
    const after = await getProject(token, orgA, projRename);
    expect((after.body as ProjectBody).name).toBe('Chantier renomme');
  });

  // --- 3) ISOLATION : ownerB ne peut pas renommer un projet d'orgA -----------

  it('3) ISOLATION : ownerB (orgB) PATCH un projet d orgA -> 404 et le nom d orgA reste inchange', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const tokenB = await login(emailB());
    // userB agit dans SON org (orgB) mais vise l'id d'un projet d'orgA : RLS ->
    // updateMany count=0 -> 404 tenant-safe (indistinguable d'un id inexistant).
    const res = await patchName(tokenB, orgB, projRename, {
      name: 'PIRATAGE',
    });
    expect(res.status).toBe(404);

    // Contre-preuve : cote orgA, le nom n'a PAS bouge.
    const tokenA = await login(emailEng());
    const after = await getProject(tokenA, orgA, projRename);
    expect((after.body as ProjectBody).name).toBe('Chantier renomme');
  });

  // --- 4) RBAC : VIEWER ne peut pas renommer ---------------------------------

  it('4) RBAC : un VIEWER ne peut pas renommer -> 403', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const tokenView = await login(emailView());
    const res = await patchName(tokenView, orgA, projRename, {
      name: 'Interdit',
    });
    expect(res.status).toBe(403);
  });

  // --- 5) SOFT-DELETE : disparait des lectures, PV scelle PRESERVE -----------

  it('5) DELETE /projects/:id archive le projet (invisible) MAIS preserve son PV scelle', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const token = await login(emailEng());

    // Le PV pre-seede est bien lisible AVANT suppression (sceau valide).
    const pvBefore = await request(server())
      .get(`/projects/${projDelete}/pvs/${pvId}`)
      .set('authorization', `Bearer ${token}`)
      .set('x-org-id', orgA);
    expect(pvBefore.status).toBe(200);
    expect((pvBefore.body as PvViewBody).sealValid).toBe(true);

    // Le projet est visible AVANT suppression.
    const listBefore = await listProjects(token, orgA);
    expect(
      (listBefore.body as ProjectBody[]).some((p) => p.id === projDelete),
    ).toBe(true);

    // SUPPRESSION (soft-delete).
    const removed = await del(token, orgA, projDelete);
    expect(removed.status).toBe(200);
    expect((removed.body as ProjectBody).status).toBe('ARCHIVED');

    // (a) DISPARAIT de la liste.
    const listAfter = await listProjects(token, orgA);
    expect(
      (listAfter.body as ProjectBody[]).some((p) => p.id === projDelete),
    ).toBe(false);

    // (b) DISPARAIT du detail (404 tenant-safe).
    const detail = await getProject(token, orgA, projDelete);
    expect(detail.status).toBe(404);

    // (c) PV PRESERVE : toujours listable via le projet, sceau valide.
    const pvs = await request(server())
      .get(`/projects/${projDelete}/pvs`)
      .set('authorization', `Bearer ${token}`)
      .set('x-org-id', orgA);
    expect(pvs.status).toBe(200);
    const list = pvs.body as PvViewBody[];
    expect(list.some((v) => v.pv?.id === pvId)).toBe(true);
    expect(list.every((v) => v.sealValid === true)).toBe(true);

    // (d) PV PRESERVE : lisible en detail avec sceau valide.
    const pvView = await request(server())
      .get(`/projects/${projDelete}/pvs/${pvId}`)
      .set('authorization', `Bearer ${token}`)
      .set('x-org-id', orgA);
    expect(pvView.status).toBe(200);
    expect((pvView.body as PvViewBody).sealValid).toBe(true);

    // (e) La ligne official_pvs SUBSISTE en base (aucun DELETE physique).
    const count = await admin!.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM official_pvs WHERE id = $1`,
      [pvId],
    );
    expect(Number(count.rows[0].n)).toBe(1);
  });

  // --- 6) IDEMPOTENCE : re-supprimer un projet deja archive -> 404 -----------

  it('6) DELETE d un projet deja archive -> 404 (idempotence de la suppression)', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const token = await login(emailEng());
    const res = await del(token, orgA, projDelete);
    expect(res.status).toBe(404);
  });

  // --- 7) RBAC : VIEWER ne peut pas supprimer --------------------------------

  it('7) RBAC : un VIEWER ne peut pas supprimer -> 403', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const tokenView = await login(emailView());
    const res = await del(tokenView, orgA, projRename);
    expect(res.status).toBe(403);
  });
});
