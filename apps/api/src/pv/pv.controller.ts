import { Body, Controller, Get, Param, Post, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CalcResult } from '@prisma/client';
import type { Response } from 'express';
import { z } from 'zod';

import { Roles } from '../auth/decorators';
import type { AuthedRequest } from '../auth/request-context';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { Consumes, RequiresEntitlement } from '../subscriptions/decorators';

import { CalcResultsService } from './calc-results.service';
import type { PersistedCalcResult } from './calc-results.service';
import { CalcSnapshotsService } from './calc-snapshots.service';
import { MAX_HTML_BYTES } from './html-guard';
import type { OfficialPvView, SealedPvRow } from './pv.service';
import { PvService } from './pv.service';

// UUID des parametres de chemin (defense en profondeur : un id malforme -> 400,
// jamais une requete base avec une valeur non-uuid).
const uuidParam = z.string().uuid();

// Corps de capture du document client (option-3). Deux HTML NON VIDES ; la garde
// §8 (inertie + confidentialite + taille EXACTE en octets) est appliquee cote
// service. La borne Zod est alignee sur la limite de la garde (MAX_HTML_BYTES,
// 1 MiB) pour rejeter TOT : .max() compte les unites UTF-16 (<= octets UTF-8),
// donc au-dela de MAX_HTML_BYTES caracteres on depasse forcement la limite octets.
const snapshotBody = z.object({
  displayHtml: z.string().min(1).max(MAX_HTML_BYTES),
  printHtml: z.string().min(1).max(MAX_HTML_BYTES),
});
type SnapshotBody = z.infer<typeof snapshotBody>;

/**
 * PvController — surface TENANT du pipeline PV (#63, incr. B).
 *
 * TOUTES les routes sont authentifiees + tenant (chaine de gardes globale :
 * JwtAuthGuard -> TenantGuard -> RolesGuard, cf. AppModule). AUCUN @Public ni
 * @NoTenant : un token verifie ET une appartenance a l'org (x-org-id) sont
 * exiges. La surface RECETTE (`/calc/*`, @Public derriere X-Recette-Key) reste
 * INCHANGEE et distincte (decision titulaire : deux surfaces separees).
 *
 * RBAC :
 *  - calcul persistant : OWNER/ADMIN/ENGINEER/TECHNICIAN (un technicien-sondeur
 *    saisit/lance des calculs) ;
 *  - emission de PV     : OWNER/ADMIN/ENGINEER (acte d'ingenierie ; un TECHNICIAN
 *    ne scelle pas un PV officiel) ;
 *  - lecture            : tous les roles tenant (consultation).
 */
@ApiTags('pv')
@Controller('projects/:projectId')
export class PvController {
  constructor(
    private readonly calcResults: CalcResultsService,
    private readonly snapshots: CalcSnapshotsService,
    private readonly pv: PvService,
  ) {}

  /**
   * POST /projects/:projectId/calc/:engine — recalcul SERVEUR persistant.
   * Valide le corps contre le contrat du moteur (meme run<Engine> que la recette),
   * persiste un calc_result org-scope, renvoie l'enveloppe + calcResultId.
   */
  @Post('calc/:engine')
  @Roles('OWNER', 'ADMIN', 'ENGINEER', 'TECHNICIAN', 'SUPERADMIN')
  // Enforcement abonnement (ADR 0011) : le moteur (slug d'URL :engine) doit etre
  // dans le pack (sinon 403), l'abo non expire et le quota non epuise (sinon 402).
  // @Consumes('CALC') : un calcul REUSSI decremente le quota (decompte atomique
  // dans runAndPersist, pas ici). L'entitlement est compare au SLUG d'URL, qui est
  // aussi la cle des `modules` du contrat /me/entitlements (selecteur C-01 cote UI).
  @RequiresEntitlement({ param: 'engine' })
  @Consumes('CALC')
  @ApiOperation({
    summary:
      'Recalcul serveur PERSISTANT (surface tenant) : execute le moteur et stocke un calc_result org-scope.',
  })
  runCalc(
    @Param('projectId', new ZodValidationPipe(uuidParam)) projectId: string,
    @Param('engine') engine: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ): Promise<PersistedCalcResult> {
    return this.calcResults.runAndPersist({
      engineSlug: engine,
      projectId,
      userId: req.auth!.userId, // identite JWT verifiee (jamais une valeur cliente)
      body,
    });
  }

