/**
 * F-02 (TRANCHÉ) : /projets/[projetId] → redirect vers l'onglet Calculs par défaut.
 */

import { redirect } from 'next/navigation';

interface Props {
  params: Promise<{ orgSlug: string; projetId: string }>;
}

export default async function ProjetPage({ params }: Props) {
  const { orgSlug, projetId } = await params;
  redirect(`/app/${orgSlug}/projets/${projetId}/calculs`);
}
