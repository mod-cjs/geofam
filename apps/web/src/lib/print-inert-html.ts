/**
 * Impression d'un document HTML INERTE (option 3 — scellement du document que
 * l'outil produit) via une iframe cachée.
 *
 * Le HTML imprimé (`printHtml`/document PV) est garanti sans <script>, sans
 * gestionnaire d'événement inline et sans URI `javascript:` par la garde §8
 * côté serveur (`assertInertHtml`, cf. apps/api/src/pv/html-guard.ts) — il n'y
 * a donc STRUCTURELLEMENT rien à exécuter dans ce document.
 *
 * `sandbox="allow-same-origin allow-modals"` (SANS `allow-scripts`) :
 * - `allow-same-origin` : nécessaire pour que `contentWindow.print()` soit
 *   appelable depuis ce module — un iframe totalement sandboxé (`sandbox=""`)
 *   obtient une origine opaque, ce qui rend `contentWindow.print()`
 *   inaccessible depuis le parent (SecurityError).
 * - `allow-modals` : sans ce jeton, Chromium/Firefox ignorent silencieusement
 *   l'appel à `print()` depuis un document sandboxé (« Ignored call to
 *   'print()'. The document is sandboxed, and the 'allow-modals' keyword is
 *   not set. ») — la boîte de dialogue d'impression est une modale native.
 * Sans le jeton `allow-scripts`, aucun script ne peut de toute façon
 * s'exécuter à l'intérieur — l'appel de fonctions comme `print()` reste
 * possible depuis L'EXTÉRIEUR (ce module), et `allow-modals` n'autorise que la
 * boîte d'impression elle-même (aucun script ne tourne dans la frame pour en
 * abuser).
 */
export function printInertHtml(html: string): void {
  if (typeof document === 'undefined') return;

  const iframe = document.createElement('iframe');
  iframe.setAttribute('sandbox', 'allow-same-origin allow-modals');
  iframe.setAttribute('aria-hidden', 'true');
  // CAUSE RACINE des « pages vierges » (corrigée) : une iframe `width:0` donne un bloc
  // conteneur initial de 0 px au document imprimé. Un document dont la largeur n'est que
  // `max-width` (sans `width`) — cas de la note Terzaghi (.note{max-width:860px}), et
  // potentiellement d'autres moteurs sans largeur explicite (roadsens, fastlab…) —
  // s'effondre alors à 0 : le texte s'enroule sur des milliers de px, générant une
  // dizaine de colonnes fines quasi vides à l'impression. On donne à l'iframe une VRAIE
  // largeur de page A4 (210mm), positionnée HORS ÉCRAN (`left:-10000px`) plutôt que
  // `width:0` : le layout d'impression dispose d'un bloc conteneur plein, quel que soit
  // le document. `visibility:hidden` + hors-flux conservent l'invisibilité à l'écran ; la
  // sandbox (sans `allow-scripts`) est inchangée.
  iframe.style.position = 'fixed';
  iframe.style.left = '-10000px';
  iframe.style.top = '0';
  iframe.style.width = '210mm';
  iframe.style.height = '297mm';
  iframe.style.border = 'none';
  iframe.style.visibility = 'hidden';

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    iframe.remove();
  };

  iframe.addEventListener(
    'load',
    () => {
      const win = iframe.contentWindow;
      if (!win) {
        cleanup();
        return;
      }
      try {
        win.focus();
        win.print();
      } finally {
        // Laisser le temps au dialogue d'impression natif de s'ouvrir avant de
        // retirer l'iframe (certains navigateurs annulent l'impression si le
        // frame source disparaît immédiatement). `afterprint` nettoie plus tôt
        // quand le navigateur le déclenche ; le timeout est le filet de sécurité.
        win.addEventListener('afterprint', cleanup, { once: true });
        setTimeout(cleanup, 5000);
      }
    },
    { once: true },
  );

  iframe.srcdoc = html;
  document.body.appendChild(iframe);
}
