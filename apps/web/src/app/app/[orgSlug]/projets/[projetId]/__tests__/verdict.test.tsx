/**
 * Tests — verdict.tsx (rendu commun CONFORME / NON CONFORME / NON APPLICABLE).
 *
 * Contexte (correction titulaire) : le code historique ne connaissait que
 * deux verdicts et masquait purement et simplement le troisième (NA) —
 * jamais rendu comme un échec, mais absent, ce qui est tout aussi faux sur un
 * livrable : un cas NON APPLICABLE réel (ex. PV-000004, radier) disparaissait
 * de l'écran. Ce fichier verrouille les trois états ET l'ADR 0008 (rouge/vert
 * réservés aux verdicts, NA neutre).
 *
 * DoD §9 : given/when/then, zéro faux-vert.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { VerdictTag, extractVerdict, type Verdict } from '../verdict';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

function monter(verdict: Verdict, compact?: boolean) {
  act(() => {
    root.render(<VerdictTag verdict={verdict} compact={compact} />);
  });
  return container.querySelector('span') as HTMLSpanElement;
}

describe('extractVerdict — lecture défensive de la sortie moteur', () => {
  it('given une sortie {verdict: "PASS"} — when extrait — then retourne "PASS"', () => {
    expect(extractVerdict({ verdict: 'PASS' })).toBe('PASS');
  });

  it('given une sortie {verdict: "NA"} — when extrait — then retourne "NA" (pas masqué)', () => {
    expect(extractVerdict({ verdict: 'NA' })).toBe('NA');
  });

  it('given une sortie null (calcul pas encore terminé) — when extrait — then retourne undefined', () => {
    expect(extractVerdict(null)).toBeUndefined();
  });

  it('given une sortie sans champ verdict — when extrait — then retourne undefined', () => {
    expect(extractVerdict({})).toBeUndefined();
  });

  it('given une valeur de verdict inattendue — when extrait — then retourne undefined (jamais un verdict inventé)', () => {
    expect(extractVerdict({ verdict: 'AUTRE_CHOSE' })).toBeUndefined();
  });
});

describe('VerdictTag — triple redondance ADR 0008 (couleur + icône + libellé)', () => {
  it('given PASS — when rendu — then libellé CONFORME, icône et aria-label présents', () => {
    const el = monter('PASS');
    expect(el.textContent).toContain('CONFORME');
    expect(el.querySelector('svg')).not.toBeNull();
    expect(el.getAttribute('aria-label')).toBe('Verdict : CONFORME');
  });

  it('given FAIL en mode compact — when rendu — then libellé abrégé « NON CONF. »', () => {
    const el = monter('FAIL', true);
    expect(el.textContent).toContain('NON CONF.');
  });

  it('given FAIL en mode complet — when rendu — then libellé « NON CONFORME »', () => {
    const el = monter('FAIL', false);
    expect(el.textContent).toContain('NON CONFORME');
  });

  it('given NA — when rendu — then libellé « NON APPLICABLE », jamais masqué', () => {
    const el = monter('NA');
    expect(el.textContent).toContain('NON APPLICABLE');
    expect(el.getAttribute('aria-label')).toBe('Verdict : NON APPLICABLE');
  });

  it('given NA en mode compact — when rendu — then libellé abrégé « NON APPLIC. »', () => {
    const el = monter('NA', true);
    expect(el.textContent).toContain('NON APPLIC.');
  });

  it('given NA — when rendu — then AUCUN token de verdict (vert/rouge) n’est utilisé (ADR 0008 : NA est neutre)', () => {
    const el = monter('NA');
    expect(el.style.cssText).not.toContain('--status-pass');
    expect(el.style.cssText).not.toContain('--status-fail');
  });

  it('given PASS/FAIL — when rendus — then chacun utilise SON propre token de verdict (jamais l’un pour l’autre)', () => {
    const pass = monter('PASS');
    expect(pass.style.cssText).toContain('--status-pass-tx');
    expect(pass.style.cssText).not.toContain('--status-fail');

    const fail = monter('FAIL');
    expect(fail.style.cssText).toContain('--status-fail-tx');
    expect(fail.style.cssText).not.toContain('--status-pass');
  });
});
