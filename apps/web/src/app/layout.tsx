import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { ServiceWorkerRegistrar } from '@/components/shell/ServiceWorkerRegistrar';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  display: 'swap',
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
  weight: ['400', '500'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'GEOFAM',
  description: 'Suite géotechnique — plateforme de calcul géotechnique & routier',
  // manifest.webmanifest (app/manifest.ts) et l'icône Apple (app/apple-icon.png)
  // sont détectés par convention de fichier — pas besoin de les redéclarer ici.
  appleWebApp: {
    capable: true,
    title: 'GEOFAM',
    statusBarStyle: 'black-translucent',
  },
};

// L'app ne suit pas prefers-color-scheme (bascule clair/sombre = toggle
// explicite, cf. globals.css §2) : une seule couleur de chrome, alignée sur
// --surface-nav (barre toujours visible), pas de paire clair/sombre.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#22262b',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="fr"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
