/**
 * Index d'organisation : /app/[orgSlug] → redirige vers la liste des projets.
 * Évite un 404 sur la racine d'org (accès direct / lien sans sous-chemin).
 */

import { redirect } from 'next/navigation';

interface Props {
  params: Promise<{ orgSlug: string }>;
}

export default async function OrgIndexPage({ params }: Props) {
  const { orgSlug } = await params;
  redirect(`/app/${orgSlug}/projets`);
}
