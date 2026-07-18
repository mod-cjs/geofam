import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /* config options here */
  // distDir override par env (défaut inchangé) : permet de lancer un 2e serveur dev
  // isolé (spec de fidélité, port 3101) SANS entrer en conflit avec le verrou dev
  // Next 16 d'un serveur déjà lancé sur le même dossier. Transitoire (tests).
  ...(process.env.ROADSEN_DISTDIR ? { distDir: process.env.ROADSEN_DISTDIR } : {}),

  // Service worker (installabilité PWA — cf. public/sw.js, app/manifest.ts) :
  // jamais mis en cache lui-même (sinon une mise à jour ne se propage pas),
  // et Service-Worker-Allowed confirme explicitement le scope racine.
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ];
  },
};

export default nextConfig;
