/**
 * Tests — page FASTLAB (classification GTR / NF P11-300 + essais de labo).
 * DoD §9 : given/when/then. DoD §8 : buildFastlabPayload PUR = mesures brutes de
 * labo uniquement, aucune grandeur de résultat (classe/params viennent du serveur).
 *
 * COUVERTURE CORRECTNESS (audit de fidélité FASTLAB7) :
 *  - BLOQUANT 1 : l'onglet CBR/IPI ne DOIT PLUS alimenter les entrées de cisaillement
 *    (ci_*) — le misroute fabriquait des c′/φ′ faux à partir de « points CBR ».
 *  - BLOQUANT 1 bis : le type d'essai IPI doit être atteignable (cbType='ipi').
 *  - BLOQUANT 2 : l'onglet Cisaillement direct DÉDIÉ alimente ci_N/ci_P/ci_R/ci_rho/
 *    ci_w/ci_nat + géométrie (boîte ci_shape/ci_dim OU annulaire ci_Ra/ci_Ri).
 */

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

import { buildFastlabPayload, ExtraView, EXTRA_SECTIONS, SIEVES, type FastlabForm } from '../page';

/** Rend une section additionnelle (ExtraView) avec un jeu de toggles `extra` donné. */
function renderExtra(tab: string, extra: Record<string, string>): string {
  const s = EXTRA_SECTIONS.find((x) => x.tab === tab);
  if (!s) throw new Error(`section introuvable : ${tab}`);
  return renderToStaticMarkup(createElement(ExtraView, { s, extra, setExtra: () => {} }));
}

interface CiSpec { N: string; P: string; R: string; rho: string; w: string; nat: string }
const emptyCi = (): CiSpec => ({ N: '', P: '', R: '', rho: '', w: '', nat: '' });
const emptyCisail = (): FastlabForm['cisail'] => ({
  method: 'box', shape: 'sq', dim: '', Ra: '', Ri: '', rs: '', specs: [emptyCi(), emptyCi(), emptyCi(), emptyCi()],
});

function form(over: Partial<FastlabForm> = {}): FastlabForm {
  return {
    ident: { ref: 'SC2', nature: 'Limon', chantier: '' },
    water: [{ t: '20', h: '138', s: '120' }, { t: '', h: '', s: '' }, { t: '', h: '', s: '' }],
    gr_M: '1000',
    sieves: { gr_2: '90', gr_0_08: '30', gr_20: '' },
    ll: [{ x: '15', t: '15', h: '29', s: '25' }, { x: '', t: '', h: '', s: '' }, { x: '', t: '', h: '', s: '' }, { x: '', t: '', h: '', s: '' }],
    pl: [{ t: '10', h: '16', s: '15' }, { t: '', h: '', s: '' }],
    vbs: { conc: '10', prise1: '30', frac1: '100', w1: '4', V1: '101', prise2: '', frac2: '', w2: '', V2: '' },
    prMould: 'A', prType: 'n',
    prPoints: [{ mh: '1836.6', t: '18', h: '74', s: '68' }, { mh: '', t: '', h: '', s: '' }],
    cbType: 'cbr',
    cisail: {
      method: 'box', shape: 'sq', dim: '60', Ra: '', Ri: '', rs: '2.65',
      specs: [
        { N: '0.36', P: '0.197', R: '', rho: '1950', w: '18.5', nat: 'Limon argileux brun' },
        emptyCi(), emptyCi(), emptyCi(),
      ],
    },
    extra: { oe_H0: '20', la_M: '5000', tu_s3_1: '50', empty: '' },
    ...over,
  };
}

