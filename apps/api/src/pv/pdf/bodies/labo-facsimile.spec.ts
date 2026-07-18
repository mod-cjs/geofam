/**
 * ÉQUIVALENCE PV ↔ PROCÈS-VERBAL D'ESSAI natif FASTLAB (moteur `labo-classification-gtr`,
 * essais de labo + classification GTR NF P 11-300) — décision titulaire 18/07. Le PV
 * scellé doit reproduire le rapport que l'outil client IMPRIME (`printPV` +
 * `buildPVChrome` de packages/engines/reference/FASTLAB7.html), qui est lui-même un
 * document MULTI-FICHES intitulé « PROCÈS-VERBAL D'ESSAI » : une fiche par onglet d'essai
 * RENSEIGNÉ, dans l'ORDRE DES ONGLETS (ordre DOM = ordre d'impression), précédée de
 * l'identification et suivie de la synthèse + classification GTR + visa de l'ingénieur.
 *
 * MÉTHODE (patron terzaghi / pressiometre) : on rend le corps PV depuis la sortie RÉELLE
 * de `runLabo(fixture)` (fixtures à plusieurs essais renseignés) et on prouve :
 *   - la STRUCTURE multi-fiches : une fiche PAR essai renseigné, DANS L'ORDRE de l'outil,
 *     et AUCUNE fiche pour un essai non renseigné (les sous-objets `detail.<essai>` sont
 *     TOUS émis même vides — cf. engine ; la présence est déterminée par le CONTENU) ;
 *   - les MÊMES normes d'essai que le rapport natif (chaînes vérifiées présentes DANS le
 *     source de référence — anti-dérive, ligne 0 faux-vert) ;
 *   - les MÊMES valeurs, recalculées depuis la sortie serveur, formatées avec les
 *     décimales du dépouillement (aucun nombre magique) ;
 *   - l'INVARIANT §8 : le chemin de décision GTR passe par une ALLOWLIST FAIL-CLOSED —
 *     un libellé injecté portant un coefficient N'EST PAS imprimé ; un libellé légitime
 *     de seuil NF P 11-300 public l'est ;
 *   - la MUTATION anti-faux-vert (valeur réelle rendue, valeur perturbée absente).
 *
 * On teste `buildLaboBody` DIRECTEMENT (pas le dispatch global de pv-pdf, câblé en
 * parallèle) : le corps est une fonction pure SealedContent → Content[].
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { LABO_FIXTURES, runLabo, type LaboFixture } from '@roadsen/engines';

import { buildLaboBody } from './labo';
import type { SealedContent } from '../pv-pdf';

// Source de référence (LECTURE SEULE) — ancre anti-dérive : toute norme qu'on affirme
// reproduire DOIT exister dans le rapport natif. bodies/ est un niveau plus profond que
// pv-pdf.ts -> 6 remontées vers 05-Plateforme.
const REFERENCE_HTML = resolve(
  dirname(__filename),
  '../../../../../../packages/engines/reference/FASTLAB7.html',
);
const referenceSource = readFileSync(REFERENCE_HTML, 'utf8');

// --- Miroirs EXACTS des helpers de formatage de bodies/labo.ts : les valeurs attendues
//     suivent la MÊME logique que la production (aucune constante magique). ---
function num(v: number | null, d = 2, unit?: string): string {
  if (v === null || !Number.isFinite(v)) return '—';
  let n = v;
  if (Math.abs(n) < 0.5 / Math.pow(10, d)) n = 0;
  const s = n
    .toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d })
    .replace(/[  ]/g, ' ');
  return unit ? `${s} ${unit}` : s;
}
function sci(v: number, unit?: string): string {
  const s = v.toExponential(2).replace('.', ',');
  return unit ? `${s} ${unit}` : s;
}

/** Collecte le texte rendu par un arbre Content pdfmake (mêmes règles que
 * collectPvPdfText, restreint à notre sous-arbre de corps). */
