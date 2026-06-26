import { redirect } from 'next/navigation';

/**
 * Page d'accueil — redirige vers la page de test moteurs (/recette).
 * La home définitive sera construite au jalon UI complet.
 */
export default function Home() {
  redirect('/recette');
}