describe('buildFastlabPayload — structure', () => {
  it('mappe identification, eau, granulo, Atterberg aux clés moteur', () => {
    const p = buildFastlabPayload(form());
    expect(p.m_ref).toBe('SC2');
    expect(p.m_nature).toBe('Limon');
    expect(p.w_t1).toBe('20');
    expect(p.w_h1).toBe('138');
    expect(p.gr_M).toBe('1000');
    expect(p.gr_2).toBe('90');
    expect(p.ll_x1).toBe('15');
    expect(p.pl_t1).toBe('10');
  });

  it('mappe VBS + Proctor + type CBR aux clés moteur', () => {
    const p = buildFastlabPayload(form());
    expect(p.v_conc).toBe('10');
    expect(p.v_prise1).toBe('30');
    expect(p.pr_mould).toBe('A');
    expect(p.prType).toBe('n');
    expect(p.pr_mh1).toBe('1836.6');
    // Le type d'essai portance alimente cbType (et NON une clé de cisaillement).
    expect(p.cbType).toBe('cbr');
  });

  it('répand les sections additionnelles (extra) aux clés moteur, omet les vides', () => {
    const p = buildFastlabPayload(form());
    expect(p.oe_H0).toBe('20');
    expect(p.la_M).toBe('5000');
    expect(p.tu_s3_1).toBe('50');
    expect('empty' in p).toBe(false);
  });

  it('omet les champs vides (pas de clé bruit)', () => {
    const p = buildFastlabPayload(form());
    expect('m_chantier' in p).toBe(false);
    expect('w_t2' in p).toBe(false);
    expect('gr_20' in p).toBe(false);
    expect('ll_x2' in p).toBe(false);
  });
});

describe('buildFastlabPayload — anti-misroute CBR↔cisaillement (BLOQUANT 1)', () => {
  // Un onglet « CBR / IPI » renseigné SEUL ne doit produire AUCUNE entrée de
  // cisaillement (ci_* / ciMethod / ci_shape). Sinon le moteur calcule des c′/φ′
  // faux à partir de mesures de portance — c'est le défaut corrigé.
  it('un onglet CBR renseigné seul ne fabrique AUCUNE entrée de cisaillement', () => {
    const p = buildFastlabPayload(form({
      cbType: 'cbr',
      cisail: emptyCisail(),
      extra: {
        cb_cible: '95', cb_s25: '13.35', cb_s5: '20', cb_K: '1',
        cb_tot0: '4200', cb_moule0: '2100', cb_vol0: '2124', cb_w0: '11',
        cb_pen_0_6: '5.2', cb_pen_0_9: '7.8', cb_H00: '127', cb_gonf0: '0.4',
      },
    }));
    const ciKeys = Object.keys(p).filter((k) => k === 'ciMethod' || k === 'ci_shape' || k.startsWith('ci_'));
    expect(ciKeys, `entrées de cisaillement fabriquées par l'onglet CBR : ${ciKeys.join(', ')}`).toEqual([]);
    // Les vraies mesures CBR (cb_*) passent bien, elles.
    expect(p.cb_tot0).toBe('4200');
    expect(p.cb_pen_0_6).toBe('5.2');
    expect(p.cbType).toBe('cbr');
  });

  it("le type d'essai IPI est atteignable (cbType togglable)", () => {
    expect(buildFastlabPayload(form({ cbType: 'ipi' })).cbType).toBe('ipi');
    expect(buildFastlabPayload(form({ cbType: 'cbr' })).cbType).toBe('cbr');
  });
});