function walkText(node: unknown, out: string[]): void {
  if (node == null) return;
  if (typeof node === 'string') {
    out.push(node);
    return;
  }
  if (Array.isArray(node)) {
    for (const n of node) walkText(n, out);
    return;
  }
  if (typeof node === 'object') {
    const o = node as Record<string, unknown>;
    if (typeof o.text === 'string') out.push(o.text);
    else if (o.text != null) walkText(o.text, out);
    if (o.stack) walkText(o.stack, out);
    if (o.columns) walkText(o.columns, out);
    if (o.table && typeof o.table === 'object') {
      const t = o.table as { body?: unknown };
      if (t.body) walkText(t.body, out);
    }
  }
}

function norm(s: string): string {
  return s.replace(/[  \s]+/g, ' ');
}

function fixture(id: string): LaboFixture {
  const fx = LABO_FIXTURES.find((f) => f.id === id);
  if (!fx) throw new Error(`fixture ${id} absente`);
  return fx;
}

type Output = Record<string, unknown>;

/** Construit un SealedContent cohérent (input fixture + sortie serveur réelle). */
function sealFor(
  id: string,
  outputOverride?: (o: Output) => Output,
): { sealed: SealedContent; output: Output } {
  const fx = fixture(id);
  const env = runLabo(fx.input);
  if (!env.ok) throw new Error('runLabo a échoué');
  const base = env.output as unknown as Output;
  const output = outputOverride ? outputOverride({ ...base }) : base;
  const sealed: SealedContent = {
    pvNumber: 'PV-RDS-labo-2026-000001',
    sealedAt: '2026-07-18T09:00:00.000Z',
    engineMeta: {
      engineId: 'labo-classification-gtr',
      engineVersion: '1.0.0',
      engineSourceHash: 'a'.repeat(64),
    },
    identity: {
      userId: 'u-1',
      userDisplayName: 'A. DIALLO',
      orgDisplayName: 'BE TEST',
      projectId: 'p-1',
      projectName: 'Chantier RN1',
    },
    input: fx.input as unknown,
    output,
    scienceStatus: 'signed',
    verdict: 'NON_APPLICABLE',
  };
  return { sealed, output };
}

function renderFor(id: string): { text: string; output: Output } {
  const { sealed, output } = sealFor(id);
  const out: string[] = [];
  walkText(buildLaboBody(sealed), out);
  return { text: norm(out.join('\n')), output };
}

const DEMO = 'demo-A2-limon';

