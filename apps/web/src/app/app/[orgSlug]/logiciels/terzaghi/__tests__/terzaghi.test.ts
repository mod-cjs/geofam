/**
 * Tests — page Terzaghi (fondations superficielles, NF P 94-261 / EC7).
 *
 * DoD §9 : given/when/then, chemins nominaux + bords.
 * DoD §8 : `buildTerzaghiPayload` est PUR (aucun import @roadsen/engines) et ne
 *          produit QUE les entrées bornées du contrat — aucun coefficient ni
 *          grandeur de calcul ne peut fuiter par le payload côté navigateur.
 */

import { describe, it, expect } from 'vitest';

import { buildTerzaghiPayload, type TerzaghiForm } from '../page';

// Fixture de saisie type (semelle carrée, argile, pressiomètre).
function form(over: Partial<TerzaghiForm> = {}): TerzaghiForm {
  return {
    projet: 'Ouvrage A12',
    forme: 'carree', B: '2', L: '2', D: '1', beton: 'coule',
    solCat: 'argiles', c: '', phi: '', eYoung: '', nuSol: '0.33', nappe: '',
    gAvant: '20', gApres: '20', gSous: '',
    cphiOn: false, cphiMode: 'auto', talusOn: false, beta: '', dTalus: '', talusDir: 'ext',
    profilMode: 'essais', alphaSang: '', essai: 'pressio',
    sondage: [{ z: '1', pl: '0.8', em: '8', al: '', qc: '' }],
    charges: [{ etat: 'ELU_F', fz: '900', fx: '', fy: '', mx: '', my: '' }],
    ...over,
  };
}

describe('buildTerzaghiPayload — structure & dérivations', () => {
  it('given une semelle carrée, when payload, then L est dérivé de B', () => {
    // GIVEN une semelle carrée B=2 (L saisi ignoré)
    const p = buildTerzaghiPayload(form({ forme: 'carree', B: '2', L: '9' }));
    // THEN L reprend B (une carrée n'a pas de longueur propre)
    expect(p.B).toBe('2');
    expect(p.L).toBe('2');
  });

  it('given une semelle rectangulaire, when payload, then L saisi est conservé', () => {
    const p = buildTerzaghiPayload(form({ forme: 'rect', B: '2', L: '5' }));
    expect(p.L).toBe('5');
  });

  it('mappe le sondage sur les seuls champs bornés {z,pl,em,al,qc}', () => {
    const p = buildTerzaghiPayload(form());
    expect(p.sondage).toEqual([{ z: '1', pl: '0.8', em: '8', al: '', qc: '' }]);
  });

  it('mappe les charges sur {etat,fz,fx,fy,mx,my} en conservant l’état-limite', () => {
    const p = buildTerzaghiPayload(form({ charges: [{ etat: 'ELS_C', fz: '650', fx: '10', fy: '', mx: '', my: '20' }] }));
    expect(p.charges).toEqual([{ etat: 'ELS_C', fz: '650', fx: '10', fy: '', mx: '', my: '20' }]);
  });

  it('transmet les options avancées (c-φ, talus, profil, α)', () => {
    const p = buildTerzaghiPayload(form({ cphiOn: true, cphiMode: 'nd', talusOn: true, beta: '20', talusDir: 'int', profilMode: 'couches', alphaSang: '2' }));
    expect(p).toMatchObject({ cphiOn: true, cphiMode: 'nd', talusOn: true, beta: '20', talusDir: 'int', profilMode: 'couches', alphaSang: '2' });
  });
});

describe('buildTerzaghiPayload — DoD §8 (payload = entrées bornées uniquement)', () => {
  // Liste EXHAUSTIVE des clés autorisées (= entrées du contrat). Toute clé hors
  // de cet ensemble = fuite potentielle → le test échoue (fail-closed).
  const ALLOWED = new Set([
    'projet', 'forme', 'B', 'L', 'D', 'beton', 'solCat', 'c', 'phi', 'eYoung', 'nuSol', 'nappe',
    'gAvant', 'gApres', 'gSous', 'cphiOn', 'cphiMode', 'talusOn', 'beta', 'dTalus', 'talusDir',
    'profilMode', 'alphaSang', 'essai', 'sondage', 'charges',
  ]);

  it('ne produit aucune clé hors du contrat d’entrée', () => {
    const p = buildTerzaghiPayload(form());
    for (const k of Object.keys(p)) {
      expect(ALLOWED.has(k), `clé inattendue dans le payload : ${k}`).toBe(true);
    }
  });

  it('ne contient aucune grandeur de RÉSULTAT / coefficient de calage', () => {
    const p = buildTerzaghiPayload(form());
    // Aucun résultat ni intermédiaire (kp, Rvd, ple, De, qRvd, taux, tassement…) ne
    // doit apparaître : le calcul est exclusivement serveur.
    for (const forbidden of ['kp', 'ple', 'Rvd', 'qRvd', 'taux', 'tassement', 'De', 'verdict', 'rows']) {
      expect(Object.prototype.hasOwnProperty.call(p, forbidden)).toBe(false);
    }
  });
});
