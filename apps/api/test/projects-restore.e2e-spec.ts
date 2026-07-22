/**
 * P0-8 / P0-5 — RESTAURATION + DESCRIPTION, contre Postgres REEL.
 *
 * POURQUOI CE FICHIER EXISTE (revue adverse)
 * ------------------------------------------
 * Le lot ajoutait une ECRITURE tenant (`POST /projects/:id/restore`) et une
 * nouvelle lecture (`GET /projects/archived/list`) en ne fournissant qu'un spec
 * ENTIEREMENT MOCKE. Ce spec prouve que `withTenant` est appele avec le bon
 * orgId — c'est-a-dire de la PLOMBERIE — mais il ne touche ni Postgres, ni
 * `SET LOCAL`, ni la RLS, ni le `WITH CHECK`. Sur une ecriture multi-tenant,
 * l'absence de preuve n'est pas une preuve d'absence (DoD §3).
 *
 * Le second defaut couvert ici : la sentinelle de P0-5 appelait
 * `service.create()` EN CONTOURNANT le controleur, donc en contournant le
 * schema zod — or c'est precisement zod qui retirait `description` et faisait
 * disparaitre la saisie. Si quelqu'un retire le champ du schema demain, ce
 * fichier-ci rougit ; l'ancien restait vert.
 *
 * CE QUE CE FICHIER VERROUILLE (given/when/then)
 *  #1 CYCLE : archiver -> le projet disparait de la liste ET du detail ->
 *     restaurer -> il reapparait dans les deux.
 *  #2 ISOLATION ECRITURE : orgB restaure un projet archive d'orgA -> 404, ET
 *     CONTRE-PREUVE en base : la ligne d'orgA est TOUJOURS archivee. Sans cette
 *     seconde verification, un 404 pourrait masquer une ecriture reussie.
 *  #3 ISOLATION LECTURE : la liste des archives d'orgB ne contient aucun projet
 *     d'orgA.
 *  #4 RBAC : un VIEWER ne restaure pas (403), alors qu'il PEUT lister — voir/
 *     agir sont deux droits distincts.
 *  #5 IDEMPOTENCE : restaurer deux fois -> 404 la seconde fois.
 *  #6 DESCRIPTION (P0-5) : POST avec description -> GET -> elle est LA. C'est
 *     le chemin complet, zod compris.
 *  #7 BORNE : description > 2000 caracteres -> 400 (jamais tronquee en silence).
 *
 * ANTI-SKIP : DATABASE_URL absent ET CI -> echec dur. Hors CI sans base ->
 * non-execute (honnete), jamais compte comme reussi.
 */
import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
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

interface ProjetBody {
  id?: unknown;
  name?: unknown;
  status?: unknown;
  description?: unknown;
}

const ADMIN_URL = process.env.DATABASE_URL ?? '';
const ENFORCE = process.env.CI === 'true' || ADMIN_URL.length > 0;

function loadPgClient(): PgClientCtor {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('pg') as { Client: PgClientCtor };
  return mod.Client;
}