  /**
   * GET /projects/:projectId/calc-results — liste les calculs persistes du projet
   * (master de la vue master-detail). Lecture : tous les roles tenant.
   * Isolation : RLS scope au tenant ; un projet d'un autre org -> liste vide
   * (tenant-safe). Preuve d'isolation reelle aux e2e (qa-test).
   */
  @Get('calc-results')
  @Roles('OWNER', 'ADMIN', 'ENGINEER', 'TECHNICIAN', 'VIEWER', 'SUPERADMIN')
  @ApiOperation({
    summary: 'Liste les calc_results (calculs persistes) d un projet.',
  })
  listCalcResults(
    @Param('projectId', new ZodValidationPipe(uuidParam)) projectId: string,
  ): Promise<CalcResult[]> {
    return this.calcResults.listForProject(projectId);
  }

  /**
   * GET /projects/:projectId/calc-results/:calcId — detail d'un calcul persiste
   * (detail de la vue master-detail). Lecture : tous les roles tenant.
   * Isolation : 404 tenant-safe si le calcul appartient a un autre org OU a un
   * autre projet du meme org (cf. CalcResultsService.getForProject). La sortie
   * persistee est DEJA projetee (whitelist @roadsen/shared a l'ecriture) : aucun
   * intermediaire de calcul ne fuit (DoD §8).
   */
  @Get('calc-results/:calcId')
  @Roles('OWNER', 'ADMIN', 'ENGINEER', 'TECHNICIAN', 'VIEWER', 'SUPERADMIN')
  @ApiOperation({
    summary: 'Lit un calc_result (calcul persiste) d un projet.',
  })
  getCalcResult(
    @Param('projectId', new ZodValidationPipe(uuidParam)) projectId: string,
    @Param('calcId', new ZodValidationPipe(uuidParam)) calcId: string,
  ): Promise<CalcResult> {
    return this.calcResults.getForProject({
      projectId,
      calcResultId: calcId,
    });
  }

  /**
   * POST /projects/:projectId/calc-results/:calcResultId/snapshot — capture du
   * DOCUMENT que l'outil client produit A L'IMPRESSION (scellement option-3).
   *
   * Corps { displayHtml, printHtml }. UPSERT par calc_result_id (le calcul est
   * immuable -> la capture est deterministe : une re-capture ecrase). GARDE §8
   * fail-closed cote service (assertInertHtml) : un HTML executable / porteur d'un
   * marqueur moteur / hors taille -> 400. Isolation : 404 si le calcul n'est pas
   * dans ce projet/ce tenant. RBAC = celui du calcul (roles qui saisissent/lancent).
   */
  @Post('calc-results/:calcResultId/snapshot')
  @Roles('OWNER', 'ADMIN', 'ENGINEER', 'TECHNICIAN', 'SUPERADMIN')
  @ApiOperation({
    summary:
      'Capture le document client (HTML affichage + impression) d un calc_result. UPSERT + garde §8.',
  })
  async captureSnapshot(
    @Param('projectId', new ZodValidationPipe(uuidParam)) projectId: string,
    @Param('calcResultId', new ZodValidationPipe(uuidParam))
    calcResultId: string,
    @Body(new ZodValidationPipe(snapshotBody)) body: SnapshotBody,
  ): Promise<{ ok: true }> {
    await this.snapshots.capture({
      projectId,
      calcResultId,
      displayHtml: body.displayHtml,
      printHtml: body.printHtml,
    });
    return { ok: true };
  }

