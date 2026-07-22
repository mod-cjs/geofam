/**
 * P0-1 — ISOLATION DES COMPTEURS DE PROJET (calculs / PV), Postgres REEL.
 *
 * POURQUOI CE FICHIER EXISTE
 * --------------------------
 * `GET /projects` et `GET /projects/:id` renvoient desormais `calcCount` et
 * `pvCount`, agreges en base. C'est une NOUVELLE requete de lecture sur des
 * donnees tenant : la DoD §3 exige d'en prouver l'isolation contre une base
 * reelle, pas contre un stub.
 *
 * Le risque concret : un agregat mal scope compterait les calculs de TOUS les
 * bureaux d'etudes. Le nombre lui-meme est une fuite — il revele l'activite d'un
 * concurrent, meme sans exposer une seule ligne.
 *
 * CE QUE CE FICHIER VERROUILLE (given/when/then, esprit mutation)
 * --------------------------------------------------------------
 *  #1 CONTROLE POSITIF : orgA voit SES compteurs, avec les vraies valeurs
 *     (3 calculs, 1 PV). Sans lui, un « 0 partout » passerait pour de
 *     l'isolation alors que ce serait un agregat casse -> faux-vert.
 *  #2 ISOLATION LISTE : orgA ne voit QUE ses projets, et ses compteurs
 *     n'incluent PAS les 5 calculs d'orgB. La somme vue par A doit valoir
 *     exactement ce que A possede.
 *  #3 ISOLATION DETAIL : meme garantie sur GET /projects/:id.
 *  #4 CROSS-TENANT : orgB demandant le detail d'un projet d'orgA obtient 404
 *     tenant-safe — donc aucun compteur ne fuit par ce chemin.
 *  #5 PROJET VIDE : compteurs a 0 (valeur CONNUE), jamais absents — le front
 *     distingue « zero » de « pas encore charge ».
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

interface ProjetCompte {
  id?: unknown;
  name?: unknown;
  calcCount?: unknown;
  pvCount?: unknown;
}

const ADMIN_URL = process.env.DATABASE_URL ?? '';
const ENFORCE = process.env.CI === 'true' || ADMIN_URL.length > 0;

function loadPgClient(): PgClientCtor {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('pg') as { Client: PgClientCtor };
  return mod.Client;
}

describe('Compteurs de projet — isolation multi-tenant (e2e)', () => {
  let app: INestApplication | null = null;
  let admin: PgClient | null = null;
  let connectError: Error | null = null;

  const orgA = randomUUID();
  const orgB = randomUUID();
  const slugA = `pcnt-a-${orgA.slice(0, 8)}`;
  const slugB = `pcnt-b-${orgB.slice(0, 8)}`;
  const ownerA = randomUUID();
  const ownerB = randomUUID();

  const projA = randomUUID(); // 3 calculs + 1 PV
  const projAVide = randomUUID(); // aucun contenu
  const projB = randomUUID(); // 5 calculs cote orgB
  const PASSWORD = 'Sup3r-Secret-Counts!';

  jest.setTimeout(60_000);

  const emailA = () => `pcnt-a-${ownerA.slice(0, 8)}@roadsen.test`;
  const emailB = () => `pcnt-b-${ownerB.slice(0, 8)}@roadsen.test`;

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
        ($1,$2,$5,'PCNT Owner A',now()), ($3,$4,$5,'PCNT Owner B',now())`,
      [ownerA, emailA(), ownerB, emailB(), hash],
    );
    await admin.query(
      `INSERT INTO organizations (id, name, slug, "updatedAt") VALUES ($1,'PCNT A',$2,now()), ($3,'PCNT B',$4,now())`,
      [orgA, slugA, orgB, slugB],
    );
    await admin.query(
      `INSERT INTO memberships (id, org_id, user_id, role) VALUES ($1,$2,$3,'OWNER'), ($4,$5,$6,'OWNER')`,
      [randomUUID(), orgA, ownerA, randomUUID(), orgB, ownerB],
    );
    await admin.query(
      `INSERT INTO projects (id, org_id, name, created_by_id, updated_at) VALUES
        ($1,$2,'A — avec contenu',$3,now()),
        ($4,$2,'A — vide',$3,now()),
        ($5,$6,'B — a ne jamais compter',$7,now())`,
      [projA, orgA, ownerA, projAVide, projB, orgB, ownerB],
    );

    // 3 calculs sur projA (orgA) et 5 sur projB (orgB) : les volumes DIFFERENT,
    // pour qu'une fuite se voie immediatement dans le nombre.
    const calcs: unknown[][] = [];
    for (let i = 0; i < 3; i++)
      calcs.push([randomUUID(), orgA, projA, ownerA, 'chaussee-burmister']);
    for (let i = 0; i < 5; i++)
      calcs.push([randomUUID(), orgB, projB, ownerB, 'chaussee-burmister']);
    for (const c of calcs) {
      await admin.query(
        `INSERT INTO calc_results (id, org_id, project_id, user_id, engine_id, engine_version, input, output, created_at)
         VALUES ($1,$2,$3,$4,$5,'2.0.0','{}'::jsonb,'{}'::jsonb,now())`,
        c,
      );
    }

    // 1 PV cote orgA, 2 cote orgB.
    const pvs: unknown[][] = [
      [randomUUID(), orgA, projA, ownerA, `PV-RDS-${slugA}-2026-000001`],
      [randomUUID(), orgB, projB, ownerB, `PV-RDS-${slugB}-2026-000001`],
      [randomUUID(), orgB, projB, ownerB, `PV-RDS-${slugB}-2026-000002`],
    ];
    for (const p of pvs) {
      // Seed MINIMAL : ce test ne porte que sur le COMPTAGE, pas sur le sceau.
      // Le contenu du PV (payload, empreinte) n'a donc aucune importance ici —
      // seule compte l'existence de la ligne et son rattachement (org, projet).
      await admin.query(
        `INSERT INTO official_pvs
           (id, org_id, calc_result_id, project_id, pv_number, user_id, project_name,
            engine_id, engine_version, input_canonical, output, science_status,
            content_hash, hmac, sealed_at)
         VALUES ($1,$2,$6,$3,$5,$4,'Projet de test',
                 'chaussee-burmister','2.0.0','{}'::jsonb,'{}'::jsonb,'signed',
                 $7,$8,now())`,
        // content_hash / hmac : la base impose ^[0-9a-f]{64}$ (empreinte sha256).
        // On fournit donc une valeur au BON FORMAT, sans pretendre qu'elle soit
        // un vrai sceau — le scellement est verrouille par ses propres tests.
        [
          p[0],
          p[1],
          p[2],
          p[3],
          p[4],
          randomUUID(),
          'a'.repeat(64),
          'b'.repeat(64),
        ],
      );
    }

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
        try {
          await admin.query(`ALTER TABLE official_pvs DISABLE TRIGGER USER`);
          await admin.query(
            `DELETE FROM official_pvs WHERE org_id IN ($1,$2)`,
            [orgA, orgB],
          );
        } finally {
          // try/finally : un echec de DELETE ne doit JAMAIS laisser la base de
          // recette avec son trigger d'integrite desactive.
          await admin.query(`ALTER TABLE official_pvs ENABLE TRIGGER USER`);
        }
        await admin.query(`DELETE FROM calc_results WHERE org_id IN ($1,$2)`, [
          orgA,
          orgB,
        ]);
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

  it('#1 CONTRÔLE POSITIF — given orgA (3 calculs, 1 PV), when GET /projects, then les vraies valeurs', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const token = await login(emailA());
    const res = await request(server())
      .get('/projects')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', orgA);
    expect(res.status).toBe(200);

    const projets = res.body as ProjetCompte[];
    const avec = projets.find((p) => p.id === projA);
    // Sans ce controle, un agregat casse renvoyant 0 partout serait pris pour
    // de l'isolation reussie. Les valeurs EXACTES sont le discriminant.
    expect(avec?.calcCount).toBe(3);
    expect(avec?.pvCount).toBe(1);
  });

  it('#2 ISOLATION LISTE — given orgB (5 calculs, 2 PV), when orgA liste, then rien de B ne fuit', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const token = await login(emailA());
    const res = await request(server())
      .get('/projects')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', orgA);
    expect(res.status).toBe(200);

    const projets = res.body as ProjetCompte[];
    // Le projet d'orgB est INVISIBLE (RLS).
    expect(projets.some((p) => p.id === projB)).toBe(false);
    // Et la somme vue par A vaut EXACTEMENT ce que A possede : 3 calculs, 1 PV.
    // Si l'agregat n'etait pas scope, on lirait 8 et 3.
    const totalCalc = projets.reduce((n, p) => n + Number(p.calcCount ?? 0), 0);
    const totalPv = projets.reduce((n, p) => n + Number(p.pvCount ?? 0), 0);
    expect(totalCalc).toBe(3);
    expect(totalPv).toBe(1);
  });

  it('#3 ISOLATION DÉTAIL — given GET /projects/:id chez orgA, then compteurs de A seulement', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const token = await login(emailA());
    const res = await request(server())
      .get(`/projects/${projA}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', orgA);
    expect(res.status).toBe(200);
    const p = res.body as ProjetCompte;
    expect(p.calcCount).toBe(3);
    expect(p.pvCount).toBe(1);
  });

  it('#4 CROSS-TENANT — given orgB, when il demande le détail d’un projet d’orgA, then 404 (aucun compteur ne fuit)', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const token = await login(emailB());
    const res = await request(server())
      .get(`/projects/${projA}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', orgB);
    // 404 tenant-safe : « n'existe pas » et « existe ailleurs » sont
    // indiscernables — et surtout, aucun compteur n'est rendu.
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain('calcCount');
  });

  it('#5 PROJET VIDE — given un projet sans contenu, then 0 et 0 (valeur connue, pas absente)', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const token = await login(emailA());
    const res = await request(server())
      .get(`/projects/${projAVide}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Org-Id', orgA);
    expect(res.status).toBe(200);
    const p = res.body as ProjetCompte;
    // `0` et non `undefined` : le front n'affiche la pastille que si la valeur
    // est CONNUE. Rendre `undefined` ici ferait disparaitre le compteur.
    expect(p.calcCount).toBe(0);
    expect(p.pvCount).toBe(0);
  });
});
