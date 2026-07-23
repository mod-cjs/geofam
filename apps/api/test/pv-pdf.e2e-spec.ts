/**
 * Test e2e du PDF du PV — surface tenant (#63, incr. C) — contre la VRAIE base.
 *
 * Prouve, via HTTP (supertest) sur l'app NestJS reelle + une connexion superuser
 * pour seed/teardown :
 *   1) GET /pvs/:id/pdf -> 200, Content-Type application/pdf, Content-Disposition
 *      attachment; filename=<numero>.pdf, signature %PDF en tete, taille > 0.
 *   2) CONTENU : le document rendu CONTIENT les donnees scellees clés (numero de
 *      PV, empreinte SHA-256, >= 1 resultat) — verifie via collectPvPdfText sur le
 *      PV reellement persiste (lu en base).
 *   3) REGENERABILITE : deux generations du MEME PV -> octets identiques.
 *   4) ISOLATION : le PDF d'un PV d'un AUTRE org -> 404.
 *   5) ROLES : VIEWER (role tenant) PEUT telecharger le PDF (lecture) ; un user
 *      hors-org -> 403/404.
 *   6) AUCUNE fuite « science_status / unsigned » dans le rendu.
 *
 * ANTI-SKIP : DATABASE_URL absent ET CI -> echec dur. Hors CI sans base ->
 * non-execute (honnete), interdit en CI.
 */
import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { OfficialPv } from '@prisma/client';
import { BURMISTER_FIXTURES, LABO_FIXTURES } from '@roadsen/engines';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { hashPassword } from '../src/auth/password';
import { buildPvDocDefinition, collectPvPdfText } from '../src/pv/pdf/pv-pdf';

type PgClient = {
  connect: () => Promise<void>;
  query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
  end: () => Promise<void>;
};
type PgClientCtor = new (cfg: { connectionString: string }) => PgClient;

interface CalcBody {
  calcResultId?: unknown;
}
interface PvBody {
  id?: unknown;
  pvNumber?: unknown;
  contentHash?: unknown;
}

const ADMIN_URL = process.env.DATABASE_URL ?? '';
const ENFORCE = process.env.CI === 'true' || ADMIN_URL.length > 0;

function loadPgClient(): PgClientCtor {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('pg') as { Client: PgClientCtor };
  return mod.Client;
}

