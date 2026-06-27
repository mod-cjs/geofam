/**
 * B-10 — Layout espace projet
 * Bande 44px + onglets : Vue d'ensemble / Calculs / PV & Livrables / Informations
 * Onglet actif = underline pétrole (pas latérite)
 */

import type { ReactNode } from 'react';
import ProjetLayoutClient from './ProjetLayoutClient';

interface ProjetLayoutProps {
  children: ReactNode;
  params: Promise<{ orgSlug: string; projetId: string }>;
}

export default async function ProjetLayout({ children, params }: ProjetLayoutProps) {
  const { orgSlug, projetId } = await params;

  return (
    <ProjetLayoutClient orgSlug={orgSlug} projetId={projetId}>
      {children}
    </ProjetLayoutClient>
  );
}
