/**
 * Index d'organisation : /app/[orgSlug] → tableau de bord.
 *
 * Avant ce lot, cette route redirigeait vers /projets (pas de vue de
 * synthèse). Le dashboard devient la vraie page d'accueil du bureau ;
 * la navigation « Accueil » de la sidebar pointe désormais ici (la galerie
 * des 6 logiciels reste accessible via /logiciels, cf. section Logiciels
 * du dashboard).
 */

import type { Metadata } from 'next';
import DashboardClient from './DashboardClient';

export const metadata: Metadata = {
  title: 'Tableau de bord — GEOFAM',
};

interface Props {
  params: Promise<{ orgSlug: string }>;
}

export default async function OrgIndexPage({ params }: Props) {
  const { orgSlug } = await params;
  return <DashboardClient orgSlug={orgSlug} />;
}
