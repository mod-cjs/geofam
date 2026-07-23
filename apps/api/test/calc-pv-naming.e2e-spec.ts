/**
 * ETIQUETTES D'AFFICHAGE `name` (calc_results + official_pvs) — e2e Postgres REEL.
 *
 * POURQUOI CE FICHIER (DoD §3/§5)
 * -------------------------------
 * On ajoute un libelle MUTABLE, distinct du contenu, et — pour le PV — distinct
 * du contenu SCELLE. Deux garanties ne se prouvent que contre la VRAIE base :
 *
 *  A) LE RENOMMAGE NE RE-SCELLE PAS : renommer un PV NE DOIT PAS toucher
 *     hmac / content_hash / sealValid. On emet un PV, on note son sceau, on le
 *     renomme, on relit : sceau IDENTIQUE, sealValid TOUJOURS vrai, name change.
 *     ATTENTION A LA PORTEE (revue ingenieur-securite) : ce cas A ne prouve PAS,
 *     a lui seul, que `name` est hors de la CANONIQUE — il emet SANS name, donc
 *     input_canonical ne contiendrait de toute facon pas le libelle. C'est le
 *     cas B (emission AVEC name + contre-preuve `input_canonical NOT LIKE`) qui
 *     est le gardien de « name hors sceau ». A prouve « le renommage ne re-scelle
 *     pas » ; B prouve « name n'entre jamais dans la canonique ». Les deux sont
 *     necessaires.
 *
 *  B) ISOLATION ECRITURE avec CONTRE-PREUVE EN BASE (un 404 ne prouve rien seul) :
 *     orgB renomme / supprime un calcul (ou renomme un PV) d'orgA -> 404, ET la
 *     ligne d'orgA est INCHANGEE en base. Controle POSITIF obligatoire : les
 *     memes gestes sur son propre tenant reussissent.
 *
 * Autres verrous : DELETE d'un calcul scelle -> 409 (source d'un PV non
 * detruite) ; DELETE d'un calcul non scelle -> disparait (calcul + capture) ;
 * emission AVEC/ SANS name ; RBAC (VIEWER/TECHNICIAN ne renomment ni ne
 * suppriment) ; retour au mnemonique (name=null).
 *
 * ANTI-SKIP : DATABASE_URL absent ET CI -> echec dur. Hors CI sans base ->
 * non-execute (honnete), jamais compte comme reussi. `expect.hasAssertions()`
 * sur chaque cas conditionnel.
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
  name?: unknown;
}
interface PvFlat {
  id?: unknown;
  pvNumber?: unknown;
  contentHash?: unknown;
  hmac?: unknown;
  name?: unknown;
}
interface PvView {
  pv?: {
    id?: unknown;
    contentHash?: unknown;
    hmac?: unknown;
    name?: unknown;
    inputCanonical?: unknown;
  };
  sealValid?: unknown;
}

const ADMIN_URL = process.env.DATABASE_URL ?? '';
const ENFORCE = process.env.CI === 'true' || ADMIN_URL.length > 0;

function loadPgClient(): PgClientCtor {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('pg') as { Client: PgClientCtor };
  return mod.Client;
}

describe('Etiquettes name (calc + PV) — e2e (Postgres réel)', () => {
  let app: INestApplication | null = null;
  let admin: PgClient | null = null;
  let connectError: Error | null = null;

  const orgA = randomUUID();
  const orgB = randomUUID();
  const slugA = `nm-a-${orgA.slice(0, 8)}`;
  const slugB = `nm-b-${orgB.slice(0, 8)}`;
  const engineerA = randomUUID();
  const viewerA = randomUUID();
  const techA = randomUUID();
  const ownerB = randomUUID();
  const projA = randomUUID();
  const projB = randomUUID();
  const PASSWORD = 'Sup3r-Secret-Naming!';

  const burmisterInput = BURMISTER_FIXTURES[0].input;

  jest.setTimeout(60_000);

  const mailEng = () => `nm-eng-${engineerA.slice(0, 8)}@roadsen.test`;
  const mailView = () => `nm-view-${viewerA.slice(0, 8)}@roadsen.test`;
  const mailTech = () => `nm-tech-${techA.slice(0, 8)}@roadsen.test`;
  const mailB = () => `nm-b-${ownerB.slice(0, 8)}@roadsen.test`;

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
        ($1,$2,$9,'NM Eng A',now()),
        ($3,$4,$9,'NM View A',now()),
        ($5,$6,$9,'NM Tech A',now()),
        ($7,$8,$9,'NM Owner B',now())`,
      [
        engineerA,
        mailEng(),
        viewerA,
        mailView(),
        techA,
        mailTech(),
        ownerB,
        mailB(),
        hash,
      ],
    );
    await admin.query(
      `INSERT INTO organizations (id, name, slug, "updatedAt") VALUES ($1,'NM A',$2,now()), ($3,'NM B',$4,now())`,
      [orgA, slugA, orgB, slugB],
    );
    await admin.query(
      `INSERT INTO memberships (id, org_id, user_id, role) VALUES
        ($1,$2,$3,'ENGINEER'), ($4,$2,$5,'VIEWER'), ($6,$2,$7,'TECHNICIAN'), ($8,$9,$10,'OWNER')`,
      [
        randomUUID(),
        orgA,
        engineerA,
        randomUUID(),
        viewerA,
        randomUUID(),
        techA,
        randomUUID(),
        orgB,
        ownerB,
      ],
    );
    await admin.query(
      `INSERT INTO projects (id, org_id, name, created_by_id, updated_at) VALUES ($1,$2,'P-A',$3,now()), ($4,$5,'P-B',$6,now())`,
      [projA, orgA, engineerA, projB, orgB, ownerB],
    );
    // Abonnements larges + entitlement burmister pour les deux orgs (la suite
    // teste le nommage, pas l'enforcement d'abonnement).
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
        await admin.query(`DELETE FROM memberships WHERE org_id IN ($1,$2)`, [
          orgA,
          orgB,
        ]);
        await admin.query(`ALTER TABLE usage_ledger DISABLE TRIGGER USER`);
        try {
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
        await admin.query(`DELETE FROM organizations WHERE id IN ($1,$2)`, [
          orgA,
          orgB,
        ]);
        await admin.query(`DELETE FROM users WHERE id IN ($1,$2,$3,$4)`, [
          engineerA,
          viewerA,
          techA,
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
  const auth = (t: string, org: string) => ({
    Authorization: `Bearer ${t}`,
    'X-Org-Id': org,
  });

  // Helpers HTTP.
  const runCalc = (t: string, org: string, project: string) =>
    request(server())
      .post(`/projects/${project}/calc/burmister`)
      .set(auth(t, org))
      .send(burmisterInput);
  const emit = (
    t: string,
    org: string,
    project: string,
    calcId: string,
    body?: unknown,
  ) => {
    const r = request(server())
      .post(`/projects/${project}/calc-results/${calcId}/pv`)
      .set(auth(t, org));
    return body === undefined ? r : r.send(body as object);
  };
  const patchCalc = (
    t: string,
    org: string,
    project: string,
    calcId: string,
    name: string | null,
  ) =>
    request(server())
      .patch(`/projects/${project}/calc-results/${calcId}`)
      .set(auth(t, org))
      .send({ name });
  const delCalc = (t: string, org: string, project: string, calcId: string) =>
    request(server())
      .delete(`/projects/${project}/calc-results/${calcId}`)
      .set(auth(t, org));
  const getCalc = (t: string, org: string, project: string, calcId: string) =>
    request(server())
      .get(`/projects/${project}/calc-results/${calcId}`)
      .set(auth(t, org));
  const getPv = (t: string, org: string, project: string, pvId: string) =>
    request(server()).get(`/projects/${project}/pvs/${pvId}`).set(auth(t, org));
  const patchPv = (
    t: string,
    org: string,
    project: string,
    pvId: string,
    name: string | null,
  ) =>
    request(server())
      .patch(`/projects/${project}/pvs/${pvId}`)
      .set(auth(t, org))
      .send({ name });

  async function newCalcId(): Promise<string> {
    const t = await login(mailEng());
    const c = await runCalc(t, orgA, projA);
    expect(c.status).toBe(201);
    return String((c.body as CalcBody).calcResultId);
  }
  async function newPvId(
    name?: string,
  ): Promise<{ pvId: string; calcId: string }> {
    const t = await login(mailEng());
    const calcId = await newCalcId();
    const e = await emit(
      t,
      orgA,
      projA,
      calcId,
      name === undefined ? undefined : { name },
    );
    expect(e.status).toBe(201);
    return { pvId: String((e.body as PvFlat).id), calcId };
  }

  // === A) NAME HORS SCEAU (point critique) ================================

  it('A) renommer un PV laisse hmac / content_hash / sealValid INCHANGES', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const t = await login(mailEng());
    const { pvId } = await newPvId();

    // Sceau AVANT renommage.
    const before = await getPv(t, orgA, projA, pvId);
    expect(before.status).toBe(200);
    const vBefore = before.body as PvView;
    expect(vBefore.sealValid).toBe(true);
    const hmac0 = String(vBefore.pv?.hmac);
    const hash0 = String(vBefore.pv?.contentHash);
    const canon0 = String(vBefore.pv?.inputCanonical);
    expect(hmac0).toMatch(/^[0-9a-f]{64}$/);

    // Renommage de l'ETIQUETTE.
    const patched = await patchPv(
      t,
      orgA,
      projA,
      pvId,
      'Rapport pont Mbodiène',
    );
    expect(patched.status).toBe(200);
    const vp = patched.body as PvView;
    expect(vp.pv?.name).toBe('Rapport pont Mbodiène');
    // La reponse du PATCH re-verifie le sceau : il tient.
    expect(vp.sealValid).toBe(true);

    // Sceau APRES renommage : STRICTEMENT identique (name est HORS canonique).
    const after = await getPv(t, orgA, projA, pvId);
    const vAfter = after.body as PvView;
    expect(vAfter.pv?.hmac).toBe(hmac0);
    expect(vAfter.pv?.contentHash).toBe(hash0);
    expect(vAfter.pv?.inputCanonical).toBe(canon0);
    expect(vAfter.sealValid).toBe(true);
    expect(vAfter.pv?.name).toBe('Rapport pont Mbodiène');

    // CONTRE-PREUVE EN BASE : la canonique scellee ne contient PAS le libelle.
    const row = await admin!.query<{ input_canonical: string }>(
      `SELECT input_canonical FROM official_pvs WHERE id = $1`,
      [pvId],
    );
    expect(row.rows[0]?.input_canonical).not.toContain('Rapport pont Mbodiène');
  });

  it('A2) renommer vers null (retour mnemonique) laisse aussi le sceau intact', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const t = await login(mailEng());
    const { pvId } = await newPvId('Nom initial');

    const before = await getPv(t, orgA, projA, pvId);
    const hmac0 = String((before.body as PvView).pv?.hmac);

    const cleared = await patchPv(t, orgA, projA, pvId, null);
    expect(cleared.status).toBe(200);
    expect((cleared.body as PvView).pv?.name).toBeNull();
    expect((cleared.body as PvView).sealValid).toBe(true);

    const after = await getPv(t, orgA, projA, pvId);
    expect((after.body as PvView).pv?.hmac).toBe(hmac0);
    expect((after.body as PvView).sealValid).toBe(true);
  });

  // === EMISSION AVEC / SANS name ==========================================

  it('B) emission AVEC name -> stocke ; SANS name -> null', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const t = await login(mailEng());

    const calc1 = await newCalcId();
    const withName = await emit(t, orgA, projA, calc1, { name: 'PV nommé' });
    expect(withName.status).toBe(201);
    expect((withName.body as PvFlat).name).toBe('PV nommé');
    // CONTRE-PREUVE (name HORS SCEAU des l'emission) : le libelle fourni a
    // l'emission NE DOIT PAS entrer dans la chaine canonique scellee. S'il y
    // entrait, il serait couvert par le HMAC — et renommer casserait le sceau.
    const pvIdWith = String((withName.body as PvFlat).id);
    const canon = await admin!.query<{ input_canonical: string }>(
      `SELECT input_canonical FROM official_pvs WHERE id = $1`,
      [pvIdWith],
    );
    expect(canon.rows[0]?.input_canonical).not.toContain('PV nommé');

    const calc2 = await newCalcId();
    const noName = await emit(t, orgA, projA, calc2); // aucun corps
    expect(noName.status).toBe(201);
    expect((noName.body as PvFlat).name).toBeNull();
  });

  // === RENOMMAGE de CALCUL ================================================

  it('C) PATCH calc name -> visible en lecture ; PATCH null -> retour mnemonique', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const t = await login(mailEng());
    const calcId = await newCalcId();

    // A la creation : pas de nom.
    const initial = await getCalc(t, orgA, projA, calcId);
    expect((initial.body as CalcBody).name).toBeNull();

    const named = await patchCalc(t, orgA, projA, calcId, 'Variante GNT 30cm');
    expect(named.status).toBe(200);
    expect((named.body as CalcBody).name).toBe('Variante GNT 30cm');
    const relu = await getCalc(t, orgA, projA, calcId);
    expect((relu.body as CalcBody).name).toBe('Variante GNT 30cm');

    const cleared = await patchCalc(t, orgA, projA, calcId, null);
    expect(cleared.status).toBe(200);
    expect((cleared.body as CalcBody).name).toBeNull();
  });

  // === D) ISOLATION ECRITURE + CONTRE-PREUVE =============================

  it('D1) orgB renomme un calcul d’orgA -> 404, ET le calcul d’orgA est INCHANGE', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const tA = await login(mailEng());
    const calcId = await newCalcId();
    // orgA lui donne un nom connu.
    await patchCalc(tA, orgA, projA, calcId, 'ORIGINAL-A');

    const tB = await login(mailB());
    // orgB tente de renommer via SON org (RLS) — meme en connaissant les ids.
    const res = await patchCalc(tB, orgB, projB, calcId, 'PIRATÉ-B');
    expect(res.status).toBe(404);
    // Et via le VRAI projet d'orgA (mais toujours sous le contexte tenant orgB).
    const res2 = await patchCalc(tB, orgB, projA, calcId, 'PIRATÉ-B');
    expect(res2.status).toBe(404);

    // CONTRE-PREUVE EN BASE : le nom d'orgA n'a pas bouge.
    const row = await admin!.query<{ name: string | null }>(
      `SELECT name FROM calc_results WHERE id = $1`,
      [calcId],
    );
    expect(row.rows[0]?.name).toBe('ORIGINAL-A');
  });

  it('D2) orgB supprime un calcul d’orgA -> 404, ET le calcul d’orgA EXISTE toujours', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const calcId = await newCalcId();

    const tB = await login(mailB());
    const res = await delCalc(tB, orgB, projA, calcId);
    expect(res.status).toBe(404);

    // CONTRE-PREUVE : la ligne existe encore.
    const row = await admin!.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM calc_results WHERE id = $1`,
      [calcId],
    );
    expect(Number(row.rows[0]?.n)).toBe(1);
  });

  it('D3) orgB renomme un PV d’orgA -> 404, ET le PV d’orgA est INCHANGE', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const { pvId } = await newPvId('PV-A-ORIGINAL');

    const tB = await login(mailB());
    const res = await patchPv(tB, orgB, projA, pvId, 'PV-PIRATÉ-B');
    expect(res.status).toBe(404);

    const row = await admin!.query<{ name: string | null }>(
      `SELECT name FROM official_pvs WHERE id = $1`,
      [pvId],
    );
    expect(row.rows[0]?.name).toBe('PV-A-ORIGINAL');
  });

  // === E) DELETE : 409 si scelle, sinon disparait ========================

  it('E1) DELETE d’un calcul NON scelle -> 204/200, la ligne (et sa capture) disparaissent', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const t = await login(mailEng());
    const calcId = await newCalcId();
    // Capture liee (pour prouver qu'elle est supprimee avec le calcul).
    const snap = await request(server())
      .post(`/projects/${projA}/calc-results/${calcId}/snapshot`)
      .set(auth(t, orgA))
      .send({ displayHtml: '<p>d</p>', printHtml: '<p>p</p>' });
    expect(snap.status).toBeLessThan(300);

    const del = await delCalc(t, orgA, projA, calcId);
    expect(del.status).toBeLessThan(300);

    // La lecture ne le trouve plus (404 tenant-safe).
    const relu = await getCalc(t, orgA, projA, calcId);
    expect(relu.status).toBe(404);
    // CONTRE-PREUVE : calcul ET capture absents en base.
    const c = await admin!.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM calc_results WHERE id = $1`,
      [calcId],
    );
    expect(Number(c.rows[0]?.n)).toBe(0);
    const s = await admin!.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM calc_snapshots WHERE calc_result_id = $1`,
      [calcId],
    );
    expect(Number(s.rows[0]?.n)).toBe(0);
  });

  it('E2) DELETE d’un calcul SCELLE en PV -> 409, calcul + PV CONSERVES', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const t = await login(mailEng());
    const { pvId, calcId } = await newPvId();

    const del = await delCalc(t, orgA, projA, calcId);
    expect(del.status).toBe(409);
    // Message exploitable.
    expect(JSON.stringify(del.body)).toMatch(/scell/i);

    // CONTRE-PREUVE : le calcul ET le PV existent toujours.
    const c = await admin!.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM calc_results WHERE id = $1`,
      [calcId],
    );
    expect(Number(c.rows[0]?.n)).toBe(1);
    const p = await admin!.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM official_pvs WHERE id = $1`,
      [pvId],
    );
    expect(Number(p.rows[0]?.n)).toBe(1);
  });

  // === F) RBAC : voir n'est pas agir =====================================

  it('F) VIEWER et TECHNICIAN ne renomment/suppriment PAS (403) ; ENGINEER oui (contrôle positif)', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const tEng = await login(mailEng());
    const tView = await login(mailView());
    const tTech = await login(mailTech());

    const calcId = await newCalcId();
    // VIEWER : lit (autorise ailleurs) mais NE renomme ni ne supprime.
    expect((await patchCalc(tView, orgA, projA, calcId, 'x')).status).toBe(403);
    expect((await delCalc(tView, orgA, projA, calcId)).status).toBe(403);
    // TECHNICIAN : peut lancer un calcul mais PAS le renommer/supprimer (acte de gestion).
    expect((await patchCalc(tTech, orgA, projA, calcId, 'x')).status).toBe(403);
    expect((await delCalc(tTech, orgA, projA, calcId)).status).toBe(403);

    // PV : VIEWER/TECHNICIAN ne renomment pas non plus.
    const { pvId } = await newPvId();
    expect((await patchPv(tView, orgA, projA, pvId, 'x')).status).toBe(403);
    expect((await patchPv(tTech, orgA, projA, pvId, 'x')).status).toBe(403);

    // CONTROLE POSITIF : l'ENGINEER, lui, renomme le PV avec succes.
    const ok = await patchPv(tEng, orgA, projA, pvId, 'Nom légitime');
    expect(ok.status).toBe(200);
    expect((ok.body as PvView).pv?.name).toBe('Nom légitime');
  });

  // === G) VALIDATION d'entree ============================================

  it('G) name vide ou > 200 caracteres -> 400 (jamais tronque en silence)', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const t = await login(mailEng());
    const calcId = await newCalcId();
    // Chaine vide (min 1 apres trim).
    expect((await patchCalc(t, orgA, projA, calcId, '   ')).status).toBe(400);
    // Trop long.
    expect(
      (await patchCalc(t, orgA, projA, calcId, 'x'.repeat(201))).status,
    ).toBe(400);
  });
});
