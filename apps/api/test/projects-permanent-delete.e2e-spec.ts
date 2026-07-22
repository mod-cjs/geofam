/**
 * SUPPRESSION DEFINITIVE D'UN PROJET — DELETE /projects/:id/permanent.
 * e2e contre Postgres REEL.
 *
 * POURQUOI CET ENDPOINT
 * ---------------------
 * La maquette validee distingue deux gestes que le serveur confondait :
 *   - ARCHIVER (DELETE /projects/:id) : reversible, le projet sort des listes
 *     mais reste en base ;
 *   - SUPPRIMER DEFINITIVEMENT : irreversible, la ligne et ses calculs
 *     disparaissent. Ce second geste n'existait PAS cote serveur : la corbeille
 *     ne pouvait donc jamais etre videe.
 *
 * REGLES VERROUILLEES ICI (given/when/then)
 *  #1 RBAC — detruire n'est pas archiver : OWNER et ADMIN seulement (+SUPERADMIN).
 *     Un ENGINEER, qui PEUT pourtant archiver, recoit 403 — et la ligne est
 *     toujours en base (contre-preuve : un 403 ne doit pas masquer une ecriture).
 *  #2 ISOLATION — orgB supprime definitivement un projet d'orgA -> 404
 *     tenant-safe, ET la ligne d'orgA EXISTE TOUJOURS en base.
 *  #3 REFUS 409 — un projet portant au moins un PV SCELLE n'est jamais detruit :
 *     on promet l'integrite d'un PV scelle, donc on n'orpheline jamais son
 *     projet. Message exploitable par l'interface (« archivez-le a la place »).
 *     Contre-preuve : projet ET PV toujours en base.
 *  #4 SUPPRESSION REELLE — le projet, ses calc_results et leurs calc_snapshots
 *     disparaissent ; AUCUNE ligne ne survit. Et ce n'est PAS un archivage
 *     deguise : zero ligne dans `projects`, pas un status ARCHIVED.
 *  #5 LEDGER APPEND-ONLY — le quota deja consomme par les calculs supprimes
 *     RESTE consomme : les lignes usage_ledger et `subscriptions.consommation`
 *     sont INCHANGEES. C'est voulu (on ne reecrit jamais un registre de
 *     facturation), et c'est teste pour que personne ne « corrige » cela.
 *  #6 DEPUIS LA CORBEILLE — un projet ARCHIVE se supprime aussi definitivement
 *     (c'est le cas d'usage principal : vider la corbeille).
 *  #7 IDEMPOTENCE NEGATIVE — re-supprimer, ou viser un id inexistant -> 404.
 *  #8 ORDRE DES ROUTES — `permanent` n'est pas capte comme un `:projectId` :
 *     l'appel avec un id NON-uuid suivi de /permanent renvoie 400 (le pipe uuid
 *     s'applique bien au segment id), et les cas #4/#6 prouvent que la route
 *     atteint bien la suppression definitive et non l'archivage.
 *
 * ANTI-SKIP : DATABASE_URL absent ET CI -> echec dur. Hors CI sans base ->
 * non-execute (honnete), jamais compte comme reussi. `expect.hasAssertions()`
 * sur chaque cas a execution conditionnelle.
 */
import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { BURMISTER_FIXTURES } from '@roadsen/engines';
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

interface CalcBody {
  calcResultId?: unknown;
}
interface ErreurBody {
  // `string` et non `unknown` : le filtre d'exception rend toujours un message
  // texte. Le typer ici evite un `String(objet)` qui donnerait « [object Object] »
  // et ferait passer une assertion pour verte sur du vide.
  message?: string;
}

const ADMIN_URL = process.env.DATABASE_URL ?? '';
const ENFORCE = process.env.CI === 'true' || ADMIN_URL.length > 0;
const SIGNING_SECRET = process.env.PV_SIGNING_SECRET ?? '';

const DISPLAY_HTML = '<html><body><p>Doc — affichage</p></body></html>';
const PRINT_HTML = '<html><body><p>Doc — impression</p></body></html>';

function loadPgClient(): PgClientCtor {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('pg') as { Client: PgClientCtor };
  return mod.Client;
}