  /**
   * GET /projects/:projectId/calc-results/:calcResultId/snapshot — relit le
   * document capture d'un calcul AVANT scellement (re-affichage / re-impression
   * cote UI). Meme isolation/RBAC que la capture. 404 tenant-safe si le calcul
   * n'est pas dans ce projet/ce tenant OU si aucune capture n'existe (l'UI
   * retombe sur son panneau de metadonnees).
   */
  @Get('calc-results/:calcResultId/snapshot')
  // Memes roles que la capture (POST snapshot) : consigne coordinateur.
  @Roles('OWNER', 'ADMIN', 'ENGINEER', 'TECHNICIAN', 'SUPERADMIN')
  @ApiOperation({
    summary:
      'Relit le document client (HTML affichage + impression) capturé d un calc_result.',
  })
  getSnapshot(
    @Param('projectId', new ZodValidationPipe(uuidParam)) projectId: string,
    @Param('calcResultId', new ZodValidationPipe(uuidParam))
    calcResultId: string,
  ): Promise<{ displayHtml: string; printHtml: string }> {
    return this.snapshots.readForCalc({ projectId, calcResultId });
  }

  /**
   * POST /projects/:projectId/calc-results/:id/pv — emission du PV officiel.
   * Idempotent : re-emettre le meme calcul renvoie le PV existant (pas de
   * nouveau numero).
   */
  @Post('calc-results/:id/pv')
  @Roles('OWNER', 'ADMIN', 'ENGINEER', 'SUPERADMIN')
  // @Consumes('PV') : l'EMISSION REELLE d'un PV (1er scellement) decremente le
  // quota. ATTENTION DOUBLE-COMPTAGE (TM-8) : la re-emission idempotente NE
  // consomme PAS (le decompte est lie a l'INSERT effectif dans official_pvs, pas
  // au passage de la route) — cf. PvService.emitFromCalc. Pas de @RequiresEntitlement
  // ici : le moteur a deja ete entitle au calcul ; un PV ne re-verifie pas le module.
  @Consumes('PV')
  @ApiOperation({
    summary:
      'Emet (ou renvoie si deja emis) le PV officiel scelle d un calc_result. Idempotent.',
  })
  emitPv(
    @Param('projectId', new ZodValidationPipe(uuidParam)) projectId: string,
    @Param('id', new ZodValidationPipe(uuidParam)) calcResultId: string,
    @Req() req: AuthedRequest,
  ): Promise<SealedPvRow> {
    return this.pv.emitFromCalc({
      calcResultId,
      projectId,
      userId: req.auth!.userId,
    });
  }

  /**
   * GET /projects/:projectId/pvs/:pvId — lit un PV + verdict de sceau (sealValid),
   * recalcule en re-verifiant le sceau stocke contre input_canonical.
   */
  @Get('pvs/:pvId')
  @Roles('OWNER', 'ADMIN', 'ENGINEER', 'TECHNICIAN', 'VIEWER', 'SUPERADMIN')
  @ApiOperation({
    summary: 'Lit un PV officiel et son verdict d integrite (sealValid).',
  })
  getPv(
    @Param('projectId', new ZodValidationPipe(uuidParam)) projectId: string,
    @Param('pvId', new ZodValidationPipe(uuidParam)) pvId: string,
  ): Promise<OfficialPvView> {
    return this.pv.getViewById({ projectId, pvId });
  }

