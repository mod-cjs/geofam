/**
 * /admin/users/[userId] — fiche détaillée d'un utilisateur (SUPERADMIN-only).
 * Server Component : fetch initial (cookie). Partie interactive extraite dans
 * UserDetailClient (Client Component — crash SSR si des gestionnaires
 * d'événements restent dans un Server Component, cf. patron OrgDetailClient).
 */

import { notFound } from 'next/navigation';

import { UserDetailClient } from '@/components/admin/UserDetailClient';
import { adminGetUser } from '@/lib/api/admin-server';

interface UserDetailPageProps {
  params: Promise<{ userId: string }>;
}

export const metadata = { title: 'Utilisateur — Back-office' };

export default async function UserDetailPage({ params }: UserDetailPageProps) {
  const { userId } = await params;
  const user = await adminGetUser(userId);
  if (!user) notFound();

  return <UserDetailClient user={user} />;
}
