/**
 * Tests — page CASAGRANDE (pieux, NF P 94-262 / EC7).
 * DoD §9 : given/when/then. DoD §8 : buildCasaPayload PUR, entrées bornées +
 * coefficients partiels EC7 PUBLICS (aucun facteur de calage moteur).
 *
 * Ces tests MORDENT : chaque champ moteur nouvellement exposé au front (géométrie
 * rectangulaire/quelconque, pénétrogramme CPT manuel, frottement négatif) doit
 * traverser buildCasaPayload jusqu'au payload envoyé à l'API. Si le câblage saute,
 * le test devient rouge.
 */

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

import { buildCasaPayload, parseCptPaste, CptPreview, type CasaForm } from '../page';

function form(over: Partial<CasaForm> = {}): CasaForm {
  return {
    projet: 'Ouvrage P3',
    cat: 1, section: 'circ', gB: '0.6', gb2: '', gAp: '', gP: '', gD: '12', gz0: '0',
    meth: 'pmt', da: 'da2', sens: 'comp', essais: 'non',
    cG: '900', cQ: '300', nappe: '2', nprofil: '1', surf: '0', redis: 'non',
    grpN: '1', grpM: '1', grpS: '0',
    layers: [{ soil: 'argile', th: '6', pl: '0.8', em: '8', qc: '', c: '', phi: '', gamma: '' }],
    betonOn: false, fck: '25', arm: 'arme', k3: '1.0',
    cptStep: '0.2', cptPaste: '',
    fnOn: false, fnMode: 'auto', fnS0: '', fnHc: '', fnZt: '', fnZb: '', fnQ: '', fnKtd: '',
    ...over,
  };
}

const geomOf = (f: CasaForm) => buildCasaPayload(f).geom as Record<string, unknown>;

describe('buildCasaPayload — structure & types', () => {
  it('g_D et g_z0 sont au top-level (hors geom) et numériques', () => {
    const p = buildCasaPayload(form({ gD: '15', gz0: '1.2' }));
    expect(p.g_D).toBe(15);
    expect(p.g_z0).toBe(1.2);
    expect((p.geom as Record<string, unknown>).g_B).toBe(0.6);
    expect('g_D' in (p.geom as object)).toBe(false);
  });

  it('convertit les nombres (virgule tolérée) et omet les champs de couche vides', () => {
    const p = buildCasaPayload(form({ gB: '0,8', layers: [{ soil: 'sable', th: '10', pl: '1.5', em: '', qc: '', c: '', phi: '', gamma: '' }] }));
    expect((p.geom as Record<string, unknown>).g_B).toBe(0.8);
    expect(p.layers).toEqual([{ soil: 'sable', th: 10, pl: 1.5 }]); // em/qc/c/phi/gamma vides -> absents
  });

  it('inclut le béton seulement si activé', () => {
    expect('beton' in buildCasaPayload(form({ betonOn: false }))).toBe(false);
    expect(buildCasaPayload(form({ betonOn: true, fck: '30' })).beton).toEqual({ b_fck: 30, arm: 'arme', k3: '1.0' });
  });

  it('grp par défaut fournis (schéma strict satisfait)', () => {
    const p = buildCasaPayload(form());
    expect(p.grp).toEqual({ grp_n: 1, grp_m: 1, grp_s: 0 });
  });
});

describe('buildCasaPayload — géométrie de section (rect / quelconque fonctionnelles)', () => {
  it('circulaire : geom = { section, g_B } sans g_b2 / g_Ap / g_P', () => {
    expect(geomOf(form({ section: 'circ', gB: '0.6' }))).toEqual({ section: 'circ', g_B: 0.6 });
  });

  it('carrée : geom = { section, g_B } (côté unique)', () => {
    expect(geomOf(form({ section: 'carre', gB: '0.5' }))).toEqual({ section: 'carre', g_B: 0.5 });
  });

  it('rectangulaire : g_B (côté) ET g_b2 (largeur) traversent le payload', () => {
    const g = geomOf(form({ section: 'rect', gB: '0.8', gb2: '0.5' }));
    expect(g).toEqual({ section: 'rect', g_B: 0.8, g_b2: 0.5 });
  });

  it('quelconque : g_Ap (aire) ET g_P (périmètre), SANS g_B', () => {
    const g = geomOf(form({ section: 'quel', gAp: '0.28', gP: '1.88' }));
    expect(g).toEqual({ section: 'quel', g_Ap: 0.28, g_P: 1.88 });
    expect('g_B' in g).toBe(false);
  });
});

describe('parseCptPaste — pénétrogramme collé (fidèle à importPenetro du client)', () => {
  it('lit « z qc » par ligne, tolère espace/tab/point-virgule comme séparateurs, trie par z', () => {
    expect(parseCptPaste('2.0 5\n1.0\t3\n3.0;7')).toEqual([
      { z: 1, qc: 3 }, { z: 2, qc: 5 }, { z: 3, qc: 7 },
    ]);
  });

  it('la virgule est un séparateur de colonne (fidèle au client), pas un décimal', () => {
    // « 3,0 7 » -> tokens [3, 0, 7] -> z=3, qc=0 (comportement importPenetro).
    expect(parseCptPaste('3,0 7')).toEqual([{ z: 3, qc: 0 }]);
  });

  it('ignore les lignes à moins de deux nombres et le vide', () => {
    expect(parseCptPaste('')).toEqual([]);
    expect(parseCptPaste('  \nbonjour\n5')).toEqual([]);
    expect(parseCptPaste('1 2\n#commentaire\n4 6')).toEqual([{ z: 1, qc: 2 }, { z: 4, qc: 6 }]);
  });
});

