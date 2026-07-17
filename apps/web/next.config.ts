import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /* config options here */
  // distDir override par env (défaut inchangé) : permet de lancer un 2e serveur dev
  // isolé (spec de fidélité, port 3101) SANS entrer en conflit avec le verrou dev
  // Next 16 d'un serveur déjà lancé sur le même dossier. Transitoire (tests).
  ...(process.env.ROADSEN_DISTDIR ? { distDir: process.env.ROADSEN_DISTDIR } : {}),
};

export default nextConfig;
