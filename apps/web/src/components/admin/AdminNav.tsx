'use client';

/**
 * AdminNav — compose AdminTopbar + AdminSidebar avec un état mobileOpen
 * partagé (bouton hamburger topbar <-> drawer sidebar), même patron que la
 * Sidebar tenant : fermeture sur navigation, inert/aria-hidden du main
 * pendant que le drawer est ouvert, fermeture ESC.
 */

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { AdminSidebar } from './AdminSidebar';
import { AdminTopbar } from './AdminTopbar';

export function AdminNav() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  // Fermer le drawer mobile sur navigation.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Gérer l'inert sur le main au drawer mobile.
  useEffect(() => {
    const main = document.getElementById('admin-main');
    if (main) {
      if (mobileOpen) {
        main.setAttribute('inert', '');
        main.setAttribute('aria-hidden', 'true');
      } else {
        main.removeAttribute('inert');
        main.removeAttribute('aria-hidden');
      }
    }
    return () => {
      const m = document.getElementById('admin-main');
      if (m) {
        m.removeAttribute('inert');
        m.removeAttribute('aria-hidden');
      }
    };
  }, [mobileOpen]);

  // ESC ferme le drawer.
  useEffect(() => {
    if (!mobileOpen) return;
    function handleKey(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') setMobileOpen(false);
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [mobileOpen]);

  return (
    <>
      <AdminTopbar mobileOpen={mobileOpen} onMenuToggle={() => setMobileOpen((v) => !v)} />
      <AdminSidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />
    </>
  );
}