describe('PV labo — fac-similé du PROCÈS-VERBAL D’ESSAI natif FASTLAB (printPV multi-fiches)', () => {
  it('given un échantillon DEMO (7 essais) when corps PV rendu then bandeau PV + identification + une fiche par essai renseigné', () => {
    const { text } = renderFor(DEMO);

    // Le rapport natif s'intitule « PROCÈS-VERBAL D'ESSAI » ; notre en-tête le reprend.
    expect(referenceSource).toContain("PROCÈS-VERBAL D'ESSAI");
    expect(text.toLowerCase()).toContain('procès-verbal d’essais');
    expect(text).toContain('extraction / classification'); // bandeau d'analyse

    // Identification de l'échantillon (méta PV, miroir de pvh-meta) — titre en MAJUSCULE.
    expect(text).toContain('IDENTIFICATION DE L’ÉCHANTILLON');
    expect(text).toContain('SC2 — 1,20 m'); // m_ref
    expect(text).toContain('Aménagement RN1 — Lot 3'); // m_chantier
    expect(text).toContain('10/03/2026'); // pvFmtDate(m_date)
  });

  it('STRUCTURE multi-fiches : les 7 essais renseignés du DEMO sont présents, chacun avec SA norme', () => {
    const { text } = renderFor(DEMO);
    // Essais RENSEIGNÉS par le DEMO (w, granulo, Atterberg, VBS, Proctor, œdomètre, cisail).
    const present: Array<[string, string]> = [
      ['Teneur en eau', 'NF EN ISO 17892-1'],
      ['Analyse granulométrique', 'NF EN ISO 17892-4 / EN 933-1'],
      ["Limites d'Atterberg", 'NF P 94-051'],
      ['Valeur de Bleu de méthylène (VBS)', 'NF P 94-068'],
      ['Essai Proctor', 'NF EN 13286-2'],
      ['Essai œdométrique par paliers', 'NF EN ISO 17892-5'],
      ['Cisaillement direct (c′, φ′)', 'NF EN ISO 17892-10'],
    ];
    for (const [title, norme] of present) {
      // anti-dérive : titre + norme existent DANS le rapport natif.
      expect(referenceSource).toContain(title);
      expect(referenceSource).toContain(norme);
      // rendus dans le PV (titre en MAJUSCULE + ligne « conformément à la norme »).
      expect(text).toContain(title.toUpperCase());
      expect(text).toContain(`conformément à la norme ${norme}`);
    }
  });

  it('les essais NON renseignés du DEMO n’ont AUCUNE fiche (présence = contenu réel, pas clé detail)', () => {
    const { output } = sealFor(DEMO);
    // Les sous-objets sont TOUS émis (garde anti faux-vert : sinon le test ne prouve rien).
    const d = output.detail as Record<string, unknown>;
    expect(Object.keys(d)).toEqual(
      expect.arrayContaining(['rhos', 'cbr', 'dens', 'ucs', 'triuu', 'es', 'la', 'sz']),
    );
    const { text } = renderFor(DEMO);
    // …mais VIDES pour le DEMO → aucune fiche rendue (normes absentes).
    for (const absent of [
      'NF EN ISO 17892-3', // ρs
      'NF P 94-078', // CBR
      'NF EN ISO 17892-2', // masse volumique apparente
      'NF EN ISO 17892-7', // compression simple
      'NF EN 933-8', // équivalent de sable
      'NF EN 1097-2', // Los Angeles
      'NF EN ISO 17892-11', // perméabilité
    ]) {
      expect(text.includes(`conformément à la norme ${absent}`)).toBe(false);
    }
  });

  it('ORDRE des fiches = ordre des onglets de l’outil (DOM) : teneur → granulo → Atterberg → VBS → Proctor → œdomètre → cisaillement → synthèse', () => {
    const { text } = renderFor(DEMO);
    const seq = [
      'TENEUR EN EAU',
      'ANALYSE GRANULOMÉTRIQUE',
      "LIMITES D'ATTERBERG",
      'VALEUR DE BLEU DE MÉTHYLÈNE (VBS)',
      'ESSAI PROCTOR',
      'ESSAI ŒDOMÉTRIQUE PAR PALIERS',
      'CISAILLEMENT DIRECT (C′, Φ′)',
      'SYNTHÈSE & CLASSIFICATION GTR',
    ];
    const idx = seq.map((s) => text.indexOf(s));
    for (const i of idx) expect(i).toBeGreaterThanOrEqual(0);
    for (let k = 1; k < idx.length; k++) expect(idx[k]).toBeGreaterThan(idx[k - 1]);
  });

  it('valeurs par fiche (DEMO) recalculées depuis la sortie serveur, décimales du dépouillement', () => {
    const { text, output } = renderFor(DEMO);
    const o = output as Record<string, number>;
    // Teneur en eau : prises + moyenne wn.
    expect(text).toContain(num(o.wn, 1, '%')); // 18,0 %
    // Granulo : Dmax / p80 / p2.
    expect(text).toContain(num(o.dmax, 0, 'mm')); // 20 mm
    expect(text).toContain(num(o.p80, 0, '%')); // 52 %
    // Atterberg : wL / Ip + nature ligne A.
    expect(text).toContain(num(o.wl, 0, '%')); // 38 %
    expect(text).toContain(num(o.ip, 0)); // 18
    expect(text).toContain(String(output.natureLigneA)); // Argile (au-dessus ligne A)
    // VBS retenue.
    expect(text).toContain(num(o.vbs, 2)); // 3,50
    // Proctor : wOPN + ρd max (3 décimales dans la fiche).
    expect(text).toContain(num(o.wopn, 1, '%')); // 16,2 %
    expect(text).toContain(num(o.rdmax, 3, 't/m³')); // 1,841 t/m³
    // Œdomètre : Cc.
    expect(text).toContain(num(o.Cc_oedo, 3)); // 0,122
    // Cisaillement : c' / φ' (pic).
    expect(text).toContain(num(o.c_cis, 1, 'kPa')); // 8,2 kPa
    expect(text).toContain(num(o.phi_cis, 1, '°')); // 25,0 °
  });

  it('SYNTHÈSE & CLASSIFICATION GTR : classe + description + justification (chemin de décision)', () => {
    const { text, output } = renderFor(DEMO);
    const cl = output.classe as Record<string, unknown>;
    expect(text).toContain(`Classe : ${cl.full as string}`); // A2 h
    expect(text).toContain(cl.desc as string); // libellé sous-classe (allowlisté)
    // Chaque libellé du chemin de décision est rendu (numéroté), et est bien un
    // libellé de seuil NF P 11-300 PUBLIC (garde anti faux-vert : path non vide).
    const path = cl.path as string[];
    expect(path.length).toBeGreaterThan(0);
    for (const line of path) expect(text).toContain(line);
  });

  it('visa de l’ingénieur chargé de l’étude (miroir du pied de fiche du client)', () => {
    const { text } = renderFor(DEMO);
    expect(referenceSource).toContain("L'ingénieur chargé de l'étude");
    expect(text).toContain('L’ingénieur chargé de l’étude');
    expect(text).toContain('M. NDIAYE'); // m_ing du DEMO
  });

  it('chrome GEOFAM + référentiel NF P 11-300 ; JAMAIS AGEROUTE ni ROADSEN', () => {
    const { text } = renderFor(DEMO);
    expect(text).toContain('GEOFAM');
    expect(text).toContain('NF P 11-300');
    expect(text.includes('AGEROUTE')).toBe(false);
    expect(text.includes('ROADSEN')).toBe(false);
  });

  // --- Couverture des autres fiches via des fixtures dédiées ---------------------

  it('fiche perméabilité (k non nul) : norme NF EN ISO 17892-11 + k en notation scientifique', () => {
    const { text, output } = renderFor('perm-tricu-divers');
    const k = output.k as number;
    expect(k).not.toBeNull();
    expect(text).toContain('conformément à la norme NF EN ISO 17892-11');
    expect(text).toContain(sci(k, 'cm/s')); // 3,82e-3 cm/s
  });

  it('fiches triaxial CU/CD, compression simple, sulfates (fixture perm-tricu-divers)', () => {
    const { text, output } = renderFor('perm-tricu-divers');
    const o = output as Record<string, number>;
    // Triaxial CU/CD.
    expect(text).toContain('conformément à la norme NF EN ISO 17892-9');
    expect(text).toContain(num(o.c, 1, 'kPa')); // c' triaxial
    expect(text).toContain(num(o.phi, 1, '°')); // φ' triaxial
    // Compression simple.
    expect(text).toContain('conformément à la norme NF EN ISO 17892-7');
    expect(text).toContain(num(o.qu, 2, 'MPa'));
    // Sulfates.
    expect(text).toContain('conformément à la norme NF EN 1744-1');
    expect(text).toContain(num(o.so3, 2, '%'));
  });

  it('fiches granulaires LA / MDE / SZ + assistant famille R (fixture granulaire-R-LA-MDE)', () => {
    const { text, output } = renderFor('granulaire-R-LA-MDE');
    const o = output as Record<string, number>;
    expect(text).toContain('conformément à la norme NF EN 1097-2'); // Los Angeles / SZ
    expect(text).toContain('conformément à la norme NF EN 1097-1'); // Micro-Deval
    expect(text).toContain(num(o.la, 0)); // LA
    expect(text).toContain(num(o.mde, 1)); // MDE (1 décimale)
    expect(text).toContain(num(o.sz, 0, '%')); // SZ
    // Assistant famille R (rocheux) — rNote allowlistée (R4 + LA/MDE).
    expect(text).toContain('Assistant famille R');
    expect(text).toContain('Famille géologique : R4');
  });

  it('fiche CBR multi-moules + rhos + dens + rho/absorption + es + triuu (fixtures dédiées)', () => {
    const cbr = renderFor('kernel-cbr-complet');
    expect(cbr.text).toContain('conformément à la norme NF P 94-078');
    expect(cbr.text).toContain(num(cbr.output.cbr as number, 0)); // I.CBR
    expect(cbr.text).toContain(num(cbr.output.gonfl as number, 1, '%'));

    const rhos = renderFor('kernel-rhos-methodeA');
    expect(rhos.text).toContain('conformément à la norme NF EN ISO 17892-3');
    expect(rhos.text).toContain(num(rhos.output.rhos as number, 3, 'Mg/m³'));

    const dens = renderFor('kernel-dens-lin-prism');
    expect(dens.text).toContain('conformément à la norme NF EN ISO 17892-2');
    expect(dens.text).toContain(num(dens.output.rho_app as number, 3, 'Mg/m³'));

    const rho = renderFor('kernel-rho-absorption');
    expect(rho.text).toContain('conformément à la norme NF EN 1097-6');
    expect(rho.text).toContain(num(rho.output.wa as number, 1, '%'));

    const te = renderFor('tri-uu-es');
    expect(te.text).toContain('conformément à la norme NF EN ISO 17892-8'); // triaxial UU
    expect(te.text).toContain(num(te.output.cu_uu as number, 1, 'kPa'));
    expect(te.text).toContain('conformément à la norme NF EN 933-8'); // équivalent de sable
    expect(te.text).toContain(num(te.output.es as number, 0, '%'));
  });

  // --- INVARIANT §8 : allowlist fail-closed du chemin de décision GTR -------------

  it('FERMETURE §8 : un libellé de chemin GTR portant un COEFFICIENT injecté N’EST PAS imprimé ; un libellé légitime l’est', () => {
    const { sealed, output } = sealFor(DEMO, (o) => {
      const cl = { ...(o.classe as Record<string, unknown>) };
      const legit = (cl.path as string[])[0]; // « Passant 80µm = 52.0 % > 35 % → sol fin → famille A. »
      cl.path = [
        legit,
        // Injection : libellé forgé portant un coefficient confidentiel — ne matche
        // AUCUN gabarit de seuil NF P 11-300 → doit être écarté (fail-closed).
        'Coefficient interne Ksecret = 123456 appliqué → A2.',
      ];
      return { ...o, classe: cl };
    });
    const out: string[] = [];
    walkText(buildLaboBody(sealed), out);
    const text = out.join('\n');
    const legit = (output.classe as Record<string, string[]>).path[0];
    expect(text).toContain(legit); // le libellé PUBLIC passe
    expect(text.includes('123456')).toBe(false); // le coefficient injecté NON
    expect(text.includes('Ksecret')).toBe(false);
  });

  it('FERMETURE §8 : une description / un qualificatif de finesse forgés N’EST PAS imprimé (allowlist statique)', () => {
    const { sealed } = sealFor(DEMO, (o) => {
      const cl = { ...(o.classe as Record<string, unknown>) };
      cl.desc = 'MÉTHODE CONFIDENTIELLE XYZ = 42'; // hors allowlist NF P 11-300
      return { ...o, classe: cl, mfq: 'SECRET_INTERNE' }; // hors {très fin, idéal, grossier}
    });
    const out: string[] = [];
    walkText(buildLaboBody(sealed), out);
    const text = out.join('\n');
    expect(text.includes('MÉTHODE CONFIDENTIELLE XYZ')).toBe(false);
    expect(text.includes('SECRET_INTERNE')).toBe(false);
  });

  it('MUTATION anti-faux-vert : la valeur c′ RÉELLE (cisaillement) est rendue, une valeur perturbée ne l’est PAS', () => {
    const { text, output } = renderFor(DEMO);
    const cCis = output.c_cis as number;
    const correct = num(cCis, 1, 'kPa'); // 8,2 kPa
    const mutated = num(cCis + 1, 1, 'kPa'); // 9,2 kPa — absent si le rendu suit la sortie
    expect(correct).not.toBe(mutated); // l'assertion est discriminante
    expect(text).toContain(correct);
    expect(text.includes(mutated)).toBe(false);
  });
});