  /**
   * GET /projects/:projectId/pvs/:pvId/pdf — PDF du PV (design maison).
   * Même garde/isolation que GET pvs/:pvId (tous rôles tenant ; PV d'un autre org
   * -> 404). Renvoie application/pdf en pièce jointe nommée <numéro>.pdf.
   */
  @Get('pvs/:pvId/pdf')
  @Roles('OWNER', 'ADMIN', 'ENGINEER', 'TECHNICIAN', 'VIEWER', 'SUPERADMIN')
  @ApiOperation({ summary: 'Génère le PDF (procès-verbal) d un PV officiel.' })
  async getPvPdf(
    @Param('projectId', new ZodValidationPipe(uuidParam)) projectId: string,
    @Param('pvId', new ZodValidationPipe(uuidParam)) pvId: string,
    @Res() res: Response,
  ): Promise<void> {
    const { pv, pdf } = await this.pv.pdfForView({ projectId, pvId });
    // MIN-2 (défense en profondeur) : le numéro de PV est déjà borné par
    // construction (PV-RDS-{slug}-{YYYY}-{NNNNNN}), mais on REVALIDE le charset
    // avant interpolation dans Content-Disposition — ceinture+bretelles
    // anti-injection d'en-tête (CR/LF, guillemets…). Un numéro hors charset =
    // anomalie -> 500 borné plutôt qu'un en-tête fabriqué.
    if (!/^[A-Za-z0-9-]+$/.test(pv.pvNumber)) {
      throw new Error('Numéro de PV non conforme au charset attendu.');
    }
    const filename = `${pv.pvNumber}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', String(pdf.length));
    res.end(pdf);
  }

  /**
   * GET /projects/:projectId/pvs/:pvId/document — sert le DOCUMENT CLIENT SCELLE
   * (HTML d'impression fige dans l'official_pv IMMUABLE, re-affiche/imprime a
   * l'identique — scellement option-3). Meme garde/isolation que GET pvs/:pvId.
   * Re-verifie le sceau du PV ET sha256(document_html) == empreinte scellee (sinon
   * 409). PV sans document scelle -> 404 (l'appelant retombe sur le PDF pdfmake).
   *
   * INERTIE cote navigateur — barriere EFFECTIVE = la CSP HTTP posee ci-dessous
   * (`sandbox`, `default-src 'none'`) + `nosniff` : c'est ELLE qui neutralise
   * scripts/handlers au ré-affichage en-app. La garde §8 a la capture est un
   * complement BEST-EFFORT (defense en profondeur, pas une garantie : ce n'est pas
   * un tokenizer HTML complet). ANGLE MORT ASSUME : un document EXPORTE puis ouvert
   * en `file://` n'a plus de CSP HTTP -> l'inertie n'y est plus garantie par le
   * serveur (risque residuel reduit par la garde, non annule).
   */
  @Get('pvs/:pvId/document')
  @Roles('OWNER', 'ADMIN', 'ENGINEER', 'TECHNICIAN', 'VIEWER', 'SUPERADMIN')
  @ApiOperation({
    summary: 'Sert le document client scellé (HTML) d un PV officiel.',
  })
  async getPvDocument(
    @Param('projectId', new ZodValidationPipe(uuidParam)) projectId: string,
    @Param('pvId', new ZodValidationPipe(uuidParam)) pvId: string,
    @Res() res: Response,
  ): Promise<void> {
    const { printHtml } = await this.pv.documentForView({ projectId, pvId });
    // Content-Type text/html ; charset utf-8 pour le rendu FR (accents/‰/δ).
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // BARRIERE EFFECTIVE D'INERTIE (M1) — la CSP HTTP, independante de la garde §8 :
    // `sandbox` (sans allow-scripts) neutralise tout JS/handler cote navigateur ;
    // default-src 'none' coupe tout chargement ; img-src data: autorise les images
    // embarquees ; style-src 'unsafe-inline' laisse les styles inline (pas de JS).
    // NB : ne protege QUE le rendu servi par HTTP (pas un export ouvert en file://).
    res.setHeader(
      'Content-Security-Policy',
      "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'",
    );
    // nosniff : le navigateur ne re-devine pas le type (pas de MIME sniffing).
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(printHtml);
  }

  /** GET /projects/:projectId/pvs — liste les PV du projet (chacun avec sealValid). */
  @Get('pvs')
  @Roles('OWNER', 'ADMIN', 'ENGINEER', 'TECHNICIAN', 'VIEWER', 'SUPERADMIN')
  @ApiOperation({ summary: 'Liste les PV officiels d un projet.' })
  listPvs(
    @Param('projectId', new ZodValidationPipe(uuidParam)) projectId: string,
  ): Promise<OfficialPvView[]> {
    return this.pv.listForProject(projectId);
  }
}
