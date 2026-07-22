import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { OfficialPv } from '@prisma/client';
import { Prisma } from '@prisma/client';
import {
  canonicalize,
  projectEngineOutput,
  sealContentHash,
  sealHmac,
  verifySeal,
  type SealableValue,
} from '@roadsen/shared';

import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { requireOrgId } from '../tenant/tenant-context';

import { findEngineDispatchByRegistryId } from './engine-dispatch';
import { outputsEquivalent } from './output-equivalence';
import { renderPvPdf } from './pdf/pv-pdf';
import { assertProjetEcrivable } from './project-write-guard';
import {
  extractSealedIdentity,
  wrapSealedDocumentWithPvChrome,
} from './pv-document-chrome';
import { resolveVerdict } from './verdict';

/**
 * Ligne d'official_pv SANS les octets du document (B1-bis). Les reponses de
 * liste/lecture/emission NE renvoient JAMAIS document_html (jusqu'a 1 MiB/PV :
 * inutile en list/get, couteux sur reseau contraint). document_format ('html'|null)
 * EST conserve : le front en a besoin pour savoir si un document scelle existe
 * (banniere veridique). Seul documentForView charge document_html (source dediee).
 */
export type SealedPvRow = Omit<OfficialPv, 'documentHtml'>;

/** PV officiel (sans octets du document) + verdict de verification du sceau. */
export interface OfficialPvView {
  pv: SealedPvRow;
  sealValid: boolean;
}

/**
 * PvService — EMISSION + LECTURE/VERIFICATION des PV officiels (#63, incr. B).
 *
 * EMISSION (emitFromCalc) — pour un calc_result du tenant courant :
 *  1. assemble le CONTENU CANONIQUE { pvNumber, sealedAt(ISO string), engineMeta,
 *     identity, input, output, scienceStatus } (sealedAt = CHAINE ISO, jamais un
 *     objet Date : canonicalize n'accepte que des valeurs JSON-plain) ;
 *  2. alloue le numero PAR ORG (allocate_pv_number) au format
 *     PV-RDS-{orgSlug}-{YYYY}-{NNNNNN} ;
 *  3. scelle : content_hash = SHA-256(canonical), hmac = HMAC-SHA256(canonical,
 *     PV_SIGNING_SECRET) ;
 *  4. insere l'official_pv IMMUABLE (copie figee + input_canonical = la chaine
 *     EXACTE scellee).
 *
 *  IDEMPOTENCE : UNIQUE(org_id, calc_result_id) en base. Si un PV existe deja
 *  pour ce calcul, on le RENVOIE tel quel SANS bruler de numero (on n'appelle
 *  meme pas allocate_pv_number). Une course (deux emissions simultanees) bute sur
 *  la contrainte unique -> on relit et renvoie l'existant.
 *
 * LECTURE (getById/list) : renvoie le PV + `sealValid`, recalcule en
 * re-canonicalisant... NON : on re-verifie le sceau STOCKE contre la chaine
 * canonique STOCKEE (input_canonical). Une alteration de input_canonical en base
 * casse le hash -> sealValid=false (detection de falsification).
 */
