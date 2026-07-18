/**
 * Constantes de la landing publique GEOFAM (`/`, `src/app/page.tsx` + `LandingNav.tsx`).
 *
 * Aucune formule, aucun symbole de calcul — uniquement des métadonnées d'affichage
 * et des liens de contact (mêmes valeurs que `app/[orgSlug]/aide/page.tsx`, non
 * dupliquées ailleurs à dessein pour rester indépendant du shell authentifié).
 */

import type { Domain } from '@/components/ui/DomainTag';
import type { SoftwareEntry } from '@/lib/software-catalog';

// ---------------------------------------------------------------------------
// Contact
// ---------------------------------------------------------------------------

export const WHATSAPP_NUMBER = '221768745508';
export const WHATSAPP_MESSAGE = "Bonjour, je souhaite un essai gratuit de GEOFAM";
export const WHATSAPP_HREF = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(WHATSAPP_MESSAGE)}`;

export const SUPPORT_EMAIL = 'direction@geofam.tech';

export const YOUTUBE_HREF = 'https://www.youtube.com/@GEOTECHNIQUE-c7h';

/**
 * CTA « Demander un essai ».
 *
 * Il n'existe PAS de flux d'inscription self-service (pas de formulaire, pas
 * de compte créé automatiquement) — cf. mission landing GEOFAM. Le canal
 * PRIMAIRE est WhatsApp (WHATSAPP_HREF, réponse humaine rapide) ; l'e-mail
 * pré-rempli ci-dessous reste un canal SECONDAIRE (« ou par e-mail ») pour qui
 * préfère écrire. Revue adverse 17/07 : l'e-mail seul était trompeur affiché
 * comme « Essai gratuit — 24 h » (aucun accès n'est délivré automatiquement en
 * 24 h par mailto) — d'où la requalification du libellé et le passage au
 * WhatsApp en canal principal.
 */
export const ESSAI_GRATUIT_SUBJECT = 'Demande d’essai GEOFAM';
export const ESSAI_GRATUIT_HREF = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(ESSAI_GRATUIT_SUBJECT)}`;

// ---------------------------------------------------------------------------
// Domaine des 6 logiciels (CH/FD/LB) — pour DomainTag sur la grille §4.
//
// software-catalog.ts (client-safe, partagé avec l'app authentifiée) ne porte
// pas ce champ : on l'ajoute localement plutôt que d'étendre un module déjà
// consommé ailleurs, pour ne pas élargir son périmètre sans nécessité.
// Mapping dérivé de la sémantique réelle des moteurs (mémoire
// geosuite-engine-mapping) :
//  - roadsens (burmister)   → chaussées (CH)
//  - terzaghi                → fondations superficielles (FD)
//  - casagrande (pieux)      → fondations profondes (FD)
//  - geoplaque (radier)      → fondations (FD)
//  - pressiopro (pressiomètre) → essai in situ nourrissant le dimensionnement
//    de fondations, pas un essai de laboratoire → (FD)
//  - fastlab (labo GTR)      → laboratoire (LB)
// ---------------------------------------------------------------------------

export const SOFTWARE_DOMAIN: Record<string, Domain> = {
  roadsens: 'road',
  terzaghi: 'foundation',
  casagrande: 'foundation',
  geoplaque: 'foundation',
  pressiopro: 'foundation',
  fastlab: 'lab',
};

export function domainForSoftware(entry: SoftwareEntry): Domain | null {
  return SOFTWARE_DOMAIN[entry.id] ?? null;
}
