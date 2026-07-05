/**
 * /admin → redirect /admin/orgs (entrée du back-office).
 */

import { redirect } from 'next/navigation';

export default function AdminRootPage() {
  redirect('/admin/orgs');
}