@Injectable()
export class PvService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  /**
   * Emet (ou renvoie, si deja emis) le PV officiel d'un calc_result du tenant.
   * @throws NotFoundException si le calcul n'existe pas dans le tenant courant.
   */
  async emitFromCalc(args: {
    calcResultId: string;
    projectId: string;
    userId: string;
  }): Promise<SealedPvRow> {
    const orgId = requireOrgId();
    const secret = this.signingSecret();

    return this.prisma
      .withTenant(orgId, async (tx) => {
        // IDEMPOTENCE : un PV existe-t-il deja pour ce calcul ? Si oui, on le renvoie
        // tel quel (aucun numero brule, aucun nouveau scellement). B1-bis : on OMET
        // document_html du retour (bande passante) — document_format reste expose.
        const existing = await tx.officialPv.findUnique({
          where: {
            orgId_calcResultId: { orgId, calcResultId: args.calcResultId },
          },
          omit: { documentHtml: true },
        });
        if (existing) return existing;

        // Charge le calcul (RLS scope -> uniquement le tenant courant).
        const calc = await tx.calcResult.findUnique({
          where: { id: args.calcResultId },
        });
        if (!calc || calc.projectId !== args.projectId) {
          throw new NotFoundException(
            'Calcul introuvable dans ce projet/cette organisation.',
          );
        }

        // Le projet doit etre ECRIVABLE : present dans le tenant (RLS), NON archive,
        // et VERROUILLE (FOR SHARE) jusqu'au COMMIT — sinon une suppression
        // definitive concurrente pouvait detruire le projet entre ce controle et
        // l'INSERT ci-dessous, et laisser un PV SCELLE ORPHELIN (revue adverse :
        // course TOCTOU ; official_pvs n'a aucune FK qui l'aurait rattrape).
        //
        // On APPELLE la garde au lieu de re-ecrire son predicat : la regle de
        // statut vit a UN SEUL endroit (project-write-guard), sinon les deux copies
        // divergent — et c'est un predicat de securite. Elle rend {id, name} : le
        // libelle scelle vient de la MEME lecture que le controle (pas de seconde
        // requete qui pourrait voir un autre etat).
        //
        // PLACE DANS LA SEQUENCE (inchangee) : APRES le test d'idempotence — une
        // RE-lecture d'un PV deja emis reste servie, y compris sur projet archive
        // (cf. projects-lifecycle.e2e) ; seule l'EMISSION est barree. Et AVANT
        // allocate_pv_number / reserveUnit : aucun numero brule, aucun quota
        // consomme sur un refus. C'est aussi le PREMIER verrou de la transaction
        // (ordre anti-interblocage, cf. project-write-guard).
        const project = await assertProjetEcrivable(tx, args.projectId);

        // IDENTITE A SCELLER (org + emetteur) — lecture via fonction DEFINER.
        //
        // MIGRATION 0007 : roadsen_app n'a PLUS de DML direct sur organizations /
        // users (BARRIERE 1 anti-fuite identite). On lit donc le slug + nom de
        // l'org ET le nom complet de l'emetteur en UNE fois via la fonction
        // SECURITY DEFINER pv_emitter_context(p_org_id, p_user_id), owned par
        // roadsen_auth (qui detient le privilege identite) et bornee au couple
        // passe : orgId (deja prouvee par TenantGuard) + args.userId (sub JWT
        // verifie). Le nom de l'org et le visa de l'emetteur sont des donnees
        // SCELLEES (provenance du PV), pas un simple affichage.
        //
        // NB ROLE : cet appel a lieu DANS withTenant (donc SOUS roadsen_app, cf.
        // PrismaService). pv_emitter_context etant SECURITY DEFINER, il s'execute
        // QUAND MEME avec les droits de roadsen_auth (le SET ROLE de l'appelant est
        // ignore par SECURITY DEFINER) -> il franchit la RLS d'identite. C'est une
        // lecture identite READ-ONLY, auto-contenue (drapeau on->off interne) : seule
        // exception sanctionnee a "pas de DEFINER d'identite dans withTenant", car
        // l'emission a besoin du visa scelle au moment du scellement.
        const ctxRows = await tx.$queryRaw<
          Array<{
            org_slug: string;
            org_name: string;
            emitter_full_name: string | null;
          }>
        >`
        SELECT org_slug, org_name, emitter_full_name
        FROM pv_emitter_context(${orgId}::uuid, ${args.userId}::uuid)
      `;
        const ctx = ctxRows[0];
        if (!ctx) {
          // org ou emetteur introuvable (ne devrait pas arriver : FK + membership
          // deja prouve). Fail-closed plutot que sceller a vide.
          throw new NotFoundException('Organisation ou émetteur introuvable.');
        }
        const org = { slug: ctx.org_slug, name: ctx.org_name };
        // full_name est NON-NULL au schema ; fallback defensif si vide/illisible.
        const userDisplayName =
          ctx.emitter_full_name && ctx.emitter_full_name.trim().length > 0
            ? ctx.emitter_full_name.trim()
            : '';

        // sealedAt FIGE (ISO string) : c'est l'horodatage SCELLE du PV.
        const sealedAtIso = new Date().toISOString();
        const year = Number(sealedAtIso.slice(0, 4));

        // NUMEROTATION PAR ORG (idempotente cote sequence) : allocate_pv_number
        // incremente le compteur du tenant courant. On l'appelle UNIQUEMENT ici,
        // apres avoir verifie qu'aucun PV n'existe -> pas de numero gaspille.
        // CAST ::int explicite : un parametre lie Prisma est typé bigint par
        // defaut ; la fonction attend integer, et Postgres ne resout pas
        // bigint->integer implicitement (42883). Le cast fige la signature.
        const seqRows = await tx.$queryRaw<
          Array<{ allocate_pv_number: bigint }>
        >`
        SELECT allocate_pv_number(${year}::int) AS allocate_pv_number
      `;
        const seq = Number(seqRows[0]?.allocate_pv_number ?? 0);
        const pvNumber = formatPvNumber(org.slug, year, seq);

        // INTEGRITE (revue adverse) : calc_results est MUTABLE (roadsen_app a UPDATE).
        // On RE-EXECUTE le moteur sur l'input stocke et on REFUSE de sceller si la sortie
        // recomputee differe de la sortie stockee -> le PV scelle correspond TOUJOURS a ce
        // que le moteur produit REELLEMENT (pas une sortie alteree en base entre calcul et
        // emission). Fail-closed : moteur indisponible / non reproductible / divergent
        // (ex. version moteur changee depuis le calcul) -> emission REFUSEE.
        const dispatch = findEngineDispatchByRegistryId(calc.engineId);
        if (!dispatch) {
          throw new ServiceUnavailableException(
            `Moteur « ${calc.engineId} » indisponible pour re-verification a l'emission du PV.`,
          );
        }
        const recomputed = dispatch.run(calc.input);
        if (!recomputed.ok) {
          throw new ConflictException(
            'Le calcul ne peut plus etre reproduit par le moteur : emission du PV refusee (integrite).',
          );
        }
        const recomputedOutput: unknown = projectEngineOutput(
          dispatch.contract.outputSchema,
          recomputed.output,
        );
        // GARDE FAIL-CLOSED (revue adverse B1) : un output porteur d'une `erreur` (echec de
        // garde encode ok:true + zeros par radier/plane-strain/tri-raft) ne doit JAMAIS etre
        // scelle — sinon PV de zeros « faisant foi » (DoD §5). Defense en profondeur : la
        // garde de calc-results empeche deja de persister un tel calcul ; on refuse aussi ici.
        if (
          recomputedOutput != null &&
          typeof recomputedOutput === 'object' &&
          (recomputedOutput as { erreur?: unknown }).erreur != null
        ) {
          throw new ConflictException(
            'Ce calcul est en erreur : emission du PV refusee (aucun livrable scelle sur un calcul echoue).',
          );
        }
        // TRACABILITE (ADR 0013, revue adverse CRITIQUE-1) : la meta scellee est prise
        // sur la ligne STOCKEE (engineVersion/engineSourceHash du calcul). Si le
        // registre a change depuis (bascule de source moteur), une sortie
        // numeriquement identique passerait la garde d'alteration ci-dessous et
        // re-scellerait l'ancien hash — un PV neuf designant une source incapable
        // de reproduire le calcul. Refus INCONDITIONNEL, meme a sortie identique :
        // relancer le calcul regenere une ligne portant la meta courante.
        const sourceDrift =
          recomputed.meta.engineVersion !== calc.engineVersion ||
          (calc.engineSourceHash != null &&
            recomputed.meta.engineSourceHash != null &&
            recomputed.meta.engineSourceHash !== calc.engineSourceHash);
        if (sourceDrift) {
          throw new ConflictException(
            'Ce calcul a ete produit par une version anterieure du moteur : relancez le calcul avant d emettre le PV.',
          );
        }
        // GARDE D'ALTERATION : equivalence NUMERIQUE stricte (rel <= 1e-12), pas
        // egalite canonique de chaines — Prisma perd le 17e chiffre significatif
        // a l'ecriture JSONB (constate e2e : NE 1467314.8218242952 -> stocke
        // 1467314.821824295), ce qui faisait refuser des calculs legitimes.
        // Structure/textes/booleens restent compares EXACTEMENT ; une alteration
        // reelle (valeur metier changee) reste detectee (cf. output-equivalence.spec).
        if (!outputsEquivalent(recomputedOutput, calc.output)) {
          throw new ConflictException(
            'La sortie stockee ne correspond pas au recalcul serveur (alteration detectee) : emission du PV refusee.',
          );
        }

        // VERDICT (ADR 0012) — resolu depuis l'engineId scelle (registryId) et la
        // sortie persistee. FAIL-CLOSED : resolveVerdict LEVE si un moteur a
        // verdict booleen attendu (burmister/pieux) ne porte pas son drapeau ->
        // pas de PV (on refuse de sceller un verdict indetermine). Le verdict
        // entre dans le CONTENU CANONIQUE (champ de 1er niveau, scelle par le HMAC).
        const verdict = resolveVerdict(calc.engineId, calc.output);

        // DOCUMENT SCELLE (option-3, 0023) : si une capture du document client
        // (HTML d'impression) existe pour ce calcul, on scelle son empreinte
        // sha256(print_html) dans le contenu canonique. Le document devient alors
        // RE-VERIFIABLE (GET /pvs/:id/document re-hache le print_html stocke et
        // exige l'egalite avec cette empreinte scellee). ABSENTE -> champ `document`
        // OMIS (retro-compat : les calculs sans capture gardent le PV pdfmake ; les
        // PV deja emis, sans ce champ, restent valides et re-verifiables tels quels).
        const snapshot = await tx.calcSnapshot.findUnique({
          where: { calcResultId: args.calcResultId },
          select: { printHtml: true },
        });
        const documentSeal: { document?: SealableValue } = snapshot
          ? {
              document: {
                format: 'html',
                sha256: sealContentHash(snapshot.printHtml),
              },
            }
          : {};

        // CONTENU CANONIQUE : tout ce qui est scelle. sealedAt = chaine ISO.
        const content: SealableValue = {
          pvNumber,
          verdict,
          sealedAt: sealedAtIso,
          engineMeta: {
            engineId: calc.engineId,
            engineVersion: calc.engineVersion,
            // engineSourceHash optionnel (peut etre null en base) : on l'omet si absent.
            ...(calc.engineSourceHash
              ? { engineSourceHash: calc.engineSourceHash }
              : {}),
          },
          identity: {
            userId: args.userId,
            // Nom de l'emetteur + organisation : SCELLES (visa du PV = provenance).
            // Le PV est le livrable du bureau d'etudes -> l'organisation fait partie
            // de la provenance scellee, comme l'auteur. userDisplayName vide est
            // scelle tel quel ('') -> rendu « (identité non renseignée) ».
            userDisplayName,
            orgDisplayName: org.name,
            projectId: args.projectId,
            projectName: project.name,
          },
          input: calc.input,
          output: calc.output,
          scienceStatus: SCIENCE_STATUS,
          // Empreinte du document client scelle (OMISE si aucune capture).
          ...documentSeal,
        };

        const canonical = canonicalize(content);
        const contentHash = sealContentHash(canonical);
        const hmac = sealHmac(canonical, secret);

        // DECOMPTE ATOMIQUE (ADR 0011 §3, TM-8) — UNIQUEMENT sur l'EMISSION REELLE.
        // On est ici APRES le check d'idempotence (existing renvoye plus haut) :
        // une re-emission idempotente N'ATTEINT JAMAIS ce point -> AUCUN 2e quota
        // brule (anti double-comptage). Le decompte est dans la MEME tx que
        // l'INSERT : quota epuise/expire -> 402 -> ROLLBACK -> pas de PV, pas de
        // conso. Une course (P2002) plus bas rollback AUSSI cette reservation.
        await this.subscriptions.reserveUnit(tx, {
          orgId,
          kind: 'PV',
          refId: args.calcResultId,
          userId: args.userId,
        });

        // INSERT de l'official_pv (immuable). Une course sur le meme calcul bute sur
        // UNIQUE(org_id, calc_result_id) -> P2002. ATTENTION : le rattrapage NE PEUT
        // PAS se faire ICI : le P2002 a deja AVORTE cette transaction (Postgres 25P02
        // « current transaction is aborted »), tout ordre suivant DANS la tx echoue.
        // On laisse donc le P2002 REMONTER : le throw du callback termine la tx
        // ($transaction rollback), et le rattrapage se fait dans une NOUVELLE tx,
        // hors de ce withTenant (cf. catch d'emitFromCalc).
        return tx.officialPv.create({
          data: {
            orgId,
            calcResultId: args.calcResultId,
            projectId: args.projectId,
            pvNumber,
            userId: args.userId,
            projectName: project.name,
            engineId: calc.engineId,
            engineVersion: calc.engineVersion,
            engineSourceHash: calc.engineSourceHash,
            inputCanonical: canonical,
            output: calc.output as object,
            scienceStatus: SCIENCE_STATUS,
            // Copie denormalisee de la valeur SCELLEE (verite = input_canonical).
            verdict,
            contentHash,
            hmac,
            sealedAt: new Date(sealedAtIso),
            // DOCUMENT CLIENT AUTOPORTANT (B1, option-3) : on FIGE les octets du
            // print_html dans la ligne IMMUABLE au moment du scellement (comme
            // input_canonical). Le PV devient regenerable independamment du cache
            // MUTABLE calc_snapshots (qu'une re-capture ecraserait). NULL si aucune
            // capture (retro-compat -> fallback PDF). sha256(document_html) reste
            // egal a document.sha256 scelle (re-verifie au service du document).
            documentHtml: snapshot ? snapshot.printHtml : null,
            documentFormat: snapshot ? 'html' : null,
          },
          // B1-bis : on ECRIT document_html (data) mais on ne le RENVOIE pas (omit).
          omit: { documentHtml: true },
        });
      })
      .catch(async (err: unknown) => {
        // RATTRAPAGE DE COURSE — HORS de la tx avortee. Si l'INSERT a bute sur
        // UNIQUE(org_id, calc_result_id) (P2002), un PV pour ce calcul a ete cree
        // par une emission concurrente : on le relit dans une NOUVELLE transaction
        // (la 1re est terminee par le throw -> la connexion poolee est reutilisable)
        // et on le renvoie -> idempotence preservee meme sous course. Le numero
        // alloue par la transaction perdante est « brule » (gap possible) :
        // acceptable, un compteur n'est pas garanti contigu, l'unicite prime.
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          const raced = await this.prisma.withTenant(orgId, (tx2) =>
            tx2.officialPv.findUnique({
              where: {
                orgId_calcResultId: { orgId, calcResultId: args.calcResultId },
              },
              omit: { documentHtml: true },
            }),
          );
          if (raced) return raced;
        }
        throw err;
      });
  }

  /** Lit un PV du tenant + verdict de sceau. @throws NotFound si absent/hors tenant. */
  async getViewById(args: {
    projectId: string;
    pvId: string;
  }): Promise<OfficialPvView> {
    const orgId = requireOrgId();
    const secret = this.signingSecret();
    // B1-bis : on OMET document_html (jusqu'a 1 MiB) des lectures — document_format
    // reste expose (le front sait si un document existe). Seul documentForView le charge.
    const pv = await this.prisma.withTenant(orgId, (tx) =>
      tx.officialPv.findUnique({
        where: { id: args.pvId },
        omit: { documentHtml: true },
      }),
    );
    if (!pv || pv.projectId !== args.projectId) {
      throw new NotFoundException(
        'PV introuvable dans ce projet/cette organisation.',
      );
    }
    return { pv, sealValid: this.verify(pv, secret) };
  }

  /**
   * Rend le PDF d'un PV du tenant. Passe par getViewById -> MEME isolation/RLS
   * et MEME 404 cross-org/hors-projet. Le PDF est régénérable (rendu depuis les
   * seules données scellées de l'official_pv).
   */
  async pdfForView(args: {
    projectId: string;
    pvId: string;
  }): Promise<{ pv: SealedPvRow; pdf: Buffer }> {
    // getViewById -> signingSecret() : secret ABSENT = mauvaise config serveur
    // -> 503 (ServiceUnavailable), déjà géré en amont. Distinct du 409 ci-dessous.
    const { pv, sealValid } = await this.getViewById(args);
    // FAIL-CLOSED — REFUS DUR (CRIT-1, décision titulaire) : un PV « officiel » au
    // sceau cassé NE DOIT PAS exister en PDF (pas de tampon « invalide »). sealValid
    // est faux si verifySeal échoue (donnée altérée) OU si input_canonical est
    // illisible (le hash d'une canonique corrompue ne correspond plus) -> les deux
    // cas = anomalie d'intégrité = 409 Conflict. renderPvPdf re-vérifie en défense
    // en profondeur (il lèverait aussi). AUCUN rendu dégradé depuis la ligne.
    if (!sealValid) {
      throw new ConflictException(
        "Intégrité du PV non vérifiée — anomalie d'intégrité, contactez le support.",
      );
    }
    // Défense en profondeur : renderPvPdf re-vérifie le sceau ET re-parse la
    // canonique (fail-closed). Toute erreur d'intégrité résiduelle (ex. canonique
    // illisible dont le hash coïnciderait malgré tout) est mappée en 409, jamais
    // un 500 brut — cohérent avec le refus dur ci-dessus.
    try {
      const pdf = await renderPvPdf(pv);
      return { pv, pdf };
    } catch {
      throw new ConflictException(
        "Intégrité du PV non vérifiée — anomalie d'intégrité, contactez le support.",
      );
    }
  }

  /**
   * Sert le DOCUMENT CLIENT SCELLE d'un PV (option-3, 0023), ENROBE du cartouche
   * PV (#pv-cartouche). Le HTML d'impression capture est re-servi avec, en plus,
   * un bandeau + un pied + un titre de PV injectes AU SERVICE (les octets stockes
   * restent inchanges ; la garde de re-hash porte sur les octets bruts).
   *
   * SOURCE = official_pv.document_html (copie IMMUABLE figee au scellement, B1) —
   * PAS le cache MUTABLE calc_snapshots : une re-capture apres emission n'affecte
   * donc plus le livrable (regenerabilite, DoD §5).
   *
   * SEUL point qui charge document_html (B1-bis) : les lectures/listes l'OMETTENT
   * pour la bande passante ; ici on doit servir les octets, donc requete DEDIEE
   * (findUnique complet) + verification du sceau EN INTERNE (on ne passe pas par
   * getViewById, qui renvoie une ligne sans document_html).
   *
   * Chaine d'integrite (fail-closed) :
   *  1. findUnique complet + MEME isolation/RLS + 404 cross-org/hors-projet ; sceau
   *     casse -> 409 (comme le PDF : pas de document depuis un PV au sceau rompu).
   *  2. Le PV DOIT porter une empreinte `document` scellee -> sinon 404 (ancien
   *     PV / autre moteur : l'appelant retombe sur le PDF pdfmake).
   *  3. Le PV DOIT porter document_html (copie figee) -> absent -> 404 (fallback PDF).
   *  4. RE-VERIFICATION (defense en profondeur) : sha256(document_html) DOIT egaler
   *     l'empreinte scellee -> sinon 409 (le document a ete altere apres scellement,
   *     ex. abus DDL). L'immuabilite (trigger 0006) rend deja l'UPDATE impossible au
   *     runtime : ce controle est une seconde barriere.
   *
   * @throws NotFoundException PV absent/hors tenant, sans empreinte scellee, ou
   *   sans document_html (fallback PDF).
   * @throws ConflictException sceau rompu, ou document altere (hash != empreinte).
   */
  async documentForView(args: {
    projectId: string;
    pvId: string;
  }): Promise<{ pv: OfficialPv; printHtml: string }> {
    const orgId = requireOrgId();
    const secret = this.signingSecret();
    // Requete DEDIEE : ligne COMPLETE (document_html inclus) — l'unique lecture qui
    // charge les octets. RLS scope au tenant courant.
    const pv = await this.prisma.withTenant(orgId, (tx) =>
      tx.officialPv.findUnique({ where: { id: args.pvId } }),
    );
    if (!pv || pv.projectId !== args.projectId) {
      throw new NotFoundException(
        'PV introuvable dans ce projet/cette organisation.',
      );
    }
    // FAIL-CLOSED : un PV au sceau casse ne sert AUCUN livrable (cf. pdfForView).
    if (!this.verify(pv, secret)) {
      throw new ConflictException(
        "Intégrité du PV non vérifiée — anomalie d'intégrité, contactez le support.",
      );
    }
    // Empreinte `document` scellee dans la canonique. Absente -> 404 (retro-compat :
    // PV sans capture -> l'appelant retombe sur le PDF pdfmake).
    const sealedSha = extractSealedDocumentSha(pv.inputCanonical);
    if (!sealedSha) {
      throw new NotFoundException(
        'Aucun document scellé pour ce PV (utiliser le PDF).',
      );
    }
    // Source AUTOPORTANTE et IMMUABLE : les octets figes dans l'official_pv.
    if (pv.documentHtml == null) {
      // Empreinte scellee mais copie figee absente (ne devrait pas arriver : les
      // deux sont ecrits ensemble a l'INSERT) -> fallback PDF plutot que 500.
      throw new NotFoundException(
        'Document scellé introuvable pour ce PV (utiliser le PDF).',
      );
    }
    // RE-VERIFICATION D'INTEGRITE (defense en profondeur) : le document_html fige
    // doit re-produire EXACTEMENT l'empreinte scellee. Une alteration (abus DDL,
    // corruption) casse l'egalite -> 409. LA GARDE PORTE TOUJOURS SUR LES OCTETS
    // BRUTS STOCKES — pas sur la copie enrobee ci-dessous.
    if (sealContentHash(pv.documentHtml) !== sealedSha) {
      throw new ConflictException(
        "Le document ne correspond plus au sceau — anomalie d'intégrité, contactez le support.",
      );
    }
    // ENROBAGE AU SERVICE (#pv-cartouche) : le document scelle est un rapport BRUT
    // de l'outil, sans marque de PV. On injecte le cartouche (bandeau + pied + CSS
    // + titre) dans une COPIE SERVIE — les octets STOCKES restent inchanges, la
    // garde de re-hash ci-dessus porte toujours sur eux. L'empreinte imprimee dans
    // le cartouche NE PEUT PAS etre dans le contenu hache (hash circulaire) : d'ou
    // l'enrobage ICI (au service) et non au scellement. Les libelles projet/numero/
    // hash/verdict/version viennent des COLONNES scellees ; l'emetteur/organisation
    // de identity{} dans la canonique scellee.
    const identity = extractSealedIdentity(pv.inputCanonical);
    const printHtml = wrapSealedDocumentWithPvChrome(pv.documentHtml, {
      pvNumber: pv.pvNumber,
      contentHash: pv.contentHash,
      sealedAt: pv.sealedAt,
      projectName: pv.projectName,
      userDisplayName: identity.userDisplayName,
      orgDisplayName: identity.orgDisplayName,
      engineId: pv.engineId,
      engineVersion: pv.engineVersion,
      verdict: pv.verdict,
    });
    return { pv, printHtml };
  }

  /** Liste les PV d'un projet du tenant (RLS scope), chacun avec son verdict. */
  async listForProject(projectId: string): Promise<OfficialPvView[]> {
    const orgId = requireOrgId();
    const secret = this.signingSecret();
    const rows = await this.prisma.withTenant(orgId, (tx) =>
      tx.officialPv.findMany({
        where: { projectId },
        orderBy: { sealedAt: 'desc' },
        // B1-bis : liste SANS les octets du document (document_format conserve).
        omit: { documentHtml: true },
      }),
    );
    return rows.map((pv) => ({ pv, sealValid: this.verify(pv, secret) }));
  }

  /**
   * Re-verifie le sceau STOCKE contre la chaine canonique STOCKEE. Une alteration
   * de input_canonical (ou du hash/hmac) en base -> sealValid=false. N'utilise que
   * les champs du sceau -> accepte aussi bien la ligne complete que la ligne
   * OMISE de document_html (B1-bis).
   */
  private verify(
    pv: Pick<OfficialPv, 'inputCanonical' | 'contentHash' | 'hmac'>,
    secret: string,
  ): boolean {
    return verifySeal(pv.inputCanonical, pv.contentHash, pv.hmac, secret);
  }

  /** Recupere le secret de scellement ; refuse de fonctionner sans (fail-closed). */
  private signingSecret(): string {
    const secret = process.env.PV_SIGNING_SECRET;
    if (!secret || secret.length === 0) {
      // Secret absent = MAUVAISE CONFIGURATION SERVEUR (pas un refus d'autorisation) :
      // on ne peut ni sceller ni verifier. 503 (temporairement indisponible),
      // message borne -> pas de 403 trompeur ni de PV non signe / verif faussee.
      throw new ServiceUnavailableException(
        'Scellement temporairement indisponible : secret de signature des PV non configure.',
      );
    }
    return secret;
  }
}