describe('buildFastlabPayload — cisaillement direct dédié (BLOQUANT 2)', () => {
  it('mode boîte : mappe géométrie ci_shape/ci_dim + ci_N/ci_P/ci_R/ci_rho/ci_w/ci_nat', () => {
    const p = buildFastlabPayload(form({
      cisail: {
        method: 'box', shape: 'sq', dim: '60', Ra: '', Ri: '', rs: '2.65',
        specs: [
          { N: '0.36', P: '0.197', R: '0.150', rho: '1950', w: '18.5', nat: 'Limon' },
          { N: '0.72', P: '0.365', R: '0.300', rho: '1965', w: '18.0', nat: 'Limon' },
          { N: '1.08', P: '0.533', R: '0.450', rho: '1940', w: '18.8', nat: 'Limon' },
          emptyCi(),
        ],
      },
    }));
    expect(p.ciMethod).toBe('box');
    expect(p.ci_shape).toBe('sq');
    expect(p.ci_dim).toBe('60');
    expect(p.ci_rs).toBe('2.65');
    expect(p.ci_N1).toBe('0.36');
    expect(p.ci_P1).toBe('0.197');
    expect(p.ci_R1).toBe('0.150');
    expect(p.ci_rho1).toBe('1950');
    expect(p.ci_w1).toBe('18.5');
    expect(p.ci_nat1).toBe('Limon');
    expect(p.ci_N3).toBe('1.08');
    expect('ci_Ra' in p).toBe(false);
    expect('ci_Ri' in p).toBe(false);
  });

  it('mode annulaire : mappe ci_Ra/ci_Ri (pas ci_dim/ci_shape)', () => {
    const p = buildFastlabPayload(form({
      cisail: {
        method: 'ring', shape: 'sq', dim: '60', Ra: '50', Ri: '25', rs: '2.7',
        specs: [{ N: '0.5', P: '0.3', R: '', rho: '', w: '', nat: '' }, emptyCi(), emptyCi(), emptyCi()],
      },
    }));
    expect(p.ciMethod).toBe('ring');
    expect(p.ci_Ra).toBe('50');
    expect(p.ci_Ri).toBe('25');
    expect(p.ci_N1).toBe('0.5');
    expect('ci_dim' in p).toBe(false);
    expect('ci_shape' in p).toBe(false);
  });
});

