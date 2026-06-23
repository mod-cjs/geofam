/**
 * EXEMPLE DE REFERENCE (temoin) du contrat d I/O moteur.
 *
 * Ce fichier NE contient AUCUNE formule ni science : c est un moteur FICTIF
 * "reference" dont le seul role est de PROUVER le pattern de contrat (enveloppe
 * de resultat + whitelist de sortie + bornage des entrees persistees). Il sert
 * de gabarit pour les vrais contrats (Sprint 2), sans rien dire des moteurs.
 *
 * On NE definit PAS ici les 6 moteurs reels ; on ne sur-specifie pas. C est un
 * unique exemple minimal, marque comme reference.
 */
import { z } from 'zod';

import { defineEngineContract, SafeNumberSchema, SafeStringSchema } from './engine-io.js';

/**
 * Entree du moteur de reference (bornee, persistee telle quelle). Forme I/O
 * uniquement : aucune signification physique reelle.
 */
// Mode STRIP (defaut z.object) : un champ inconnu est retire a la projection,
// pas rejete (cf. en-tete de engine-io.ts).
const referenceInputSchema = z.object({
  /** Une grandeur d entree quelconque, bornee. */
  valeurA: SafeNumberSchema.positive(),
  /** Un libelle de cas, borne. */
  libelle: SafeStringSchema.optional(),
});

/**
 * Sortie CLIENT-SAFE du moteur de reference : on n expose que le resultat
 * destine a l affichage. AUCUN intermediaire de calcul ne figure ici — c est
 * tout l interet de la whitelist : ce que le moteur calcule en interne ne
 * remonte pas au client.
 */
const referenceOutputSchema = z.object({
  /** Resultat final expose. */
  resultat: SafeNumberSchema,
  /** Verdict d affichage (exemple d enum fermee). */
  verdict: z.enum(['conforme', 'non-conforme']),
});

/**
 * Contrat de reference. A copier comme gabarit pour un vrai moteur ; ne JAMAIS
 * y ajouter de champ "intermediaire" cote sortie.
 */
export const referenceEngineContract = defineEngineContract({
  id: 'reference',
  inputSchema: referenceInputSchema,
  outputSchema: referenceOutputSchema,
});

export type ReferenceInput = z.infer<typeof referenceInputSchema>;
export type ReferenceOutput = z.infer<typeof referenceOutputSchema>;
