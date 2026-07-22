/**
 * Ancienne route /infos (maquette finale, écran 2/3) : « Informations »
 * disparaît en tant qu'onglet — décision titulaire. Contenu réel vérifié
 * avant retrait (cf. tests) :
 *  - renommage -> déjà un point d'entrée sur la liste des projets (P0-7,
 *    renommage en ligne) ;
 *  - archivage/suppression -> déjà un point d'entrée sur la liste des
 *    projets (menu d'actions, écran 1) ;
 *  - domaine -> déjà affiché dans la bande projet (DomainTag).
 * Identifiant technique et dates de création/modification n'ont, eux, plus
 * d'affichage dédié après ce retrait (aucune AUTRE action n'en dépendait —
 * signalé au commanditaire, pas bloquant au sens du brief).
 *
 * Des liens et des signets vers /infos existent : plutôt qu'un 404, on
 * redirige vers l'onglet Calculs, même patron que /overview et la racine du
 * projet (F-02).
 */

import { redirect } from 'next/navigation';

interface Props {
  params: Promise<{ orgSlug: string; projetId: string }>;
}

export default async function InfosPage({ params }: Props) {
  const { orgSlug, projetId } = await params;
  redirect(`/app/${orgSlug}/projets/${projetId}/calculs`);
}
