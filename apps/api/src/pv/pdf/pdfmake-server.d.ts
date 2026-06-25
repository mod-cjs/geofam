/**
 * Déclaration de types pour l'API SERVEUR de pdfmake 0.2.x.
 *
 * `@types/pdfmake` (0.3.x) ne type que l'API navigateur/isomorphe (createPdf…).
 * Côté serveur on utilise la classe `PdfPrinter` (export par défaut CommonJS de
 * `pdfmake` en 0.2.x) + le système de fichiers virtuel `build/vfs_fonts.js`. On
 * déclare ici le strict nécessaire (constructeur + createPdfKitDocument).
 */
declare module 'pdfmake' {
  import type { TDocumentDefinitions } from 'pdfmake/interfaces';

  /** Descripteur de fontes : chemin ttf OU Buffer de données par style. */
  interface FontStyleDescriptor {
    normal: string | Buffer;
    bold: string | Buffer;
    italics: string | Buffer;
    bolditalics: string | Buffer;
  }
  type FontDescriptors = Record<string, FontStyleDescriptor>;

  /** Document PDFKit en flux (events 'data'/'end'/'error', .end()). */
  interface PdfKitDocument {
    on(event: 'data', listener: (chunk: Buffer) => void): void;
    on(event: 'end', listener: () => void): void;
    on(event: 'error', listener: (err: Error) => void): void;
    end(): void;
  }

  class PdfPrinter {
    constructor(fonts: FontDescriptors);
    createPdfKitDocument(docDefinition: TDocumentDefinitions): PdfKitDocument;
  }

  export = PdfPrinter;
}

declare module 'pdfmake/build/vfs_fonts.js' {
  // Selon la version : map directe { 'Roboto-Regular.ttf': base64 } ou wrappée.
  const vfs: Record<string, string> & {
    pdfMake?: { vfs?: Record<string, string> };
    vfs?: Record<string, string>;
  };
  export = vfs;
}
