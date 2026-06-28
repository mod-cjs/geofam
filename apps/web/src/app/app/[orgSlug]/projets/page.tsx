import type { Metadata } from 'next';
import ProjetsClient from './ProjetsClient';

export const metadata: Metadata = {
  title: 'Mes projets — ROADSEN',
};

interface Props {
  params: Promise<{ orgSlug: string }>;
}

export default async function ProjetsPage({ params }: Props) {
  const { orgSlug } = await params;
  return <ProjetsClient orgSlug={orgSlug} />;
}
