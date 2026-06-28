/**
 * RESOLUTION DES FONTES pdfmake EN NODE (#63, incr. C) — le piege classique.
 *
 * pdfmake côté serveur (`PdfPrinter`) attend des `fontDescriptors` : pour chaque
 * style (normal/bold/italics/bolditalics), soit un CHEMIN ttf, soit un BUFFER de
 * données de fonte. La 0.2.x N'EMBARQUE PAS de .ttf sur disque — les Roboto sont
 * dans `build/vfs_fonts.js` (système de fichiers virtuel, base64). On décode donc
 * ces base64 en Buffers et on les passe directement au PdfPrinter :
 *   - aucun accès disque (robuste au bundling / au répertoire de travail) ;
 *   - aucune dépendance Chromium ;
 *   - déterministe (mêmes octets de fonte à chaque rendu).
 *
 * NB : Roboto 0.2.x ne fournit pas de Roboto-Bold dédié -> on mappe `bold` sur
 * Roboto-Medium (convention pdfmake). C'est le comportement par défaut de la lib.
 */
// pdfmake 0.2.x : l'export par defaut EST le constructeur PdfPrinter.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import PdfPrinter = require('pdfmake');

/** Map { 'Roboto-Regular.ttf': base64, ... }. Selon la version, l'export est
 *  direct ou enveloppe (pdfMake.vfs / .vfs). On normalise les deux formes. */
function loadVfs(): Record<string, string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('pdfmake/build/vfs_fonts.js') as
    | Record<string, string>
    | {
        pdfMake?: { vfs?: Record<string, string> };
        vfs?: Record<string, string>;
      };
  const wrapped = mod as {
    pdfMake?: { vfs?: Record<string, string> };
    vfs?: Record<string, string>;
  };
  if (wrapped.pdfMake?.vfs) return wrapped.pdfMake.vfs;
  if (wrapped.vfs) return wrapped.vfs;
  return mod as Record<string, string>;
}

function fontBuffer(vfs: Record<string, string>, file: string): Buffer {
  const b64 = vfs[file];
  if (!b64) {
    throw new Error(
      `Fonte pdfmake introuvable dans le vfs : ${file} (résolution Roboto Node).`,
    );
  }
  return Buffer.from(b64, 'base64');
}

/**
 * Construit un `PdfPrinter` Roboto prêt à l'emploi (fontes en Buffers). Singleton
 * paresseux : la décodage base64 des 4 Roboto ne se fait qu'une fois par process.
 */
let printerSingleton: InstanceType<typeof PdfPrinter> | null = null;

export function getPvPrinter(): InstanceType<typeof PdfPrinter> {
  if (printerSingleton) return printerSingleton;
  const vfs = loadVfs();
  const fonts = {
    Roboto: {
      normal: fontBuffer(vfs, 'Roboto-Regular.ttf'),
      bold: fontBuffer(vfs, 'Roboto-Medium.ttf'),
      italics: fontBuffer(vfs, 'Roboto-Italic.ttf'),
      bolditalics: fontBuffer(vfs, 'Roboto-MediumItalic.ttf'),
    },
    // Courier = fonte STANDARD PDF (les 14 fontes intégrées) : on l'utilise pour
    // l'empreinte SHA-256 (rendu monospace). PDFKit la connaît par son nom
    // standard, sans fichier ttf -> on passe le NOM standard comme descripteur.
    Courier: {
      normal: 'Courier',
      bold: 'Courier-Bold',
      italics: 'Courier-Oblique',
      bolditalics: 'Courier-BoldOblique',
    },
  };
  printerSingleton = new PdfPrinter(fonts);
  return printerSingleton;
}
