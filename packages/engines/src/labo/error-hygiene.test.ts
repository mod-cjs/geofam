/**
 * Hygiene d'erreur (audit adverse) — defense en profondeur.
 *
 * Le chemin d'erreur labo partageait le pattern vulnerable de pressiometre
 * (`redactConfidentialWarning(R.err)` ne neutralise pas une exception JS brute).
 * Sur labo la fuite est LATENTE (moteur robuste : aucun input degenere teste ne
 * leve d'exception), mais la MEME classe de fuite etait CONFIRMEE sur pressiometre.
 * On ferme le gap par parite : `sanitizeEngineError` remplace toute signature
 * d'exception technique par un message generique, et laisse passer les messages de
 * domaine (redactes des valeurs confidentielles).
 */

import { describe, it, expect } from 'vitest';

import { sanitizeEngineError } from './index.js';

describe('labo — sanitizeEngineError (anti-fuite exception JS)', () => {
  it('neutralise une exception JS interne', () => {
    for (const js of [
      "Cannot read properties of undefined (reading 'p')",
      'x is not a function',
      'TypeError: cannot access before initialization',
      "reading 'length' of null",
    ]) {
      const out = sanitizeEngineError(js);
      expect(out).not.toMatch(/cannot read|undefined|reading '|is not a function|typeerror/i);
      expect(out.length).toBeGreaterThan(0);
    }
  });

  it('laisse passer une erreur de DOMAINE (message metier FR)', () => {
    const dom = 'Masse granulometrique totale non renseignee.';
    expect(sanitizeEngineError(dom)).toBe(dom);
  });
});