describe('PDF du PV — surface tenant (e2e)', () => {
  let app: INestApplication | null = null;
  let admin: PgClient | null = null;
  let connectError: Error | null = null;

  const orgA = randomUUID();
  const orgB = randomUUID();
  const slugA = `org-a-${orgA.slice(0, 8)}`;
  const engineerA = randomUUID();
  const viewerA = randomUUID();
  const userB = randomUUID();
  const projectA = randomUUID();
  const projectB = randomUUID();
  const PASSWORD = 'Sup3r-Secret!';
  const burmisterInput = BURMISTER_FIXTURES[0].input;
  // Profil labo RICHE (~131 champs : granulo + Atterberg + Proctor + CBR…) ->
  // le tableau d'entrées DÉBORDE sur plusieurs pages (gabarit générique).
  const laboInput = LABO_FIXTURES[0].input;

  jest.setTimeout(60_000);

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
        ($1,$2,$7,'Eng A',now()), ($3,$4,$7,'View A',now()), ($5,$6,$7,'User B',now())`,
      [
        engineerA,
        `eng-${engineerA.slice(0, 8)}@roadsen.test`,
        viewerA,
        `view-${viewerA.slice(0, 8)}@roadsen.test`,
        userB,
        `b-${userB.slice(0, 8)}@roadsen.test`,
        hash,
      ],
    );
    await admin.query(
      `INSERT INTO organizations (id, name, slug, "updatedAt") VALUES ($1,'Org A',$2,now()), ($3,'Org B',$4,now())`,
      [orgA, slugA, orgB, `org-b-${orgB.slice(0, 8)}`],
    );
    await admin.query(
      `INSERT INTO memberships (id, org_id, user_id, role) VALUES
        ($1,$2,$3,'ENGINEER'), ($4,$5,$6,'VIEWER'), ($7,$8,$9,'OWNER')`,
      [
        randomUUID(),
        orgA,
        engineerA,
        randomUUID(),
        orgA,
        viewerA,
        randomUUID(),
        orgB,
        userB,
      ],
    );
    await admin.query(
      `INSERT INTO projects (id, org_id, name, created_by_id, updated_at) VALUES ($1,$2,'P-A',$3,now()), ($4,$5,'P-B',$6,now())`,
      [projectA, orgA, engineerA, projectB, orgB, userB],
    );
    // Abonnements (enforcement ADR 0011 : org sans souscription = 403 NoSubscription,
    // meme pour un ENGINEER legitime). La suite teste le PDF du PV, pas l'enforcement
    // d'abonnement : quota large + entitlements des moteurs employes ('burmister' pour
    // le cas nominal, 'labo' pour le PV multi-pages du test #7). Les deux orgs sont
    // dotees pour rester coherent avec le pattern pv-emission.
    await admin.query(
      `INSERT INTO subscriptions
         (id, org_id, pack, entitlements, date_debut, date_fin, quota, consommation, created_at, updated_at)
       VALUES
         ($1,$2,'ROUTES', ARRAY['burmister','labo'], now() - interval '1 day', now() + interval '365 days', 1000, 0, now(), now()),
         ($3,$4,'ROUTES', ARRAY['burmister','labo'], now() - interval '1 day', now() + interval '365 days', 1000, 0, now(), now())`,
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
          // try/finally : un echec de DELETE ne doit JAMAIS laisser la base de
          // recette avec son trigger d'integrite desactive.
          await admin.query(`ALTER TABLE official_pvs ENABLE TRIGGER USER`);
        }
        await admin.query(`DELETE FROM pv_counters WHERE org_id IN ($1,$2)`, [
          orgA,
          orgB,
        ]);
        await admin.query(`DELETE FROM calc_results WHERE org_id IN ($1,$2)`, [
          orgA,
          orgB,
        ]);
        // usage_ledger est APPEND-ONLY (trigger) : un calcul reussi y a decompte
        // le quota. On desactive le trigger le temps du nettoyage, sinon le DELETE
        // des subscriptions (cascade) est refuse.
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
          userB,
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
  const emailEng = () => `eng-${engineerA.slice(0, 8)}@roadsen.test`;
  const emailView = () => `view-${viewerA.slice(0, 8)}@roadsen.test`;
  const emailB = () => `b-${userB.slice(0, 8)}@roadsen.test`;

  // Emet un PV dans orgA pour un moteur/entree donnes (defaut burmister).
  async function emitPvInA(
    engine = 'burmister',
    input: unknown = burmisterInput,
  ): Promise<{ pvId: string; pvNumber: string }> {
    const token = await login(emailEng());
    const calc = await request(server())
      .post(`/projects/${projectA}/calc/${engine}`)
      .set('authorization', `Bearer ${token}`)
      .set('x-org-id', orgA)
      .send(input as object);
    expect(calc.status).toBe(201);
    const calcId = String((calc.body as CalcBody).calcResultId);
    const emit = await request(server())
      .post(`/projects/${projectA}/calc-results/${calcId}/pv`)
      .set('authorization', `Bearer ${token}`)
      .set('x-org-id', orgA);
    expect(emit.status).toBe(201);
    const pv = emit.body as PvBody;
    return { pvId: String(pv.id), pvNumber: String(pv.pvNumber) };
  }

  // Telecharge un PDF (en Buffer) via l'endpoint authentifie+tenant.
  function downloadPdf(token: string, pvId: string) {
    return request(server())
      .get(`/projects/${projectA}/pvs/${pvId}/pdf`)
      .set('authorization', `Bearer ${token}`)
      .set('x-org-id', orgA)
      .buffer(true)
      .parse((r, cb) => {
        const data: Buffer[] = [];
        r.on('data', (c: Buffer) => data.push(c));
        r.on('end', () => cb(null, Buffer.concat(data)));
      });
  }

  // Nombre de pages AUTORITAIRE depuis l'arbre /Pages du PDF (/Count N).
  function pdfPageCount(buf: Buffer): number {
    const s = buf.toString('latin1');
    const m =
      /\/Type\s*\/Pages[\s\S]{0,400}?\/Count\s+(\d+)/.exec(s) ??
      /\/Count\s+(\d+)/.exec(s);
    return m ? Number(m[1]) : 0;
  }

  it('1) GET pvs/:id/pdf -> 200, application/pdf, attachment, %PDF, taille>0', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const token = await login(emailEng());
    const { pvId, pvNumber } = await emitPvInA();
    const res = await request(server())
      .get(`/projects/${projectA}/pvs/${pvId}/pdf`)
      .set('authorization', `Bearer ${token}`)
      .set('x-org-id', orgA)
      .buffer(true)
      .parse((r, cb) => {
        const data: Buffer[] = [];
        r.on('data', (c: Buffer) => data.push(c));
        r.on('end', () => cb(null, Buffer.concat(data)));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    expect(res.headers['content-disposition']).toContain(
      `filename="${pvNumber}.pdf"`,
    );
    const body = res.body as Buffer;
    expect(body.length).toBeGreaterThan(0);
    expect(body.slice(0, 5).toString()).toBe('%PDF-');
  });

  it('2) CONTENU : le rendu contient numero de PV, hash SHA-256 et >= 1 resultat', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const { pvId } = await emitPvInA();
    // On lit le PV REELLEMENT persiste (superuser) et on verifie le texte rendu.
    const rows = await admin!.query(
      `SELECT * FROM official_pvs WHERE id = $1`,
      [pvId],
    );
    const pv = camelizePv(rows.rows[0] as Record<string, unknown>);
    const text = collectPvPdfText(pv);
    expect(text).toContain(pv.pvNumber);
    expect(text).toContain(pv.contentHash); // empreinte SHA-256 (64 hex)
    // >= 1 resultat : burmister produit au moins une grandeur de sortie.
    expect(text).toContain('Résultats'.toUpperCase());
    const outputKeys = Object.keys(pv.output as Record<string, unknown>);
    expect(outputKeys.length).toBeGreaterThan(0);
    // au moins une cle/valeur de sortie apparait dans le rendu.
    const someKey = outputKeys[0];
    expect(text.includes(someKey)).toBe(true);
  });

  it('3) REGENERABILITE : deux generations du meme PV -> octets identiques', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const token = await login(emailEng());
    const { pvId } = await emitPvInA();
    const dl = () =>
      request(server())
        .get(`/projects/${projectA}/pvs/${pvId}/pdf`)
        .set('authorization', `Bearer ${token}`)
        .set('x-org-id', orgA)
        .buffer(true)
        .parse((r, cb) => {
          const data: Buffer[] = [];
          r.on('data', (c: Buffer) => data.push(c));
          r.on('end', () => cb(null, Buffer.concat(data)));
        });
    const a = await dl();
    const b = await dl();
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(Buffer.compare(a.body as Buffer, b.body as Buffer)).toBe(0);
  });

  it('4) ISOLATION : PDF d un PV via un autre org -> 404', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const { pvId } = await emitPvInA();
    const tokenB = await login(emailB());
    const res = await request(server())
      .get(`/projects/${projectB}/pvs/${pvId}/pdf`)
      .set('authorization', `Bearer ${tokenB}`)
      .set('x-org-id', orgB);
    expect(res.status).toBe(404);
  });

  it('5) ROLES : VIEWER peut telecharger le PDF (lecture)', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const { pvId } = await emitPvInA();
    const tokenView = await login(emailView());
    const res = await request(server())
      .get(`/projects/${projectA}/pvs/${pvId}/pdf`)
      .set('authorization', `Bearer ${tokenView}`)
      .set('x-org-id', orgA)
      .buffer(true)
      .parse((r, cb) => {
        const data: Buffer[] = [];
        r.on('data', (c: Buffer) => data.push(c));
        r.on('end', () => cb(null, Buffer.concat(data)));
      });
    expect(res.status).toBe(200);
    expect((res.body as Buffer).slice(0, 5).toString()).toBe('%PDF-');
  });

  it('6) AUCUNE fuite science_status / unsigned dans le rendu', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const { pvId } = await emitPvInA();
    const rows = await admin!.query(
      `SELECT * FROM official_pvs WHERE id = $1`,
      [pvId],
    );
    const pv = camelizePv(rows.rows[0] as Record<string, unknown>);
    const text = collectPvPdfText(pv).toLowerCase();
    expect(text.includes('unsigned')).toBe(false);
    expect(text.includes('science')).toBe(false);
    expect(text.includes('@science')).toBe(false);
  });

  // --- 7) RENDU LABO DÉDIÉ (FASTLAB) : gabarit métier riche, multi-pages -------
  //
  //  RE-SCOPE décidé le 14/07 : le PV labo n'utilise PLUS le gabarit GÉNÉRIQUE
  //  (vidage input/output « Données d'entrée » / « Résultats ») mais un gabarit
  //  MÉTIER DÉDIÉ (buildLaboBody) — classification GTR + table d'identification
  //  COMPLÈTE — conforme à la décision produit du 02/07 avec STARFIRE (afficher
  //  TOUS les diagnostics OutputSchema en EXCLUANT les paramètres de méthode ; PV
  //  labo complété ; démo PV-000020), pas une régression. La complétude d'affichage
  //  fait légitimement DÉBORDER ce profil riche sur PLUSIEURS pages : la propriété
  //  multi-pages RESTE prouvée ici (Y>1), avec les sections MÉTIER attendues et non
  //  les titres génériques. La correction du test #7 d'origine ne portait donc que
  //  sur les LIBELLÉS de section (métier, plus génériques) ; le débordement était
  //  déjà réel. La couverture du FALLBACK générique multi-pages (aucun moteur réel
  //  ne l'atteint plus) est en plus assurée au niveau unitaire
  //  (src/pv/pdf/pv-pdf.multipage.spec.ts).
  it('7) RENDU LABO : gabarit métier dédié, complet, débordant sur plusieurs pages', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const token = await login(emailEng());
    const { pvId, pvNumber } = await emitPvInA('labo', laboInput);

    const res = await downloadPdf(token, pvId);
    expect(res.status).toBe(200);
    const buf = res.body as Buffer;
    expect(buf.slice(0, 5).toString()).toBe('%PDF-');
    // DÉBORDEMENT prouvé sur les OCTETS RÉELS : strictement plus d'une page.
    // (NB : la « page 1 / 1 » vue via collectPvPdfText est un ARTEFACT — le footer
    //  y est évalué en dur sur (1,1) ; seul pdfPageCount lit le vrai nombre.)
    const pages = pdfPageCount(buf);
    expect(pages).toBeGreaterThan(1);

    // Contenu rendu (via la docDefinition = ce que voit le lecteur) : on relit le
    // PV persisté et on vérifie numéro / hash / sections métier.
    const rows = await admin!.query(
      `SELECT * FROM official_pvs WHERE id = $1`,
      [pvId],
    );
    const pv = camelizePv(rows.rows[0] as Record<string, unknown>);
    const text = collectPvPdfText(pv);
    expect(pv.pvNumber).toBe(pvNumber);
    expect(text).toContain(pv.pvNumber); // en-tête répété (toutes pages)
    expect(text).toContain(pv.contentHash); // bloc scellement présent
    expect(text).toContain('SCELLEMENT');
    // Gabarit MÉTIER dédié (buildLaboBody = fac-similé du procès-verbal
    // multi-fiches de FASTLAB, décision titulaire 18/07), PAS le gabarit générique.
    // NB : collectPvPdfText ne collecte PAS les titres de section (style `section`) ;
    // on assert donc sur du CONTENU collectable toujours rendu (en-tête + visa).
    expect(text).toContain('procès-verbal d’essais'); // en-tête du PV d'essai natif
    expect(text).toContain('L’ingénieur chargé de l’étude'); // bloc visa (toujours rendu)
    // Le gabarit générique (vidage) n'est PAS utilisé pour labo.
    expect(text).not.toContain('DONNÉES D’ENTRÉE'.toUpperCase());
    // Table d'identification présente : en-tête de colonne « Paramètre ».
    const paramHeaderCount = (text.match(/Paramètre/g) ?? []).length;
    expect(paramHeaderCount).toBeGreaterThanOrEqual(1);
    // ZÉRO fuite de science : aucun paramètre de méthode / marqueur interne.
    expect(text.toLowerCase()).not.toContain('unsigned');
    expect(text.toLowerCase()).not.toContain('science');

    // Le bloc SCELLEMENT (unbreakable) n'apparaît qu'UNE fois (jamais dupliqué).
    expect((text.match(/SCELLEMENT/g) ?? []).length).toBe(1);

    // STRUCTURE déterministe (ce que pdfmake applique RÉELLEMENT par page) :
    //  - headerRows:1 sur la table d'identification -> en-tête répété à chaque page ;
    //  - le bloc scellement porte unbreakable:true -> jamais coupé ;
    //  - le footer émet « page X / Y » ; on l'évalue sur la DERNIÈRE page avec
    //    Y = pages réelles (>1) -> « page N / N ».
    const def = buildPvDocDefinition(pv);
    const inputTable = findFirstTableWithHeader(def.content);
    expect(inputTable?.table.headerRows).toBe(1);
    expect(hasUnbreakableSeal(def.content)).toBe(true);
    const footer = renderFooterText(def, pages, pages);
    expect(footer).toContain(`page ${pages} / ${pages}`);
    expect(footer).toContain(pv.pvNumber); // numéro répété en pied, toutes pages
  });

  // --- 8) PREUVE SUR LES OCTETS RÉELS (CRIT-2) --------------------------------
  //
  //  collectPvPdfText parcourt la docDefinition, PAS les octets produits : rien ne
  //  garantit que ce texte est dans le PDF reçu par le lecteur. Ici on EXTRAIT le
  //  texte des OCTETS RÉELS (pdf-parse) et on vérifie numéro de PV + empreinte
  //  SHA-256 (64 hex) présents -> ferme la boucle docDefinition → octets.
  it('8) OCTETS RÉELS : le texte extrait du PDF contient numéro + hash SHA-256', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const token = await login(emailEng());
    const { pvId, pvNumber } = await emitPvInA();
    const res = await downloadPdf(token, pvId);
    expect(res.status).toBe(200);
    const text = await extractPdfText(res.body as Buffer);
    // Numéro de PV présent dans les octets (sans espaces : run sans letterSpacing).
    expect(text).toContain(pvNumber);
    // Empreinte SHA-256 (64 hex en Courier) présente dans les octets.
    expect(/[0-9a-f]{64}/.test(text)).toBe(true);
    // #71 — la PRÉSENTATION MÉTIER atteint bien les OCTETS RÉELS : verdict
    // (CONFORME/NON CONFORME), unité µdef, libellé lisible « Famille de structure ».
    expect(/CONFORME|NON CONFORME/.test(text)).toBe(true);
    expect(text.includes('Famille de structure')).toBe(true);
    // Unité µdef présente. NB : pdf-parse normalise le micro-signe U+00B5 (µ) en
    // mu grec U+03BC (μ) à l'extraction — le glyphe rendu est identique ; on tolère
    // les deux points de code (artefact d'extraction, pas un défaut de rendu).
    expect(/[µμ]def/.test(text)).toBe(true);
    // clés internes brutes ABSENTES des octets (plus de vidage de dictionnaire).
    expect(text.includes('epaisseurTotale')).toBe(false);
    expect(text.includes('layers[')).toBe(false);
    // FAIL-CLOSED (B-1/M-1) sur les OCTETS RÉELS : la clé moteur `projet`
    // (redondante, désormais masquée) NE FUITE PLUS — l'ancien rendu auto
    // « Autres paramètres » affichait sa valeur « Structure de reference ROADSENS ».
    expect(text.includes('Structure de reference')).toBe(false);
    expect(text.toUpperCase().includes('AUTRES PARAM')).toBe(false);
    // #71-titulaire : l'ÉMETTEUR SCELLÉ (full_name « Eng A ») ET l'ORGANISATION
    // SCELLÉE (« Org A ») sont rendus (provenance) ; le VISA « Établi et scellé
    // par : <ingénieur> — <org> » est présent dans les OCTETS RÉELS.
    expect(text.includes('Eng A')).toBe(true);
    expect(text.includes('Org A')).toBe(true);
    expect(text.includes('Établi et scellé par')).toBe(true);
    // « Réf. <uuid projet> » ne fuite plus.
    expect(text.includes('Réf. ')).toBe(false);
  });

  // --- 9) ANTI-FUITE SCIENCE + WORDING HONNÊTE SUR LES OCTETS -----------------
  it('9) OCTETS RÉELS : pas de fuite science ; note d’intégrité présente ; termes juridiques bannis', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const token = await login(emailEng());
    const { pvId } = await emitPvInA();
    const res = await downloadPdf(token, pvId);
    const raw = await extractPdfText(res.body as Buffer);
    const text = raw.toLowerCase();
    // anti-fuite science.
    expect(text.includes('unsigned')).toBe(false);
    expect(text.includes('science')).toBe(false);
    expect(text.includes('@science')).toBe(false);
    // WORDING HONNÊTE (validé fiscal-juridique) sur les OCTETS RÉELS : note de
    // portée présente, termes à valeur probatoire BANNIS.
    expect(raw.includes('Ne vaut pas signature électronique qualifiée')).toBe(
      true,
    );
    expect(raw.includes('ingénieur signataire')).toBe(true);
    for (const banned of [
      'fait foi',
      'valeur probante',
      'certifié',
      'opposable',
      'authentifié',
    ]) {
      expect(text.includes(banned)).toBe(false);
    }
  });

  // --- 10) FAIL-CLOSED HTTP (CRIT-1) : sceau invalide -> 409, pas de PDF -------
  it('10) FAIL-CLOSED : input_canonical altéré en base -> PDF refusé (409)', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const token = await login(emailEng());
    const { pvId } = await emitPvInA();
    // Avant : le PDF se génère (sceau valide).
    const ok = await downloadPdf(token, pvId);
    expect(ok.status).toBe(200);

    // ALTÉRATION de input_canonical en base (trigger d'immuabilité désactivé le
    // temps de la falsification de test) -> le sceau ne vérifie plus.
    try {
      await admin!.query(`ALTER TABLE official_pvs DISABLE TRIGGER USER`);
      await admin!.query(
        `UPDATE official_pvs SET input_canonical = input_canonical || ' falsifie' WHERE id = $1`,
        [pvId],
      );
    } finally {
      // try/finally : si l'UPDATE echoue, le trigger d'immuabilite d'official_pvs
      // doit etre RETABLI quoi qu'il arrive — jamais de base de recette laissee
      // sans sa protection.
      await admin!.query(`ALTER TABLE official_pvs ENABLE TRIGGER USER`);
    }

    // Après : génération REFUSÉE (fail-closed) -> 409, aucun PDF.
    const refused = await downloadPdf(token, pvId);
    expect(refused.status).toBe(409);
  });
});

/** Extrait le texte des OCTETS RÉELS d'un PDF (pdf-parse v1, CJS — jest-friendly). */
async function extractPdfText(buf: Buffer): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfParse = require('pdf-parse') as (
    b: Buffer,
  ) => Promise<{ text: string }>;
  const { text } = await pdfParse(buf);
  return text;
}

/** Mappe une ligne SQL snake_case -> l'objet OfficialPv (camelCase) attendu par le rendu. */
function camelizePv(row: Record<string, unknown>): OfficialPv {
  return {
    id: row.id as string,
    orgId: row.org_id as string,
    calcResultId: row.calc_result_id as string,
    projectId: row.project_id as string,
    pvNumber: row.pv_number as string,
    userId: row.user_id as string,
    projectName: row.project_name as string,
    engineId: row.engine_id as string,
    engineVersion: row.engine_version as string,
    engineSourceHash: (row.engine_source_hash as string | null) ?? null,
    inputCanonical: row.input_canonical as string,
    output: row.output as OfficialPv['output'],
    scienceStatus: row.science_status as string,
    verdict: (row.verdict as string | undefined) ?? 'NON_APPLICABLE',
    contentHash: row.content_hash as string,
    hmac: row.hmac as string,
    sealedAt: row.sealed_at as Date,
    documentHtml: (row.document_html as string | null) ?? null,
    documentFormat: (row.document_format as string | null) ?? null,
    name: (row.name as string | null) ?? null,
  };
}

// --- Helpers structurels sur la docDefinition (preuves déterministes) -------

interface TableNode {
  table: { headerRows?: number; body?: unknown };
}

/** Trouve le 1er noeud avec un tableau à headerRows (le tableau d'entrée). */
function findFirstTableWithHeader(content: unknown): TableNode | undefined {
  let found: TableNode | undefined;
  const walk = (n: unknown): void => {
    if (found || n == null) return;
    if (Array.isArray(n)) {
      n.forEach(walk);
      return;
    }
    if (typeof n === 'object') {
      const o = n as Record<string, unknown>;
      if (
        o.table &&
        typeof o.table === 'object' &&
        typeof (o.table as { headerRows?: unknown }).headerRows === 'number'
      ) {
        found = n as TableNode;
        return;
      }
      Object.values(o).forEach(walk);
    }
  };
  walk(content);
  return found;
}

/** Vrai si un noeud du contenu porte `unbreakable: true` (bloc scellement). */
function hasUnbreakableSeal(content: unknown): boolean {
  let ok = false;
  const walk = (n: unknown): void => {
    if (ok || n == null) return;
    if (Array.isArray(n)) {
      n.forEach(walk);
      return;
    }
    if (typeof n === 'object') {
      const o = n as Record<string, unknown>;
      if (o.unbreakable === true) {
        ok = true;
        return;
      }
      Object.values(o).forEach(walk);
    }
  };
  walk(content);
  return ok;
}

/** Évalue le footer (DynamicContent) sur (page, pageCount) et collecte son texte. */
function renderFooterText(
  def: ReturnType<typeof buildPvDocDefinition>,
  page: number,
  pageCount: number,
): string {
  if (typeof def.footer !== 'function') return '';
  const node = def.footer(page, pageCount, {
    width: 595,
    height: 842,
    orientation: 'portrait',
  });
  const out: string[] = [];
  const walk = (n: unknown): void => {
    if (n == null) return;
    if (typeof n === 'string') {
      out.push(n);
      return;
    }
    if (Array.isArray(n)) {
      n.forEach(walk);
      return;
    }
    if (typeof n === 'object') {
      const o = n as Record<string, unknown>;
      if (typeof o.text === 'string') out.push(o.text);
      else if (o.text != null) walk(o.text);
      if (o.columns) walk(o.columns);
      if (o.stack) walk(o.stack);
    }
  };
  walk(node);
  return out.join(' ');
}