describe('Restauration de projet + description — e2e (Postgres réel)', () => {
  let app: INestApplication | null = null;
  let admin: PgClient | null = null;
  let connectError: Error | null = null;

  const orgA = randomUUID();
  const orgB = randomUUID();
  const slugA = `rst-a-${orgA.slice(0, 8)}`;
  const slugB = `rst-b-${orgB.slice(0, 8)}`;
  const ownerA = randomUUID();
  const viewerA = randomUUID();
  const ownerB = randomUUID();
  const projA = randomUUID(); // archivé, cible des tests
  const PASSWORD = 'Sup3r-Secret-Restore!';

  jest.setTimeout(60_000);

  const mailA = () => `rst-a-${ownerA.slice(0, 8)}@roadsen.test`;
  const mailViewer = () => `rst-v-${viewerA.slice(0, 8)}@roadsen.test`;
  const mailB = () => `rst-b-${ownerB.slice(0, 8)}@roadsen.test`;

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
        ($1,$2,$7,'RST Owner A',now()), ($3,$4,$7,'RST Viewer A',now()), ($5,$6,$7,'RST Owner B',now())`,
      [ownerA, mailA(), viewerA, mailViewer(), ownerB, mailB(), hash],
    );
    await admin.query(
      `INSERT INTO organizations (id, name, slug, "updatedAt") VALUES ($1,'RST A',$2,now()), ($3,'RST B',$4,now())`,
      [orgA, slugA, orgB, slugB],
    );
    await admin.query(
      `INSERT INTO memberships (id, org_id, user_id, role) VALUES
        ($1,$2,$3,'OWNER'), ($4,$2,$5,'VIEWER'), ($6,$7,$8,'OWNER')`,
      [
        randomUUID(),
        orgA,
        ownerA,
        randomUUID(),
        viewerA,
        randomUUID(),
        orgB,
        ownerB,
      ],
    );
    // Projet d'orgA DEJA archivé : cible de la restauration cross-tenant.
    await admin.query(
      `INSERT INTO projects (id, org_id, name, created_by_id, status, updated_at)
       VALUES ($1,$2,'A — archivé',$3,'ARCHIVED',now())`,
      [projA, orgA, ownerA],
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
          ownerA,
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

  async function statutEnBase(id: string): Promise<string | null> {
    const r = await admin!.query<{ status: string }>(
      `SELECT status FROM projects WHERE id = $1`,
      [id],
    );
    return r.rows[0]?.status ?? null;
  }

  it('#2 ISOLATION ÉCRITURE — orgB restaure un projet d’orgA → 404, ET la ligne d’orgA reste ARCHIVED', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const tB = await login(mailB());
    const res = await request(server())
      .post(`/projects/${projA}/restore`)
      .set(auth(tB, orgB));
    expect(res.status).toBe(404);

    // CONTRE-PREUVE : sans elle, un 404 pourrait masquer une écriture réussie.
    // C'est la vérification qui prouve réellement l'isolation, pas le code HTTP.
    expect(await statutEnBase(projA)).toBe('ARCHIVED');
  });

  it('#3 ISOLATION LECTURE — la liste des archivés d’orgB ne contient aucun projet d’orgA', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const tB = await login(mailB());
    const res = await request(server())
      .get('/projects/archived/list')
      .set(auth(tB, orgB));
    expect(res.status).toBe(200);
    const ids = (res.body as ProjetBody[]).map((p) => p.id);
    expect(ids).not.toContain(projA);
  });

  it('#4 RBAC — un VIEWER peut LISTER les archivés mais ne peut PAS restaurer (403)', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const tV = await login(mailViewer());
    // Voir : autorisé (un VIEWER lit déjà tout le tenant).
    const lecture = await request(server())
      .get('/projects/archived/list')
      .set(auth(tV, orgA));
    expect(lecture.status).toBe(200);
    // Agir : refusé. Voir et agir sont deux droits distincts.
    const ecriture = await request(server())
      .post(`/projects/${projA}/restore`)
      .set(auth(tV, orgA));
    expect(ecriture.status).toBe(403);
    expect(await statutEnBase(projA)).toBe('ARCHIVED');
  });

  it('#1 CYCLE + #5 IDEMPOTENCE — restaurer rend le projet visible ; re-restaurer → 404', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const tA = await login(mailA());

    // Avant : invisible en liste ET en détail.
    const listeAvant = await request(server())
      .get('/projects')
      .set(auth(tA, orgA));
    expect((listeAvant.body as ProjetBody[]).map((p) => p.id)).not.toContain(
      projA,
    );
    const detailAvant = await request(server())
      .get(`/projects/${projA}`)
      .set(auth(tA, orgA));
    expect(detailAvant.status).toBe(404);

    // Restauration.
    const restore = await request(server())
      .post(`/projects/${projA}/restore`)
      .set(auth(tA, orgA));
    expect(restore.status).toBeLessThan(300);
    expect((restore.body as ProjetBody).status).toBe('ACTIVE');

    // Après : visible dans les DEUX (le détail était le point faible).
    const listeApres = await request(server())
      .get('/projects')
      .set(auth(tA, orgA));
    expect((listeApres.body as ProjetBody[]).map((p) => p.id)).toContain(projA);
    const detailApres = await request(server())
      .get(`/projects/${projA}`)
      .set(auth(tA, orgA));
    expect(detailApres.status).toBe(200);

    // Idempotence : la seconde restauration ne trouve plus rien à restaurer.
    const bis = await request(server())
      .post(`/projects/${projA}/restore`)
      .set(auth(tA, orgA));
    expect(bis.status).toBe(404);
  });

  it('#6 DESCRIPTION — POST avec description → GET la renvoie (chemin complet, zod compris)', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const tA = await login(mailA());
    const texte = 'Reconnaissance géotechnique — 3 sondages pressiométriques.';

    const cree = await request(server())
      .post('/projects')
      .set(auth(tA, orgA))
      .send({
        name: 'Projet avec description',
        domain: 'FD',
        description: texte,
      });
    expect(cree.status).toBeLessThan(300);
    // Sentinelle du défaut d'origine : zod retirait le champ et la saisie
    // disparaissait en silence. Ce test rougit si on l'enlève du schéma.
    expect((cree.body as ProjetBody).description).toBe(texte);

    const id = String((cree.body as ProjetBody).id);
    const relu = await request(server())
      .get(`/projects/${id}`)
      .set(auth(tA, orgA));
    expect(relu.status).toBe(200);
    expect((relu.body as ProjetBody).description).toBe(texte);
  });

  it('#7 BORNE — une description trop longue est REFUSÉE (400), jamais tronquée en silence', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const tA = await login(mailA());
    const res = await request(server())
      .post('/projects')
      .set(auth(tA, orgA))
      .send({ name: 'Trop long', domain: 'CH', description: 'x'.repeat(2001) });
    // Tronquer silencieusement reproduirait le défaut d'origine sous une autre
    // forme : l'utilisateur croirait avoir enregistré ce qu'il a saisi.
    expect(res.status).toBe(400);
  });
});
