/**
 * /app → redirige vers la 1re organisation de l'utilisateur (`/app/{slug}`),
 * ou vers `/admin` s'il n'appartient à aucune org (cas SUPERADMIN pur — le
 * lien "Retour à l'app" de AdminTopbar pointe ici en dur).
 *
 * Sans profil résolu (pas de token / session expirée / backend indisponible),
 * on repart vers /login. Server Component : lecture via le token cookie
 * (cf. lib/api/app-server.ts), aucun gestionnaire d'événement ici.
 */

import { redirect } from 'next/navigation';

import { getMyProfile } from '@/lib/api/app-server';

export default async function AppRootPage() {
  const profile = await getMyProfile();

  if (!profile) {
    redirect('/login');
  }

  const firstOrg = profile.memberships[0];
  if (firstOrg) {
    redirect(`/app/${firstOrg.orgSlug}`);
  }

  // Aucune org (SUPERADMIN pur, ou compte fraîchement créé) : back-office.
  redirect('/admin');
}
