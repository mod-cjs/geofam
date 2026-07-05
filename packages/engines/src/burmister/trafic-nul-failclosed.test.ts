/**
 * Securite (passe de VERIFICATION adverse) — faux PASS via TRAFIC NUL (NE=0).
 *
 * FAILLE trouvee (HAUTE) : le bornage r/sh/ks fermait UN vecteur d'inflation de
 * l'admissible de fatigue, mais le MEME objectif (empecher un verdict `conforme`
 * falsifie scelle au PV) restait contournable par un AUTRE parametre client : le
 * TRAFIC. NE = 365·T·C·CAM·dir·tv ; T=0 (ou CAM/dir/tv=0) -> NE=0 ->
 *   ez_adm = A·NE^(-1/4,5) = pow(0,-x) = +Infinity
 *   et_adm = e6·pow(1e6/NE, 1/b) = +Infinity
 * Le moteur coerce alors l'admissible en 0/null (fin()), MAIS passZ/passT restent
 * true (val <= Infinity) -> `conforme=true` avec un admissible affiche a 0 : un FAUX
 * PASS scellable dans un PV.
 *
 * Correctif (couche software, pas la science) : shapeOutput refuse fail-closed quand
 * un admissible REQUIS est non fini -> renvoie une ERREUR (le verdict n'est pas defini
 * pour un trafic nul), jamais un verdict conforme.
 */

import { describe, it, expect } from 'vitest';

import { BURMISTER_FIXTURES } from './test-fixtures.js';
import { runBurmister } from './index.js';

const BASE = BURMISTER_FIXTURES[0]!.input as Record<string, unknown>;
const traffic = BASE.traffic as Record<string, unknown>;

describe('burmister — trafic nul (NE=0) : fail-closed, jamais de faux PASS', () => {
  it('T=0 -> ERREUR (verdict non defini), jamais conforme', () => {
    const env = runBurmister({ ...BASE, traffic: { ...traffic, T: 0 } });
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    const o = env.output as { erreur: string | null; conforme: boolean; ornierage: { ok: boolean } };
    expect(o.conforme).toBe(false); // JAMAIS un faux PASS
    expect(typeof o.erreur).toBe('string'); // erreur explicite (trafic invalide)
    expect(o.ornierage.ok).toBe(false);
  });

  it('CAM (C) = 0 -> meme protection (NE=0 par un autre facteur)', () => {
    const env = runBurmister({ ...BASE, traffic: { ...traffic, C: 0 } });
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    const o = env.output as { erreur: string | null; conforme: boolean };
    expect(o.conforme).toBe(false);
    expect(typeof o.erreur).toBe('string');
  });

  it('le trafic NOMINAL (fixture) reste CALCULE normalement (aucun faux positif)', () => {
    const env = runBurmister(BASE);
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    const o = env.output as { erreur: string | null };
    expect(o.erreur).toBeNull(); // NE > 0 -> calcul normal, pas d'erreur
  });
});
