/**
 * Ancienne route /overview (maquette finale, écran 2) : « Vue d'ensemble »
 * disparaît en tant qu'onglet — décision titulaire. Elle n'était jamais la
 * page d'arrivée (redirect() de la racine du projet visait déjà /calculs,
 * cf. ../page.tsx), redoublait les onglets dédiés, et son tri des « 3
 * derniers » affichait en réalité les trois plus ANCIENS (bug corrigé puis
 * devenu sans objet avec la page elle-même).
 *
 * Des liens et des signets vers /overview existent : plutôt qu'un 404, on
 * redirige vers l'onglet Calculs, même patron que la racine du projet (F-02).
 */

import { redirect } from 'next/navigation';

interface Props {
  params: Promise<{ orgSlug: string; projetId: string }>;
}

export default async function OverviewPage({ params }: Props) {
  const { orgSlug, projetId } = await params;
  redirect(`/app/${orgSlug}/projets/${projetId}/calculs`);
}