describe('CptPreview — aperçu live des points parsés (filet anti-corruption virgule)', () => {
  // MAJEUR-3 : parseCptPaste est FIDÈLE au HTML (virgule = séparateur de colonne).
  // Mais le reste du formulaire accepte la virgule comme décimale : un CPT « 1,0 3,2 »
  // se scinde en [1,0,3,2] -> qc≈0, résultat aberrant SANS erreur. L'aperçu restaure le
  // contrôle visuel (nb de points + z/qc) que le HTML d'origine affichait. Il DOIT
  // refléter exactement parseCptPaste (même source de vérité que le payload envoyé).
  const render = (txt: string) => renderToStaticMarkup(createElement(CptPreview, { txt }));

  it('reflète le nombre de points et les valeurs z/qc de parseCptPaste (saisie propre)', () => {
    const txt = '1.0 3.2\n2.0 5.4\n3.0 7.1';
    const pts = parseCptPaste(txt);
    const html = render(txt);
    expect(pts.length).toBe(3);
    expect(html).toContain('3'); // compteur de points
    // chaque couple z/qc parsé apparaît dans l'aperçu
    for (const p of pts) {
      expect(html).toContain(String(p.z));
      expect(html).toContain(String(p.qc));
    }
  });

  it('EXPOSE la corruption virgule-décimale : « 1,0 3,2 » -> qc=0 visible dans l’aperçu', () => {
    const txt = '1,0 3,2';
    // parseCptPaste (fidèle HTML) : tokens [1,0,3,2] -> z=1, qc=0.
    expect(parseCptPaste(txt)).toEqual([{ z: 1, qc: 0 }]);
    const html = render(txt);
    // L'aperçu montre le point corrompu (qc=0) — l'utilisateur voit l'anomalie AVANT calcul.
    expect(html).toContain('0');
    expect(html).toMatch(/1 point/i); // 1 point parsé (pas 2 profondeurs attendues)
  });

  it('saisie vide : aperçu neutre, aucun point (pas de fausse table)', () => {
    expect(parseCptPaste('')).toEqual([]);
    const html = render('');
    expect(html).toMatch(/0 point/i);
  });
});

describe('buildCasaPayload — pénétrogramme CPT manuel', () => {
  it('méthode CPT : le pénétrogramme collé alimente cpt.pts (trié) + le pas', () => {
    const p = buildCasaPayload(form({ meth: 'cpt', cptStep: '0.25', cptPaste: '4 12\n2 8' }));
    expect(p.cpt).toEqual({ step: 0.25, pts: [{ z: 2, qc: 8 }, { z: 4, qc: 12 }] });
  });

  it('méthode CPT sans collage : pts vide (le moteur régénère depuis les couches)', () => {
    expect(buildCasaPayload(form({ meth: 'cpt' })).cpt).toEqual({ step: 0.2, pts: [] });
  });

  it('méthode ≠ CPT : le collage éventuel est ignoré (pts vide)', () => {
    expect(buildCasaPayload(form({ meth: 'pmt', cptPaste: '2 8\n4 12' })).cpt).toEqual({ step: 0.2, pts: [] });
  });
});

describe('buildCasaPayload — frottement négatif (onglet 02, downdrag)', () => {
  it('absent si non activé', () => {
    expect('frottementNegatif' in buildCasaPayload(form({ fnOn: false }))).toBe(false);
  });

  it('mode auto : mode + s0/Hc + Q + K·tanδ traversent (zt/zb = 0)', () => {
    const p = buildCasaPayload(form({ fnOn: true, fnMode: 'auto', fnS0: '90', fnHc: '9', fnQ: '800', fnKtd: '0.30' }));
    expect(p.frottementNegatif).toEqual({
      mode: 'auto', fn_Q: 800, fn_ktd: 0.3, fn_s0: 90, fn_hc: 9, fn_zt: 0, fn_zb: 0,
    });
  });

  it('mode imposé : la zone zt–zb traverse', () => {
    const p = buildCasaPayload(form({ fnOn: true, fnMode: 'impose', fnZt: '0', fnZb: '9', fnQ: '800', fnKtd: '0.20' }));
    expect(p.frottementNegatif).toEqual({
      mode: 'impose', fn_Q: 800, fn_ktd: 0.2, fn_s0: 0, fn_hc: 0, fn_zt: 0, fn_zb: 9,
    });
  });
});

describe('buildCasaPayload — surface d’investigation (champ corrigé)', () => {
  it('la surface d’investigation alimente o_surf (m²), pas une surcharge', () => {
    expect(buildCasaPayload(form({ surf: '2500' })).o_surf).toBe(2500);
  });
});

describe('buildCasaPayload — DoD §8', () => {
  it('les coefficients sont les valeurs EC7 publiques (NA DA2), pas du calage caché', () => {
    const c = buildCasaPayload(form()).coeffs as Record<string, number>;
    expect(c.k_gG).toBe(1.35);
    expect(c.k_gQ).toBe(1.5);
    expect(c.cr_car).toBe(0.9);
  });

  it('ne produit aucune grandeur de RÉSULTAT (Rd, Rb, taux, portance…)', () => {
    const p = buildCasaPayload(form({ section: 'quel', gAp: '0.3', gP: '2', fnOn: true, fnMode: 'auto', meth: 'cpt', cptPaste: '1 5' }));
    for (const forbidden of ['Rd', 'Rbk', 'RbK', 'Rsk', 'taux', 'qp', 'kp', 'Fd', 'verdict', 'rows', 'Gsn', 'Nmax', 'pointNeutre']) {
      expect(Object.prototype.hasOwnProperty.call(p, forbidden)).toBe(false);
    }
  });
});
