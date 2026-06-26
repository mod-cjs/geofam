/**
 * Page de test moteurs ROADSEN — surface recette stateless.
 *
 * Route : /recette
 *
 * Server Component (App Router). Toute l'interactivité (saisie, POST, résultat)
 * est déléguée au Client Component RecetteClient.
 *
 * CONFIDENTIALITÉ DoD §8 : cette page n'importe rien de @roadsen/engines.
 * Les descripteurs de formulaire (engine-descriptors.ts) sont des métadonnées
 * statiques client-safe, sans formule ni symbole de calcul.
 */
import type { Metadata } from 'next';

import RecetteClient from './RecetteClient';

export const metadata: Metadata = {
  title: 'Test moteurs — ROADSEN Recette',
  description:
    'Interface de test des moteurs de calcul géotechnique ROADSEN (surface recette).',
};

export default function RecettePage() {
  const apiBaseUrl =
    process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

  return <RecetteClient apiBaseUrl={apiBaseUrl} />;
}
