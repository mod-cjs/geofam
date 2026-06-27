/**
 * Page galerie design system ROADSEN
 * Route : /design-system
 *
 * Server Component shell — tout le contenu interactif est dans GalleryContent (Client)
 */

import { GalleryContent } from "./GalleryContent";

export const metadata = {
  title: "Design System — ROADSEN",
};

export default function DesignSystemPage() {
  return <GalleryContent />;
}
