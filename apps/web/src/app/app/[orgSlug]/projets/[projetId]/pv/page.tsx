import type { Metadata } from 'next';

import PvListClient from './PvListClient';

export const metadata: Metadata = {
  title: 'PV scellés — GEOFAM',
};

interface Props {
  params: Promise<{ orgSlug: string; projetId: string }>;
}

export default async function PvPage({ params }: Props) {
  const { orgSlug, projetId } = await params;
  return <PvListClient orgSlug={orgSlug} projetId={projetId} />;
}
