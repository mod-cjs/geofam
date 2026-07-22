import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { requireOrgId } from '../tenant/tenant-context';

import { assertInertHtml } from './html-guard';
import { assertProjetEcrivable } from './project-write-guard';

/**
 * CalcSnapshotsService — CAPTURE du document client (scellement option-3, 0023).
 *
 * Le PV « option-3 » EST le HTML/SVG que l'outil client produit A L'IMPRESSION,
 * scelle puis re-affiche/imprime a l'identique. Le front capture ce document et
 * l'envoie ici ; on le PERSISTE org-scope apres la GARDE §8 (assertInertHtml) sur
 * les DEUX champs — fail-closed : un HTML porteur de script/handler/URI js:/
 * marqueur moteur, ou hors taille, est REFUSE (400) et JAMAIS stocke. Cette garde
 * est BEST-EFFORT (defense en profondeur, pas un tokenizer complet) : l'inertie
 * EFFECTIVE au ré-affichage vient de la CSP HTTP posee par le controleur au service.
 *
 * UPSERT par calcResultId : un calcul est IMMUABLE -> sa capture est deterministe
 * -> re-capturer un meme calcul ECRASE la ligne (aucune divergence possible). La
 * capture ne porte PAS d'integrite en soi ; c'est le SCEAU du PV qui fige
 * sha256(print_html) (cf. PvService.emitFromCalc + documentForView).
 */
@Injectable()
export class CalcSnapshotsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Capture (ou re-capture) le document d'un calc_result du tenant courant.
   * @throws BadRequestException si un des HTML n'est pas inerte (garde §8).
   * @throws NotFoundException si le calcul n'existe pas dans ce projet/ce tenant.
   */
  async capture(args: {
    projectId: string;
    calcResultId: string;
    displayHtml: string;
    printHtml: string;
  }): Promise<void> {
    const orgId = requireOrgId();

    // GARDE §8 AVANT tout accas base : filtre best-effort qui refuse un HTML
    // manifestement actif/confidentiel (l'inertie au rendu est portee par la CSP).
    assertInertHtml(args.displayHtml, 'displayHtml');
    assertInertHtml(args.printHtml, 'printHtml');

    await this.prisma.withTenant(orgId, async (tx) => {
      // Le PROJET doit etre ECRIVABLE (present dans le tenant, non ARCHIVE) — la
      // capture est une ECRITURE, et rien ne doit s'ecrire sur un projet que
      // l'utilisateur croit supprime (revue adverse PR #120 : ce service ne
      // controlait pas le projet du tout, seulement l'appartenance du calcul).
      await assertProjetEcrivable(tx, args.projectId);

      // Le calcul doit exister DANS le tenant (RLS scope) ET appartenir au projet
      // de l'URL — meme controle que PvService.emitFromCalc (404 tenant-safe pour
      // un calcul d'un autre org OU d'un autre projet du meme org).
      const calc = await tx.calcResult.findUnique({
        where: { id: args.calcResultId },
        select: { projectId: true },
      });
      if (!calc || calc.projectId !== args.projectId) {
        throw new NotFoundException(
          'Calcul introuvable dans ce projet/cette organisation.',
        );
      }

      // UPSERT par calc_result_id : la 1re capture INSERE, une re-capture ECRASE.
      // WITH CHECK (RLS) garantit que la ligne appartient au tenant courant.
      await tx.calcSnapshot.upsert({
        where: { calcResultId: args.calcResultId },
        create: {
          orgId,
          calcResultId: args.calcResultId,
          displayHtml: args.displayHtml,
          printHtml: args.printHtml,
        },
        update: {
          displayHtml: args.displayHtml,
          printHtml: args.printHtml,
        },
      });
    });
  }

  /**
   * Lit le document capture d'un calc_result du tenant courant (RE-AFFICHAGE /
   * RE-IMPRESSION AVANT scellement). Sert `displayHtml` + `printHtml` tels que
   * captures (filtres best-effort par la garde §8 a la capture ; l'inertie au
   * rendu reste portee par la CSP du contexte d'affichage, pas par ce service).
   *
   * @throws NotFoundException si le calcul n'est pas dans ce projet/ce tenant
   *   (RLS -> findUnique null ; ou projet different du meme org), OU si aucun
   *   snapshot n'existe (calcul ancien / moteur non capture). MEME 404
   *   « introuvable » pour tous ces cas (tenant-safe, anti-enumeration) : l'UI
   *   retombe alors sur son panneau de metadonnees.
   */
  async readForCalc(args: {
    projectId: string;
    calcResultId: string;
  }): Promise<{ displayHtml: string; printHtml: string }> {
    const orgId = requireOrgId();
    return this.prisma.withTenant(orgId, async (tx) => {
      // Le calcul doit exister DANS le tenant ET appartenir au projet de l'URL.
      const calc = await tx.calcResult.findUnique({
        where: { id: args.calcResultId },
        select: { projectId: true },
      });
      if (!calc || calc.projectId !== args.projectId) {
        throw new NotFoundException(
          'Calcul introuvable dans ce projet/cette organisation.',
        );
      }
      const snapshot = await tx.calcSnapshot.findUnique({
        where: { calcResultId: args.calcResultId },
        select: { displayHtml: true, printHtml: true },
      });
      if (!snapshot) {
        // Pas de capture pour ce calcul -> 404 (l'UI affiche le repli metadonnees).
        throw new NotFoundException('Aucun document capturé pour ce calcul.');
      }
      return {
        displayHtml: snapshot.displayHtml,
        printHtml: snapshot.printHtml,
      };
    });
  }
}
