import type { ReactNode } from 'react';

/**
 * Layout du groupe (auth) — /login (et futures routes d'authentification).
 *
 * data-theme="dark" scope la palette maquette (cf. globals.css §2) à ces
 * routes, à l'identique de l'app authentifiée (`/app/[orgSlug]/layout.tsx`).
 * Sans effet visible aujourd'hui sur `/login` : LoginClient utilise déjà ses
 * propres constantes de couleur alignées sur la même maquette, pas les
 * tokens CSS — ce wrapper prépare une future migration vers les tokens.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  // min-height + background dark : même traitement anti-FOUC que le shell
  // authentifié (cf. app/[orgSlug]/layout.tsx) — body reste clair (--surface-canvas
  // du thème :root) hors de ce wrapper, pour /admin et la landing.
  return (
    <div
      data-theme="dark"
      style={{ minHeight: '100vh', background: 'var(--surface-canvas)' }}
    >
      {children}
    </div>
  );
}
