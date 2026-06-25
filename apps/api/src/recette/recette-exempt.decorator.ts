import { SetMetadata } from '@nestjs/common';

/**
 * @RecetteExempt() — marque un HANDLER (ou un controleur) comme OUVERT au regard
 * de la barriere de perimetre `RecetteAccessGuard` : la route reste accessible
 * SANS la cle X-Recette-Key.
 *
 * Pourquoi une METADONNEE plutot qu'un matching de texte sur l'URL : la decision
 * d'exemption est ainsi liee a la ROUTE REELLEMENT MATCHEE par le routeur (le
 * handler que Nest va appeler), pas a une chaine d'URL brute manipulable. Un
 * endpoint NON decore (ex. `/calc/*`) ne PEUT PAS etre exempte, quelle que soit
 * la forme de l'URL (dot-segments, encodage...) : aucune surface de contournement.
 *
 * Reserve aux routes reellement publiques au sens perimetre :
 *  - la page d'accueil sobre (`GET /`, AppController) ;
 *  - la sonde de sante de l'hebergeur (`GET /v1/health`, HealthController) —
 *    Render l'interroge sans en-tete applicatif.
 *
 * ⚠️ A poser UNIQUEMENT sur un HANDLER (une methode), JAMAIS sur une classe
 * @Controller entiere : le guard lit getAllAndOverride([handler, classe]), donc
 * decorer un controleur exempterait TOUTES ses routes d'un coup (risque d'ouvrir
 * par megarde un endpoint sensible). Une route = une decision explicite.
 *
 * NB : c'est une porte INDEPENDANTE de @Public() (qui, lui, concerne le
 * JwtAuthGuard). Une route peut etre @Public sans etre @RecetteExempt (ex.
 * `/calc/*` : public au sens JWT, mais ferme par la cle recette).
 */
export const RECETTE_EXEMPT_KEY = 'roadsen:recetteExempt';
export const RecetteExempt = () => SetMetadata(RECETTE_EXEMPT_KEY, true);
