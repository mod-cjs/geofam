import { NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

/** Projet cible d'une ecriture, VERROUILLE pour la duree de la transaction. */
export interface ProjetEcrivable {
  id: string;
  name: string;
}

/**
 * GARDE D'ECRITURE SUR PROJET — le projet cible doit exister DANS le tenant
 * courant ET ne pas etre ARCHIVE, et il est VERROUILLE (FOR SHARE) jusqu'au
 * COMMIT de l'appelant.
 *
 * POURQUOI ELLE EXISTE (revue adverse PR #120 — defaut PREEXISTANT)
 * ----------------------------------------------------------------
 * `ProjectsService` exclut ARCHIVED de toutes ses lectures ET de toutes ses
 * mutations (list / getById / rename / archive). Trois points d'ecriture situes
 * AILLEURS ne le faisaient pas — ils verifiaient seulement que le projet EXISTE :
 * le calcul persistant, la capture de document et l'emission de PV. On pouvait
 * donc, sur un projet que l'utilisateur croit supprime :
 *   - BRULER DU QUOTA (reserveUnit + ligne de ledger APPEND-ONLY, irreversible) ;
 *   - SCELLER UN PV rattache a un projet INVISIBLE dans toutes les listes, soit
 *     un livrable orphelin — alors que le scellement est notre garantie la plus
 *     forte (DoD §5).
 *
 * Cette fonction est le SEUL endroit qui exprime la regle : un nouveau point
 * d'ecriture rattache a un projet l'appelle et ne peut plus l'oublier a moitie.
 * Elle rend le projet ({id, name}) pour qu'aucun appelant n'ait de raison de
 * re-lire — et donc de re-ecrire — le predicat de son cote (une 2e copie derive).
 *
 * SQL BRUT + `FOR SHARE` (revue adverse — COURSE TOCTOU, defaut BLOQUANT)
 * ----------------------------------------------------------------------
 * Le predicat de statut ne suffisait pas : entre CETTE lecture et l'ECRITURE de
 * l'appelant, une `DELETE /projects/:id/permanent` concurrente pouvait detruire
 * le projet et COMMITER (READ COMMITTED, aucun verrou). L'emission inserait alors
 * son official_pv APRES coup : PV scelle, numerote, facture, dont le projet
 * n'existe plus. La base ne l'arretait pas — official_pvs n'a AUCUNE FK vers
 * projects (schema « autoportant » assume). Un calcul ou une capture, eux,
 * echouaient proprement grace a la FK composite (org_id, project_id) : le seul
 * objet non protege etait exactement le livrable scelle (DoD §5).
 *
 * `FOR SHARE` pose un verrou PARTAGE sur la ligne projet, tenu jusqu'au COMMIT :
 *   - il est COMPATIBLE avec lui-meme -> deux calculs / deux emissions
 *     concurrents sur le MEME projet ne se bloquent PAS l'un l'autre (ils ne
 *     serialisent que la ou ils le faisaient deja : le compteur de numeros) ;
 *   - il est INCOMPATIBLE avec le `FOR UPDATE` de `deletePermanently` et avec un
 *     UPDATE de la ligne (archivage) -> une destruction ou un archivage
 *     concurrent ATTEND la fin de l'ecriture en cours, puis relit un projet
 *     porteur d'un PV (409) ; symetriquement, si la destruction est passee la
 *     PREMIERE, ce SELECT reprend apres son COMMIT, ne trouve plus la ligne
 *     (READ COMMITTED reevalue apres l'attente) et rend 404 : rien n'est scelle.
 *
 * COUT ASSUME : `FOR SHARE` bloque aussi un UPDATE de la ligne projet — donc un
 * RENOMMAGE ou un ARCHIVAGE concurrent attend la fin du calcul/scellement en
 * cours (quelques centaines de ms au plus : recalcul moteur + INSERT). C'est un
 * choix, pas un oubli : `FOR KEY SHARE` laisserait passer le renommage ET
 * l'archivage, mais rouvrirait la meme course sur l'ARCHIVAGE — or archiver EST
 * le geste « supprimer » de l'interface, et sceller un PV sur un projet archive
 * est precisement le defaut corrige en PR #120. On prefere faire attendre un
 * renommage plutot que produire un livrable scelle sur un projet disparu.
 *
 * ORDRE DES VERROUS (anti-interblocage) — REGLE A NE PAS ENFREINDRE : ce verrou
 * est le PREMIER que prend la transaction appelante ; tous les autres (compteur
 * pv_counters, abonnement, ledger, calc_results) viennent APRES. `deletePermanently`
 * prend lui aussi le projet EN PREMIER (FOR UPDATE), avant de toucher aux enfants.
 * Deux transactions ne peuvent donc pas s'attendre en cycle sur la paire
 * {projet, enfants}. Les lectures qui PRECEDENT cet appel (idempotence du PV,
 * ligne de calcul) sont des SELECT simples : elles ne prennent AUCUN verrou, leur
 * position est donc sans effet sur l'ordre.
 * COROLLAIRE : ne JAMAIS faire un UPDATE de la meme ligne projet apres cet appel
 * dans la meme transaction (montee FOR SHARE -> UPDATE = interblocage classique a
 * deux transactions). Un futur chemin qui devrait ecrire le projet prendra
 * directement `FOR UPDATE`.
 *
 * POURQUOI DU SQL BRUT : Prisma n'exprime pas de clause de verrouillage
 * (`FOR SHARE`/`FOR UPDATE`) dans son API typee. `$queryRaw` (et non
 * `$executeRaw`) : cette requete RAMENE des lignes, on a besoin du projet lu ;
 * `$executeRaw` ne rend qu'un compte de lignes affectees et ne sert que pour un
 * ordre sans resultat (ex. une fonction SQL `RETURNS void`).
 *
 * `WHERE id = ... AND status <> 'ARCHIVED'` reproduit exactement l'ancien
 * `findFirst` (findUnique n'acceptait pas de filtre `status` — c'est ce qui avait
 * laisse passer le defaut d'origine).
 *
 * RLS : le tenant reste porte par la policy (`SET LOCAL app.current_org` dans
 * withTenant), qui s'applique aussi a un SELECT verrouillant. On ne filtre donc
 * PAS org_id a la main ici — le SQL brut ne contourne rien.
 *
 * 404 TENANT-SAFE ET UNIFORME : « archive », « inexistant », « detruit entre-temps »
 * et « appartient a un autre bureau » (RLS -> ligne INVISIBLE) rendent le MEME
 * message. L'appelant ne peut donc pas enumerer les projets archives ni ceux des
 * autres tenants — meme discipline que `ProjectsService.rename`.
 *
 * A APPELER DANS le `withTenant` (la RLS porte l'isolation ; ce predicat porte le
 * statut ; le verrou porte la duree). Hors transaction, le verrou tomberait
 * immediatement et ne protegerait rien.
 *
 * @returns le projet verrouille ({id, name}) — pas de seconde lecture chez l'appelant.
 * @throws NotFoundException si le projet est absent, hors tenant ou ARCHIVE.
 */
export async function assertProjetEcrivable(
  tx: Prisma.TransactionClient,
  projectId: string,
): Promise<ProjetEcrivable> {
  const rows = await tx.$queryRaw<ProjetEcrivable[]>`
    SELECT id, name
      FROM projects
     WHERE id = ${projectId}::uuid
       AND status <> 'ARCHIVED'
       FOR SHARE
  `;
  const project = rows[0];
  if (!project) {
    throw new NotFoundException('Projet introuvable dans cette organisation.');
  }
  return project;
}
