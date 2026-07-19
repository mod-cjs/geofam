/**
 * Tests — printInertHtml (impression du document inerte capturé, option 3).
 *
 * DoD §9 : given/when/then. Le document imprimé étant garanti sans script par
 * la garde §8 serveur, on prouve ici uniquement le contrat DOM local : iframe
 * cachée + sandbox restrictif + srcdoc posé + print() déclenché au chargement
 * + nettoyage après impression.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

import { printInertHtml } from '../print-inert-html';

afterEach(() => {
  document.querySelectorAll('iframe').forEach((f) => f.remove());
});

describe('printInertHtml', () => {
  it('given un HTML inerte, when appelé, then une iframe cachée sandboxée (sans allow-scripts) est ajoutée avec le contenu en srcdoc', () => {
    printInertHtml('<p>Document imprimable</p>');
    const iframe = document.body.querySelector('iframe');
    expect(iframe).not.toBeNull();
    expect(iframe!.getAttribute('sandbox')).toBe('allow-same-origin');
    expect(iframe!.getAttribute('sandbox')).not.toContain('allow-scripts');
    expect(iframe!.srcdoc).toBe('<p>Document imprimable</p>');
  });

  it("given une iframe chargée, when l'événement load se déclenche, then contentWindow.print() est appelé", () => {
    printInertHtml('<p>Document imprimable</p>');
    const iframe = document.body.querySelector('iframe')!;
    const printSpy = vi
      .spyOn(iframe.contentWindow as Window, 'print')
      .mockImplementation(() => {});

    iframe.dispatchEvent(new Event('load'));

    expect(printSpy).toHaveBeenCalledOnce();
  });

  it("given une impression terminée, when 'afterprint' se déclenche sur la fenêtre imprimée, then l'iframe est retirée du DOM", () => {
    printInertHtml('<p>Document imprimable</p>');
    const iframe = document.body.querySelector('iframe')!;
    vi.spyOn(iframe.contentWindow as Window, 'print').mockImplementation(() => {});

    iframe.dispatchEvent(new Event('load'));
    expect(document.body.querySelector('iframe')).not.toBeNull();

    iframe.contentWindow!.dispatchEvent(new Event('afterprint'));
    expect(document.body.querySelector('iframe')).toBeNull();
  });
});
