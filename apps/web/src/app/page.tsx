import { redirect } from 'next/navigation';

/**
 * Redirect racine — géré par le middleware (D-23 ADR 0010).
 * Ce composant n'est atteint que si le middleware ne tourne pas (build statique, etc.).
 */
export default function Home() {
  redirect('/login');
}