describe('Suppression DÉFINITIVE d’un projet (e2e Postgres réel)', () => {
  let app: INestApplication | null = null;
  let admin: PgClient | null = null;
  let connectError: Error | null = null;

  const orgA = randomUUID();
  const orgB = randomUUID();
  const slugA = `pdl-a-${orgA.slice(0, 8)}`;
  const slugB = `pdl-b-${orgB.slice(0, 8)}`;
  const ownerA = randomUUID();
  const adminA = randomUUID();
  const engA = randomUUID();
  const ownerB = randomUUID();

  const projPlein = randomUUID(); // calcul + capture -> suppression réelle (#4)
  const projPv = randomUUID(); // porte un PV scellé -> 409 (#3)
  const projArchive = randomUUID(); // ARCHIVED -> suppression depuis la corbeille (#6)
  const projRbac = randomUUID(); // cible du 403 (#1)
  const projIso = randomUUID(); // cible cross-tenant (#2)
  const pvId = randomUUID();

  const PASSWORD = 'Sup3r-Secret-HardDelete!';
  const burmisterInput = BURMISTER_FIXTURES[0].input;

  jest.setTimeout(90_000);

  const mailOwner = () => `pdl-o-${ownerA.slice(0, 8)}@roadsen.test`;
  const mailAdmin = () => `pdl-ad-${adminA.slice(0, 8)}@roadsen.test`;
  const mailEng = () => `pdl-e-${engA.slice(0, 8)}@roadsen.test`;
  const mailB = () => `pdl-b-${ownerB.slice(0, 8)}@roadsen.test`;

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
        ($1,$2,$9,'PDL Owner A',now()),
        ($3,$4,$9,'PDL Admin A',now()),
        ($5,$6,$9,'PDL Eng A',now()),
        ($7,$8,$9,'PDL Owner B',now())`,
      [
        ownerA,
        mailOwner(),
        adminA,
        mailAdmin(),
        engA,
        mailEng(),
        ownerB,
        mailB(),
        hash,
      ],
    );
    await admin.query(
      `INSERT INTO organizations (id, name, slug, "updatedAt") VALUES ($1,'PDL A',$2,now()), ($3,'PDL B',$4,now())`,
      [orgA, slugA, orgB, slugB],
    );
    await admin.query(
      `INSERT INTO memberships (id, org_id, user_id, role) VALUES
        ($1,$2,$3,'OWNER'), ($4,$2,$5,'ADMIN'), ($6,$2,$7,'ENGINEER'), ($8,$9,$10,'OWNER')`,
      [
        randomUUID(),
        orgA,
        ownerA,
        randomUUID(),
        adminA,
        randomUUID(),
        engA,
        randomUUID(),
        orgB,
        ownerB,
      ],
    );
    await admin.query(
      `INSERT INTO projects (id, org_id, name, created_by_id, status, updated_at) VALUES
        ($1,$2,'PDL — plein',$3,'ACTIVE',now()),
        ($4,$2,'PDL — avec PV',$3,'ACTIVE',now()),
        ($5,$2,'PDL — archivé',$3,'ARCHIVED',now()),
        ($6,$2,'PDL — rbac',$3,'ACTIVE',now()),
        ($7,$2,'PDL — isolation',$3,'ACTIVE',now())`,
      [projPlein, orgA, ownerA, projPv, projArchive, projRbac, projIso],
    );
    await admin.query(
      `INSERT INTO subscriptions
         (id, org_id, pack, entitlements, date_debut, date_fin, quota, consommation, created_at, updated_at)
       VALUES
         ($1,$2,'ROUTES', ARRAY['burmister'], now() - interval '1 day', now() + interval '365 days', 1000, 0, now(), now()),
         ($3,$4,'ROUTES', ARRAY['burmister'], now() - interval '1 day', now() + interval '365 days', 1000, 0, now(), now())`,
      [randomUUID(), orgA, randomUUID(), orgB],
    );

    // PV SCELLÉ pré-seedé sur projPv (sceau RÉEL, même secret que le serveur) :
    // c'est le livrable qu'on refuse d'orpheliner.
    const sealedAtIso = new Date().toISOString();
    const numero = `PV-RDS-${slugA}-${new Date().getFullYear()}-000001`;
    const content: SealableValue = {
      pvNumber: numero,
      verdict: 'CONFORME',
      sealedAt: sealedAtIso,
      identity: { projectId: projPv, orgDisplayName: 'PDL A' },
    };
    const canonical = canonicalize(content);
    await admin.query(
      `INSERT INTO official_pvs
         (id, org_id, calc_result_id, project_id, pv_number, user_id, project_name,
          engine_id, engine_version, input_canonical, output, science_status,
          verdict, content_hash, hmac, sealed_at)
       VALUES ($1,$2,$3,$4,$5,$6,'PDL — avec PV',
          'chaussee-burmister','1.0.0',$7,'{}'::jsonb,'unsigned',
          'CONFORME',$8,$9,$10)`,
      [
        pvId,
        orgA,
        randomUUID(),
        projPv,
        numero,
        ownerA,
        canonical,
        sealContentHash(canonical),
        sealHmac(canonical, SIGNING_SECRET),
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
  }, 90_000);

  afterAll(async () => {
    if (admin) {
      try {
        // official_pvs IMMUABLE / usage_ledger APPEND-ONLY : triggers désactivés le
        // temps de la purge. try/finally OBLIGATOIRE — un échec de DELETE ne doit
        // jamais laisser la base de recette avec ses triggers d'intégrité coupés.
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
        await admin.query(`DELETE FROM users WHERE id IN ($1,$2,$3,$4)`, [
          ownerA,
          adminA,
          engA,
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

  const supprimerDefinitivement = (t: string, org: string, id: string) =>
    request(server()).delete(`/projects/${id}/permanent`).set(auth(t, org));

  // --- Sondes en base --------------------------------------------------------

  const compte = async (sql: string, params: unknown[]): Promise<number> => {
    const r = await admin!.query<{ n: string }>(sql, params);
    return Number(r.rows[0]?.n ?? 0);
  };
  const nbProjets = (id: string) =>
    compte(`SELECT count(*)::int AS n FROM projects WHERE id = $1`, [id]);
  const nbCalcs = (projectId: string) =>
    compte(
      `SELECT count(*)::int AS n FROM calc_results WHERE project_id = $1`,
      [projectId],
    );
  const nbSnapshots = (calcResultId: string) =>
    compte(
      `SELECT count(*)::int AS n FROM calc_snapshots WHERE calc_result_id = $1`,
      [calcResultId],
    );
  const nbPvs = (projectId: string) =>
    compte(
      `SELECT count(*)::int AS n FROM official_pvs WHERE project_id = $1`,
      [projectId],
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
  const statut = async (id: string): Promise<string | null> => {
    const r = await admin!.query<{ status: string }>(
      `SELECT status FROM projects WHERE id = $1`,
      [id],
    );
    return r.rows[0]?.status ?? null;
  };

  // --- #1 RBAC ---------------------------------------------------------------

  it('#1 RBAC — un ENGINEER (qui peut ARCHIVER) ne peut PAS supprimer définitivement → 403', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const t = await login(mailEng());

    const res = await supprimerDefinitivement(t, orgA, projRbac);
    expect(res.status).toBe(403);
    // Contre-preuve : le 403 ne masque aucune écriture.
    expect(await nbProjets(projRbac)).toBe(1);

    // Le MÊME ENGINEER peut bien archiver : c'est la destruction qui est réservée.
    const archive = await request(server())
      .delete(`/projects/${projRbac}`)
      .set(auth(t, orgA));
    expect(archive.status).toBe(200);
    expect(await statut(projRbac)).toBe('ARCHIVED');
  });

  // --- #2 ISOLATION ----------------------------------------------------------

  it('#2 ISOLATION — orgB supprime définitivement un projet d’orgA → 404, ET la ligne d’orgA EXISTE toujours', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const tB = await login(mailB());

    const res = await supprimerDefinitivement(tB, orgB, projIso);
    expect(res.status).toBe(404);
    // CONTRE-PREUVE : sans elle, un 404 pourrait masquer une destruction réussie.
    expect(await nbProjets(projIso)).toBe(1);
    expect(await statut(projIso)).toBe('ACTIVE');
  });

  // --- #3 REFUS 409 sur PV scellé --------------------------------------------

  it('#3 409 — un projet portant un PV SCELLÉ n’est jamais détruit (on n’orpheline pas un livrable scellé)', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const t = await login(mailOwner());

    const res = await supprimerDefinitivement(t, orgA, projPv);
    expect(res.status).toBe(409);
    // Message EXPLOITABLE par l'interface : l'utilisateur doit comprendre qu'il
    // faut archiver à la place, pas se heurter à une erreur opaque.
    const message = ((res.body as ErreurBody).message ?? '').toLowerCase();
    expect(message).toContain('scell');
    expect(message).toContain('archiv');

    // Contre-preuve : projet ET PV intacts.
    expect(await nbProjets(projPv)).toBe(1);
    expect(await nbPvs(projPv)).toBe(1);
  });

  // --- #4 SUPPRESSION RÉELLE + #5 LEDGER APPEND-ONLY -------------------------

  it('#4/#5 SUPPRESSION RÉELLE — projet + calc_results + calc_snapshots détruits, ledger de facturation INTACT', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const t = await login(mailOwner());

    // Un calcul RÉEL (donc une consommation de quota réelle) et sa capture.
    const calc = await request(server())
      .post(`/projects/${projPlein}/calc/burmister`)
      .set(auth(t, orgA))
      .send(burmisterInput);
    expect(calc.status).toBeLessThan(300);
    const calcId = String((calc.body as CalcBody).calcResultId);

    const snap = await request(server())
      .post(`/projects/${projPlein}/calc-results/${calcId}/snapshot`)
      .set(auth(t, orgA))
      .send({ displayHtml: DISPLAY_HTML, printHtml: PRINT_HTML });
    expect(snap.status).toBeLessThan(300);

    expect(await nbCalcs(projPlein)).toBe(1);
    expect(await nbSnapshots(calcId)).toBe(1);
    const ledgerAvant = await nbLedger();
    const consoAvant = await consommation();
    expect(ledgerAvant).toBeGreaterThan(0);

    const res = await supprimerDefinitivement(t, orgA, projPlein);
    expect(res.status).toBe(200);

    // DESTRUCTION RÉELLE — et pas un archivage déguisé : ZÉRO ligne, pas un
    // status ARCHIVED (c'est ce que prouve nbProjets, pas un simple GET 404).
    expect(await nbProjets(projPlein)).toBe(0);
    expect(await nbCalcs(projPlein)).toBe(0);
    expect(await nbSnapshots(calcId)).toBe(0);

    // LEDGER APPEND-ONLY : le quota déjà consommé RESTE consommé. On ne réécrit
    // jamais un registre de facturation, même quand l'objet calculé disparaît.
    expect(await nbLedger()).toBe(ledgerAvant);
    expect(await consommation()).toBe(consoAvant);
  });

  // --- #6 DEPUIS LA CORBEILLE ------------------------------------------------

  it('#6 CORBEILLE — un ADMIN supprime définitivement un projet ARCHIVÉ (vider la corbeille)', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const t = await login(mailAdmin());

    expect(await nbProjets(projArchive)).toBe(1);
    const res = await supprimerDefinitivement(t, orgA, projArchive);
    expect(res.status).toBe(200);
    expect(await nbProjets(projArchive)).toBe(0);
  });

  // --- #7 IDEMPOTENCE NÉGATIVE -----------------------------------------------

  it('#7 404 — re-supprimer un projet déjà détruit, ou viser un id inexistant → 404', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const t = await login(mailOwner());

    const bis = await supprimerDefinitivement(t, orgA, projPlein);
    expect(bis.status).toBe(404);

    const inexistant = await supprimerDefinitivement(t, orgA, randomUUID());
    expect(inexistant.status).toBe(404);
    // Anti-énumération : « déjà détruit » et « n'a jamais existé » sont
    // indiscernables.
    expect((bis.body as ErreurBody).message).toBe(
      (inexistant.body as ErreurBody).message,
    );
  });

  // --- #8 ORDRE DES ROUTES ---------------------------------------------------

  it('#8 ORDRE DES ROUTES — le segment id de /:id/permanent est bien validé (id non-uuid → 400)', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const t = await login(mailOwner());
    // Si `permanent` était capté comme un :projectId (route mal ordonnée), cet
    // appel ne toucherait pas la bonne route et ne rendrait pas 400 sur l'id.
    const res = await supprimerDefinitivement(t, orgA, 'pas-un-uuid');
    expect(res.status).toBe(400);
  });
});
