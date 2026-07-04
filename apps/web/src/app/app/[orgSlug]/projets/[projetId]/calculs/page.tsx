import type { Metadata } from 'next';
import CalculsClient from './CalculsClient';

export const metadata: Metadata = {
  title: 'Calculs — GEOFAM',
};

interface Props {
  params: Promise<{ orgSlug: string; projetId: string }>;
}

export default async function CalculsPage({ params }: Props) {
  const { orgSlug, projetId } = await params;
  return <CalculsClient orgSlug={orgSlug} projetId={projetId} />;
}