describe('buildFastlabPayload — DoD §8 (ALLOWLIST fail-closed)', () => {
  // ALLOWLIST (et non denylist) suite au challenge : TOUTE clé du payload doit être une
  // mesure brute / un toggle CONNU. Une clé inconnue (ex. futur champ de RÉSULTAT
  // classe/ip/vbs...) fait ECHOUER le test — fail-closed, pas de liste noire a maintenir.
  const ALLOWED_PREFIX = /^(m_|w_|gr_|ll_|pl_|v_|pr_|ci_|cb_|oe_|tu_|tc_|es_|la_|md_|mc_|sz_|su_|pe_|uc_|rs_|rs2_|d_|di_|dd_|ra_)/;
  const ALLOWED_TOGGLES = new Set([
    'gr_M', 'prType', 'ciMethod', 'ci_shape', 'laVar', 'mdeVar', 'mdeMode', 'mdeWet',
    'permMode', 'su_type', 'rsMethod', 'cbType', 'densMethod', 'densShape', 'forcedState',
  ]);

  it('toute clé du payload est une mesure/toggle connu (aucune grandeur de résultat)', () => {
    const p = buildFastlabPayload(form());
    const inconnues = Object.keys(p).filter((k) => !ALLOWED_PREFIX.test(k) && !ALLOWED_TOGGLES.has(k));
    expect(inconnues, `clés hors allowlist (fuite de résultat ?) : ${inconnues.join(', ')}`).toEqual([]);
  });

  it('aucune clé de résultat connue ne fuit', () => {
    const p = buildFastlabPayload(form());
    for (const forbidden of ['classe', 'ip', 'wl', 'wp', 'vbs', 'p80', 'dmax', 'code', 'path', 'cbr', 'mde', 'rhos', 'es', 'la', 'c_cis', 'phi_cis']) {
      expect(Object.prototype.hasOwnProperty.call(p, forbidden)).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MAJEUR — passe de fidélité FASTLAB7 (tamis grossiers, m_geo R, MDE campagne,
// perméa charge constante, ρ apparente 3 méthodes, WA24, forçage état, pl_np).
// Chaque champ DOIT traverser buildFastlabPayload vers la clé moteur exacte ; les
// sections conditionnelles DOIVENT rendre les bons champs selon le toggle.
// ─────────────────────────────────────────────────────────────────────────────

describe('MAJEUR 1 — tamis grossiers (Dmax non plafonné, famille C détectable)', () => {
  it('la série de tamis couvre les 6 coupures grossières 100→31,5 mm (ids moteur gr_*)', () => {
    const keys = SIEVES.map((s) => s.key);
    for (const k of ['gr_100', 'gr_80', 'gr_63', 'gr_50', 'gr_40', 'gr_31_5']) {
      expect(keys, `tamis grossier manquant : ${k}`).toContain(k);
    }
    // Et les fins historiques restent présents (non-régression).
    for (const k of ['gr_20', 'gr_2', 'gr_0_08']) expect(keys).toContain(k);
    expect(SIEVES.length).toBe(18);
  });

  it('un refus sur un tamis grossier traverse le payload (clé gr_* brute)', () => {
    const p = buildFastlabPayload(form({ sieves: { gr_50: '120', gr_31_5: '80', gr_2: '90' } }));
    expect(p.gr_50).toBe('120');
    expect(p.gr_31_5).toBe('80');
    expect(p.gr_2).toBe('90');
  });
});

describe('MAJEUR 2 — famille géologique rocheuse m_geo (R1-R6)', () => {
  it('le choix de famille R traverse vers m_geo (mapping ident → m_*)', () => {
    const p = buildFastlabPayload(form({ ident: { ref: 'RC1', geo: 'R3' } }));
    expect(p.m_geo).toBe('R3');
    expect(p.m_ref).toBe('RC1');
  });

  it('« non rocheux » (geo vide) n’émet aucune clé m_geo', () => {
    const p = buildFastlabPayload(form({ ident: { ref: 'S', geo: '' } }));
    expect('m_geo' in p).toBe(false);
  });
});

describe('MAJEUR 3 — Micro-Deval campagne CAFEC (mc_*) + mdeWet', () => {
  it('mode campagne : les 4 déterminations mc_A/mc_B/mc_cls/mc_ch/mc_rot traversent le payload', () => {
    const p = buildFastlabPayload(form({
      extra: {
        mdeMode: 'camp',
        mc_cls0: '3/8', mc_cls2: '3/8', mc_ch0: '2000', mc_rot0: '12000',
        mc_A0: '500', mc_B0: '470', mc_A1: '500', mc_B1: '468',
        mc_A2: '500', mc_B2: '455', mc_A3: '500', mc_B3: '452',
      },
    }));
    expect(p.mdeMode).toBe('camp');
    expect(p.mc_A0).toBe('500');
    expect(p.mc_B0).toBe('470');
    expect(p.mc_A3).toBe('500');
    expect(p.mc_B3).toBe('452');
    expect(p.mc_cls0).toBe('3/8');
    expect(p.mc_ch0).toBe('2000');
    expect(p.mc_rot0).toBe('12000');
  });

  it('condition à sec (mdeWet=s) traverse le payload', () => {
    expect(buildFastlabPayload(form({ extra: { mdeWet: 's' } })).mdeWet).toBe('s');
  });

  it('rend le tableau campagne (et pas le normalisé) quand mdeMode=camp', () => {
    const camp = renderExtra('mde', { mdeMode: 'camp' });
    expect(camp).toContain('Poids initial A (g)');
    expect(camp).toContain('Refus 1,6 mm B (g)');
    expect(camp).toContain('Classe granulaire (mm)');
    expect(camp).not.toContain('Masse initiale M (g)');
  });

  it('rend le tableau normalisé (et pas la campagne) quand mdeMode=norme', () => {
    const norme = renderExtra('mde', { mdeMode: 'norme' });
    expect(norme).toContain('Masse initiale M (g)');
    expect(norme).toContain('En présence d’eau (MDE)'); // sélecteur mdeWet visible
    expect(norme).not.toContain('Poids initial A (g)');
  });

  // MAJEUR-2 : la numérotation affichée doit valoir 1-4 (accord avec le libellé
  // « 1-2 à sec / 3-4 en présence d'eau ») SANS déplacer les ids moteur. Le moteur
  // calcMdeCamp lit mc_A0..mc_A3 (0-indexés) et retient CMDE = moyenne(perte[2], perte[3])
  // = déterminations en présence d'eau. L'affichage 0-3 + libellé « 1-2/3-4 » induisait
  // une inversion sec/eau silencieuse. On pinne : affichage 1-4 ⇒ id 0-3 (eau = # 3,4).
  it('campagne CAFEC : # affiché 1-4, ids moteur mc_A0..mc_A3 préservés (pas d’inversion sec/eau)', () => {
    const camp = renderExtra('mde', { mdeMode: 'camp' });
    // Les ids moteur restent 0-indexés (le moteur ne bouge pas) — présents en attribut name.
    for (const id of ['mc_A0', 'mc_A1', 'mc_A2', 'mc_A3', 'mc_B0', 'mc_B3']) {
      expect(camp, `id moteur manquant : ${id}`).toContain(`name="${id}"`);
    }
    // La colonne # affiche 1,2,3,4 (aligné au libellé), plus jamais un « 0 » de rang.
    const rowNums = [...camp.matchAll(/<td[^>]*>(\d)<\/td>/g)].map((m) => m[1]);
    expect(rowNums).toEqual(['1', '2', '3', '4']);

    // Mapping display -> id : chaque <tr> porte son numéro de rang puis ses inputs mc_*<idx>.
    // On vérifie que le rang AFFICHÉ 3 (resp. 4) porte l'id mc_A2 (resp. mc_A3) = les
    // déterminations « en présence d'eau » que le moteur moyenne pour CMDE.
    const rowOf = (name: string): string => {
      const rows = camp.split('<tr>');
      const r = rows.find((seg) => seg.includes(`name="${name}"`));
      const num = r?.match(/<td[^>]*>(\d)<\/td>/)?.[1];
      if (!num) throw new Error(`rang introuvable pour ${name}`);
      return num;
    };
    expect(rowOf('mc_A0')).toBe('1'); // à sec (MDS) — informatif
    expect(rowOf('mc_A1')).toBe('2'); // à sec (MDS)
    expect(rowOf('mc_A2')).toBe('3'); // en présence d'eau (MDE) — retenu GTR
    expect(rowOf('mc_A3')).toBe('4'); // en présence d'eau (MDE) — retenu GTR
  });
});

describe('MAJEUR 4 — perméabilité charge constante (pe_V/pe_L/pe_A/pe_dh/pe_t)', () => {
  it('les mesures de charge constante traversent le payload', () => {
    const p = buildFastlabPayload(form({
      extra: { permMode: 'const', pe_V: '250', pe_L: '10', pe_A: '20', pe_dh: '30', pe_t: '120' },
    }));
    expect(p.permMode).toBe('const');
    expect(p.pe_V).toBe('250');
    expect(p.pe_L).toBe('10');
    expect(p.pe_A).toBe('20');
    expect(p.pe_dh).toBe('30');
    expect(p.pe_t).toBe('120');
  });

  it('rend les champs charge constante quand permMode=const, variable sinon', () => {
    const cst = renderExtra('perm', { permMode: 'const' });
    expect(cst).toContain('Volume recueilli V (cm³)');
    expect(cst).toContain('Charge Δh (cm)');
    expect(cst).not.toContain('Section tube a (cm²)');
    const vr = renderExtra('perm', { permMode: 'var' });
    expect(vr).toContain('Section tube a (cm²)');
    expect(vr).not.toContain('Volume recueilli V (cm³)');
  });
});

describe('MAJEUR 5 — masse volumique apparente 3 méthodes (linéaire/immersion/déplacement)', () => {
  it('cylindre (d_d/d_Lc/d_mc) traverse le payload', () => {
    const p = buildFastlabPayload(form({ extra: { densMethod: 'lin', densShape: 'cyl', d_d: '50', d_Lc: '100', d_mc: '350' } }));
    expect(p.densShape).toBe('cyl');
    expect(p.d_d).toBe('50');
    expect(p.d_Lc).toBe('100');
    expect(p.d_mc).toBe('350');
  });

  it('immersion (di_*) et déplacement (dd_*) traversent le payload', () => {
    const pi = buildFastlabPayload(form({ extra: { densMethod: 'imm', di_m: '350', di_mg: '210', di_rfl: '0.998' } }));
    expect(pi.densMethod).toBe('imm');
    expect(pi.di_m).toBe('350');
    expect(pi.di_mg).toBe('210');
    const pd = buildFastlabPayload(form({ extra: { densMethod: 'dep', dd_m: '350', dd_m2: '640' } }));
    expect(pd.densMethod).toBe('dep');
    expect(pd.dd_m).toBe('350');
    expect(pd.dd_m2).toBe('640');
  });

  it('rend les bons champs selon la méthode ρ apparente', () => {
    const cyl = renderExtra('dens', { densMethod: 'lin', densShape: 'cyl' });
    expect(cyl).toContain('Diamètre d (mm)');
    expect(cyl).not.toContain('Largeur W (mm)');
    const imm = renderExtra('dens', { densMethod: 'imm' });
    expect(imm).toContain('m_g masse immergée (g)');
    expect(imm).not.toContain('Diamètre d (mm)');
    const dep = renderExtra('dens', { densMethod: 'dep' });
    expect(dep).toContain('m_2 récipient + fluide déplacé (g)');
    const prism = renderExtra('dens', { densMethod: 'lin', densShape: 'prism' });
    expect(prism).toContain('Largeur W (mm)');
    expect(prism).not.toContain('Diamètre d (mm)');
  });
});

describe('MAJEUR 6 — absorption / masse vol granulats WA24 (ra_*)', () => {
  it('les masses ra_M1..ra_M4/ra_rw traversent le payload', () => {
    const p = buildFastlabPayload(form({ extra: { ra_M1: '505', ra_M2: '1650', ra_M3: '1340', ra_M4: '500', ra_rw: '0.998' } }));
    expect(p.ra_M1).toBe('505');
    expect(p.ra_M2).toBe('1650');
    expect(p.ra_M3).toBe('1340');
    expect(p.ra_M4).toBe('500');
    expect(p.ra_rw).toBe('0.998');
  });

  it('rend la saisie WA24 (section Absorption, NF EN 1097-6)', () => {
    const html = renderExtra('rho', {});
    expect(html).toContain('M₁ — surface sèche SSD (g)');
    expect(html).toContain('M₄ — séché à l’étuve (g)');
    expect(html).toContain('NF EN 1097-6');
  });
});

describe('MAJEUR 7 — forçage de l’état hydrique (forcedState)', () => {
  it('un état forcé traverse le payload', () => {
    expect(buildFastlabPayload(form({ extra: { forcedState: 'th' } })).forcedState).toBe('th');
    expect(buildFastlabPayload(form({ extra: { forcedState: 'ts' } })).forcedState).toBe('ts');
  });

  it('« Auto » (forcedState vide) n’émet aucune clé forcedState', () => {
    const p = buildFastlabPayload(form({ extra: { forcedState: '' } }));
    expect('forcedState' in p).toBe(false);
  });
});

describe('MAJEUR 8 — Atterberg « sol non plastique » (pl_np)', () => {
  it('la case cochée traverse le payload en pl_np (lu par chk côté moteur)', () => {
    const p = buildFastlabPayload(form({ extra: { pl_np: 'true' } }));
    expect(p.pl_np).toBe('true');
  });

  it('la case décochée (chaîne vide) n’émet aucune clé pl_np', () => {
    const p = buildFastlabPayload(form({ extra: { pl_np: '' } }));
    expect('pl_np' in p).toBe(false);
  });
});