/** Statut science = metadonnee INTERNE (pas de bandeau @science-unsigned, decision titulaire). */
const SCIENCE_STATUS = 'unsigned';

/** Empreinte hex SHA-256 attendue pour un document scelle (64 caracteres). */
const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

/**
 * Extrait l'empreinte `document.sha256` SCELLEE d'une chaine canonique de PV.
 * Renvoie l'empreinte (hex64) si le PV porte un document scelle au format HTML,
 * `null` si le champ est ABSENT (PV sans capture -> l'appelant repond 404 + PDF).
 * FAIL-CLOSED : un champ `document` PRESENT mais malforme (format inattendu ou
 * sha256 hors charset) LEVE -> traite comme anomalie d'integrite en amont (409),
 * jamais un rendu de document a partir d'une empreinte douteuse.
 */
function extractSealedDocumentSha(canonical: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(canonical);
  } catch {
    // Canonique illisible : le sceau aurait deja echoue (getViewById -> 409). Par
    // prudence, on traite comme « pas de document » (l'appelant a deja barre le
    // sceau casse en amont).
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const doc = (parsed as { document?: unknown }).document;
  if (doc === undefined) return null; // pas de document scelle -> 404 + fallback PDF
  if (typeof doc !== 'object' || doc === null) {
    throw new ConflictException('Empreinte de document scellée malformée.');
  }
  const { format, sha256 } = doc as { format?: unknown; sha256?: unknown };
  if (
    format !== 'html' ||
    typeof sha256 !== 'string' ||
    !SHA256_HEX_RE.test(sha256)
  ) {
    throw new ConflictException('Empreinte de document scellée malformée.');
  }
  return sha256;
}

/** Formate PV-RDS-{orgSlug}-{YYYY}-{NNNNNN} (sequence sur 6 chiffres, zero-padded). */
function formatPvNumber(orgSlug: string, year: number, seq: number): string {
  const nnnnnn = String(seq).padStart(6, '0');
  return `PV-RDS-${orgSlug}-${year}-${nnnnnn}`;
}
