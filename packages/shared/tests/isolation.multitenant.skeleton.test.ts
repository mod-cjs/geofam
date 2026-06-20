/**
 * SQUELETTE (skip visible) — Isolation multi-tenant.
 *
 * Etat : EN ATTENTE du schema DB / des modeles Prisma + de la couche d acces
 * (apps/api), construits par un AUTRE coequipier. L isolation se prouve contre
 * une vraie base (RLS PostgreSQL + guards), avec un service de donnees reel :
 * elle ne peut PAS etre prouvee de maniere credible ici dans packages/shared.
 *
 * Ce squelette est volontairement `.skip` (visible) pour rendre la lacune
 * EXPLICITE — pas de cap silencieux. Les vrais tests d isolation vivront avec
 * apps/api (job CI `integration`, base Postgres + migrations), co-construits
 * avec `ingenieur-securite`, et DOIVENT couvrir :
 *
 *   - lecture : tenant A ne voit JAMAIS une ligne de tenant B (chaque table) ;
 *   - ecriture : impossible d ecrire/MAJ une ligne pour un autre org_id ;
 *   - APRES MIGRATION de schema : l isolation tient toujours (regression) ;
 *   - chemin d attaque : forcer un org_id dans le payload / le JWT ne contourne pas ;
 *   - RBAC : un role insuffisant est refuse meme au sein du bon tenant.
 *
 * Ce fichier (cote shared) ne fait que MARQUER l exigence et la rendre visible
 * dans le rapport de tests, le temps que la couche DB existe.
 */
import { describe, it } from 'vitest';

describe('Isolation multi-tenant (PLACEHOLDER — vrais tests cote apps/api)', () => {
  it.skip(
    'TODO[#isolation-tenant] tenant A ne voit jamais les donnees de tenant B, y compris apres migration ' +
      '— bloque sur : schema/Prisma + couche acces (autre coequipier) ; a implementer dans le job CI integration avec ingenieur-securite',
    () => {
      // Skip volontaire : ne RIEN affirmer plutot qu un faux-vert.
    },
  );
});
