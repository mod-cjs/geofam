/**
 * Sentinelles de la REFONTE design PV (#71) — présentation MÉTIER chaussée +
 * fallback + invariants non régressés.
 *
 * INVARIANTS (ne pas régresser) : scellement intouché (cm affiché / mètres scellés
 * / content_hash inchangé), anti-fuite confidentialité (coefficients de calage et
 * flags de branche masqués), fail-closed (hérité de pv-pdf.spec).
 */
import type { OfficialPv } from '@prisma/client';
import {
  canonicalize,
  sealContentHash,
  sealHmac,
  type SealableValue,
} from '@roadsen/shared';

import { buildPvDocDefinition, collectPvPdfText } from './pv-pdf';
import { COLORS } from './pv-pdf.theme';
import { formatValue } from './pv-presentation/format';

const SECRET = 'secret-presentation-pv';

/** Sortie burmister représentative (NON conforme : orniérage le plus défavorable). */
const CHAUSSEE_OUTPUT: SealableValue = {
  erreur: null,
  warnings: [],
  conforme: false,
  NE: 1467314.8218242952,
  // Famille SCELLEE = sortie NETTOYEE par la projection moteur (runBurmister) :
  // libelle NU d'allowlist, SANS discriminant Kmix ni § (FUITE #1 / issue #81).
  famille: 'bitumineuse épaisse',
  epaisseurLiee: 0.16, // m -> 16 cm
  epaisseurTotale: 0.41000000000000003, // m -> 41 cm (bruité)
  fatigue: {
    rigide: false,
    valeur: 290.5841975093014, // µdef
    admissible: 205.66775257237964, // µdef -> taux 141 %
    ok: false,
    requis: true,
  },
  ornierage: {
    valeur: 891.4937982233637,
    admissible: 511.4965796258493, // taux 174 % -> dimensionnant
    ok: false,
  },
};

const CHAUSSEE_INPUT: SealableValue = {
  projet: 'Aménagement RN1 — Lot 3',
  layers: [
    { mat: 'BBSG1', E: 1512, nu: 0.45, h: 0.06 }, // 6 cm
    { mat: 'GB3', E: 2588, nu: 0.45, h: 0.1 }, // 10 cm
    { mat: 'GL1', E: 200, nu: 0.35, h: 0.25 }, // 25 cm
  ],
  subgrade: { cls: 'PF2', E: 50, nu: 0.35 },
  traffic: { T: 150, C: 0.9, N: 20, tau: 4, dir: 1, tv: 1 },
  load: { p: 0.662, a: 0.125, d: 0.375, r: 'auto', sh: 'auto', ks: 'auto' },
};

function makeChausseePv(
  overrides: Partial<{ input: SealableValue; output: SealableValue }> = {},
): OfficialPv {
  const sealedAtIso = '2026-06-22T09:30:00.000Z';
  const input = overrides.input ?? CHAUSSEE_INPUT;
  const output = overrides.output ?? CHAUSSEE_OUTPUT;
  const content: SealableValue = {
    pvNumber: 'PV-RDS-geotest-2026-000042',
    sealedAt: sealedAtIso,
    engineMeta: {
      engineId: 'chaussee-burmister',
      engineVersion: '1.0.0',
      engineSourceHash: 'a'.repeat(64),
    },
    identity: {
      userId: 'u-eng',
      userDisplayName: 'M. NDIAYE',
      orgDisplayName: 'GEOTEST LABO',
      projectId: 'p-1',
      projectName: 'Aménagement RN1 — Lot 3',
    },
    input,
    output,
    scienceStatus: 'unsigned',
  };
  const canonical = canonicalize(content);
  return {
    id: 'pv-1',
    orgId: '11111111-1111-1111-1111-111111111111',
    calcResultId: 'c-1',
    projectId: 'p-1',
    pvNumber: 'PV-RDS-geotest-2026-000042',
    userId: 'u-eng',
    projectName: 'Aménagement RN1 — Lot 3',
    engineId: 'chaussee-burmister',
    engineVersion: '1.0.0',
    engineSourceHash: 'a'.repeat(64),
    inputCanonical: canonical,
    output: output,
    scienceStatus: 'unsigned',
    verdict: 'NON_APPLICABLE',
    contentHash: sealContentHash(canonical),
    hmac: sealHmac(canonical, SECRET),
    sealedAt: new Date(sealedAtIso),
  };
}

/** PV d'un moteur SANS modèle de présentation (-> fallback). */
function makeFallbackPv(): OfficialPv {
  const sealedAtIso = '2026-06-22T09:30:00.000Z';
  const content: SealableValue = {
    pvNumber: 'PV-RDS-geotest-2026-000099',
    sealedAt: sealedAtIso,
    engineMeta: { engineId: 'generic-fallback', engineVersion: '1.0.0' },
    identity: { userId: 'u', projectId: 'p', projectName: 'Semelle S1' },
    input: { B: 2, D: 1.5 },
    output: { qadm: 0.25, tassement: 0.012 },
    scienceStatus: 'unsigned',
  };
  const canonical = canonicalize(content);
  return {
    id: 'pv-2',
    orgId: '11111111-1111-1111-1111-111111111111',
    calcResultId: 'c-2',
    projectId: 'p',
    pvNumber: 'PV-RDS-geotest-2026-000099',
    userId: 'u',
    projectName: 'Semelle S1',
    engineId: 'generic-fallback',
    engineVersion: '1.0.0',
    engineSourceHash: null,
    inputCanonical: canonical,
    output: { qadm: 0.25, tassement: 0.012 },
    scienceStatus: 'unsigned',
    verdict: 'NON_APPLICABLE',
    contentHash: sealContentHash(canonical),
    hmac: sealHmac(canonical, SECRET),
    sealedAt: new Date(sealedAtIso),
  };
}

describe('#71 — présentation métier chaussée', () => {
  const prev = process.env.PV_SIGNING_SECRET;
  beforeAll(() => {
    process.env.PV_SIGNING_SECRET = SECRET;
  });
  afterAll(() => {
    if (prev === undefined) delete process.env.PV_SIGNING_SECRET;
    else process.env.PV_SIGNING_SECRET = prev;
  });

  it('VERDICT : bandeau « NON CONFORME » (conforme scellé=false, consommé pas affiché en ligne)', () => {
    const text = collectPvPdfText(makeChausseePv());
    expect(text).toContain('NON CONFORME');
    // le booléen brut « conforme » ne doit PAS apparaître comme ligne clé-valeur.
    expect(text.includes('conforme')).toBe(false);
  });

  it('TAUX DE TRAVAIL : fatigue ~141 % et orniérage ~174 % affichés', () => {
    const text = collectPvPdfText(makeChausseePv());
    expect(text).toContain('141'); // 290.58/205.67
    expect(text).toContain('174'); // 891.49/511.50 (dimensionnant)
  });

  it('CM-AFFICHÉ / MÈTRES-SCELLÉS / HASH INCHANGÉ (affichage seul)', () => {
    const pv = makeChausseePv();
    // MUTATION-CHECK DURCI (audit) : on cible la CELLULE VALEUR de la ligne
    // « Épaisseur totale » DANS la docDef structurée (pas une sous-chaîne de tout
    // le texte, où « 41 » serait capté par « 141 % »). 0.41 m * scale 100 = « 41 »
    // (+ unité « cm »). Casser scale 100->1 sur epaisseurTotale rend « 0,4 » ->
    // cette assertion vire VRAIMENT au rouge.
    const def = buildPvDocDefinition(pv);
    const totale = findRowValue(def.content, 'Épaisseur totale');
    expect(totale).toEqual({ value: '41', unit: 'cm' });
    const liee = findRowValue(def.content, 'Épaisseur des couches liées');
    expect(liee).toEqual({ value: '16', unit: 'cm' });

    // le bruit binaire n'apparaît jamais à l'affichage.
    const text = collectPvPdfText(pv);
    expect(text.includes('0.41000000000000003')).toBe(false);
    // SCELLEMENT INTOUCHÉ : la canonique garde les MÈTRES (0.06, 0.25, 0.41…).
    expect(pv.inputCanonical).toContain('0.41000000000000003');
    expect(pv.inputCanonical).toContain('0.06');
    expect(pv.inputCanonical).toContain('0.25');
    // hash recalculé = hash de la canonique en mètres (affichage cm n'y change rien).
    expect(sealContentHash(pv.inputCanonical)).toBe(pv.contentHash);
    expect(text).toContain(pv.contentHash); // hash complet rendu
  });

  it('TRANSPARENCE E↔matériau (réserve expert) : chaque couche affiche son module E sur SA ligne', () => {
    // Réserve d'intégration expert : E (saisi) et le matériau doivent décrire le
    // MÊME matériau. Pour qu'un vérificateur détecte une incohérence, le module E
    // de CHAQUE couche est affiché À CÔTÉ de son matériau (même ligne de la table
    // structure). findRowValue cible la ligne dont la 1re cellule = le matériau et
    // renvoie la cellule suivante (colonne E). Casser le lien (E décorrélé du
    // matériau, ou colonne E retirée) vire cette assertion au ROUGE.
    const def = buildPvDocDefinition(makeChausseePv());
    // couches haut->bas : BBSG1 / GB3 / GL1 (cf. CHAUSSEE_INPUT), E en MPa.
    expect(findRowValue(def.content, 'BBSG1')?.value).toBe('1512');
    expect(findRowValue(def.content, 'GB3')?.value).toBe('2588');
    expect(findRowValue(def.content, 'GL1')?.value).toBe('200');
    // Sol support (semi-infini) : E de la plateforme aussi affiché sur sa ligne.
    expect(findRowValue(def.content, 'Sol support (PF2)')?.value).toBe('50');
  });

  it('UNITÉS : MPa, µdef, cm, ν présents ; libellés lisibles (pas de clés brutes)', () => {
    const text = collectPvPdfText(makeChausseePv());
    expect(text).toContain('MPa');
    expect(text).toContain('µdef');
    expect(text).toContain('Famille de structure');
    expect(text).toContain('essieux équivalents');
    // clés internes brutes ABSENTES :
    expect(text.includes('layers[1]')).toBe(false);
    expect(text.includes('traffic.tau')).toBe(false);
    expect(text.includes('epaisseurTotale')).toBe(false);
  });

  it('CONFIDENTIALITÉ (DoD §8) : flags de branche + coefficients de calage MASQUÉS', () => {
    const text = collectPvPdfText(makeChausseePv()).toLowerCase();
    // flags de branche de méthode :
    expect(text.includes('requis')).toBe(false);
    expect(text.includes('rigide')).toBe(false);
    // coefficients de calage / détail ks-sh-r : jamais la valeur brute « auto » en
    // clé-valeur ni le nom du coefficient.
    expect(text.includes('load.ks')).toBe(false);
    expect(text.includes('load.sh')).toBe(false);
    // warnings (bruit) et erreur vide non rendus en ligne.
    expect(text.includes('warnings')).toBe(false);
  });

  it('CONFIDENTIALITÉ (DoD §8, FUITE #1) : le discriminant Kmix « K=… » n apparaît JAMAIS dans le PV', () => {
    // La famille SCELLÉE provient de la projection moteur (runBurmister), qui la
    // nettoie en libellé NU (allowlist) : plus de « §x.y, K=… ». Le renderer imprime
    // cette famille nettoyée. Sentinelle : si une sortie brute portant le ratio de
    // rigidité calculé était scellée puis rendue, « K= » fuiterait ici.
    const output = {
      ...(CHAUSSEE_OUTPUT as Record<string, unknown>),
      famille: 'mixte', // libellé NU tel que produit par la projection
    } as SealableValue;
    const text = collectPvPdfText(makeChausseePv({ output }));
    expect(text).toContain('Famille de structure');
    expect(text).toContain('mixte');
    expect(text).not.toContain('K=');
    expect(text).not.toMatch(/K\s*=\s*0[.,]\d/);
  });

  it('WARNINGS vides : ni encadré ni clé « warnings » rendus', () => {
    // CHAUSSEE_OUTPUT a warnings:[] -> rien (ni la clé, ni un encadré d'alerte).
    const text = collectPvPdfText(makeChausseePv());
    expect(text.includes('warnings')).toBe(false);
    expect(text.toUpperCase().includes('AVERTISSEMENT')).toBe(false);
  });

  it('WARNINGS non vides : ENCADRÉ D’ALERTE (jamais ignoré silencieusement)', () => {
    const output = {
      ...(CHAUSSEE_OUTPUT as Record<string, unknown>),
      warnings: [
        'Hypothèse de trafic à confirmer',
        'Module GL1 en limite de domaine',
      ],
    } as SealableValue;
    const text = collectPvPdfText(makeChausseePv({ output }));
    // l'encadré titré + les messages d'avertissement apparaissent.
    expect(text).toContain('AVERTISSEMENTS');
    expect(text).toContain('Hypothèse de trafic à confirmer');
    expect(text).toContain('Module GL1 en limite de domaine');
    // la CLÉ brute « warnings » ne s'affiche toujours pas en clé-valeur.
    expect(text.includes('warnings ')).toBe(false);
  });

  it('MAJEUR-2 : un warning NON-STRING (objet) ne fuite JAMAIS ses sous-champs', () => {
    // Un warning-objet {kr:0.91} imprimerait ses sous-champs (coef. de calage) si
    // on faisait JSON.stringify -> fail-OPEN. CORRECTIF : marqueur neutre.
    const output = {
      ...(CHAUSSEE_OUTPUT as Record<string, unknown>),
      warnings: [
        'Avertissement textuel légitime',
        { kr: 0.91, sd2: 12.3 }, // warning-objet (sensible) -> JAMAIS déballé
      ],
    } as SealableValue;
    const text = collectPvPdfText(makeChausseePv({ output }));
    // le message textuel passe ; le marqueur neutre remplace l'objet.
    expect(text).toContain('Avertissement textuel légitime');
    expect(text).toContain('(avertissement non textuel)');
    // AUCUN sous-champ confidentiel ne fuite (ni clé ni valeur, FR ou US).
    expect(text.includes('kr')).toBe(false);
    expect(text.includes('sd2')).toBe(false);
    expect(text.includes('0,91')).toBe(false);
    expect(text.includes('0.91')).toBe(false);
    expect(text.includes('12,3')).toBe(false);
    expect(text.includes('12.3')).toBe(false);
  });

  it('ANTI-FUITE science : aucune mention unsigned/science', () => {
    const text = collectPvPdfText(makeChausseePv()).toLowerCase();
    expect(text.includes('unsigned')).toBe(false);
    expect(text.includes('science')).toBe(false);
  });
});

describe('#71 — critères SECONDAIRES au PV (complétude d’affichage)', () => {
  const prev = process.env.PV_SIGNING_SECRET;
  beforeAll(() => {
    process.env.PV_SIGNING_SECRET = SECRET;
  });
  afterAll(() => {
    if (prev === undefined) delete process.env.PV_SIGNING_SECRET;
    else process.env.PV_SIGNING_SECRET = prev;
  });

  /** Sortie semi-rigide : phase 2 mixte (et2) + σt par couche traitée (rigL). */
  const SEMI_RIGIDE_OUTPUT = {
    ...(CHAUSSEE_OUTPUT as Record<string, unknown>),
    famille: 'semi-rigide',
    fatiguePhase2: { valeur: 509.37, admissible: 201.54, ok: false, couche: 1 },
    fatigueInverse: null,
    couchesTraitees: [
      { couche: 2, mode: 'semi-collée', valeur: 0.2697, admissible: 0.4225, ok: true },
      { couche: 3, mode: 'semi-collée', valeur: 0.3345, admissible: 0.384, ok: true },
    ],
    couchesGranulaires: [],
  } as SealableValue;

  /** Sortie inverse : σt base MTLH profond (st2). */
  const INVERSE_OUTPUT = {
    ...(CHAUSSEE_OUTPUT as Record<string, unknown>),
    famille: 'inverse',
    fatiguePhase2: null,
    fatigueInverse: { valeur: 0.4692, admissible: 0.384, ok: false, couche: 4 },
    couchesTraitees: [],
    couchesGranulaires: [{ couche: 3, valeur: 879.86, admissible: 511.5, ok: false }],
  } as SealableValue;

  it('MIXTE/SEMI-RIGIDE : le critère « Fatigue phase 2 » + la table σt par couche (mode Tab. 68) sont rendus', () => {
    const text = collectPvPdfText(makeChausseePv({ output: SEMI_RIGIDE_OUTPUT }));
    expect(text).toContain('Fatigue phase 2');
    // table σt par couche traitée + mode d'interface (Tab. 68) :
    expect(text).toContain('par couche traitée');
    expect(text).toContain('semi-collée');
    // le critère inverse (null) N'apparaît PAS.
    expect(text.includes('Structure inverse')).toBe(false);
  });

  it('INVERSE : le critère « Structure inverse » (σt MPa) est rendu ; phase 2 (null) omise', () => {
    const text = collectPvPdfText(makeChausseePv({ output: INVERSE_OUTPUT }));
    expect(text).toContain('Structure inverse');
    expect(text).toContain('MPa');
    // phase 2 non concernée -> pas de ligne trompeuse.
    expect(text.includes('Fatigue phase 2')).toBe(false);
    // table εz par couche granulaire rendue.
    expect(text).toContain('par couche granulaire');
  });

  it('SOUPLE/BITUMINEUSE (défaut) : AUCUN critère secondaire rendu (null/[] -> omis)', () => {
    // CHAUSSEE_OUTPUT n'a pas les champs secondaires -> optional criteria omis,
    // tables par couche omises (tableaux absents).
    const text = collectPvPdfText(makeChausseePv());
    expect(text.includes('Fatigue phase 2')).toBe(false);
    expect(text.includes('Structure inverse')).toBe(false);
    expect(text.includes('par couche traitée')).toBe(false);
  });
});

describe('#71 — fallback (moteur sans modèle)', () => {
  const prev = process.env.PV_SIGNING_SECRET;
  beforeAll(() => {
    process.env.PV_SIGNING_SECRET = SECRET;
  });
  afterAll(() => {
    if (prev === undefined) delete process.env.PV_SIGNING_SECRET;
    else process.env.PV_SIGNING_SECRET = prev;
  });

  it('un moteur sans modèle rend une table clé-valeur propre (pas d’erreur)', () => {
    const text = collectPvPdfText(makeFallbackPv());
    // les champs de sortie apparaissent (clé-valeur), le PV se génère.
    expect(text).toContain('qadm');
    expect(text).toContain('Semelle S1');
    // pas de fuite science.
    expect(text.toLowerCase().includes('unsigned')).toBe(false);
  });

  it('fallback : objet RÉDIGÉ sans slug+hash brut', () => {
    const text = collectPvPdfText(makeFallbackPv());
    // pas de « engineId — version … · source <hash> » : phrase propre.
    expect(text.includes('· source')).toBe(false);
    expect(text).toContain('Note de calcul');
  });
});

describe('#71 — détails de présentation (objet, ingénieur, QR, autres params)', () => {
  const prev = process.env.PV_SIGNING_SECRET;
  beforeAll(() => {
    process.env.PV_SIGNING_SECRET = SECRET;
  });
  afterAll(() => {
    if (prev === undefined) delete process.env.PV_SIGNING_SECRET;
    else process.env.PV_SIGNING_SECRET = prev;
  });

  it('OBJET = phrase rédigée (engineLabel + projet), PAS slug+hash', () => {
    const text = collectPvPdfText(makeChausseePv());
    expect(text).toContain('Vérification du dimensionnement');
    expect(text).toContain('AGEROUTE 2015');
    // l'objet ne contient PAS « · source <hash> » ni le slug brut comme objet.
    expect(text.includes('· source')).toBe(false);
  });

  it('INGÉNIEUR : VRAI NOM scellé rendu ; jamais le slug technique', () => {
    // #71-titulaire(1) : userDisplayName est SCELLÉ -> on affiche le vrai nom.
    const text = collectPvPdfText(makeChausseePv());
    expect(text).toContain('M. NDIAYE');
    expect(text.includes('u-eng')).toBe(false); // jamais l'id technique
  });

  it('INGÉNIEUR : fallback « (identité non renseignée) » si nom scellé vide', () => {
    const withoutName = makeChausseePvWithEngineer('');
    const text = collectPvPdfText(withoutName);
    expect(text).toContain('(identité non renseignée)');
    expect(text.includes('u-eng')).toBe(false);
  });

  it('VISA : « Établi et scellé par : <ingénieur> — <organisation> »', () => {
    const text = collectPvPdfText(makeChausseePv());
    expect(text).toContain('Établi et scellé par');
    expect(text).toContain('M. NDIAYE');
    expect(text).toContain('GEOTEST LABO');
  });

  it('MAJEUR-1 : carte STATUT descriptive (« Scellé (empreinte SHA-256 / HMAC) »), sans verdict ni jargon', () => {
    const text = collectPvPdfText(makeChausseePv());
    // Plus d'auto-attestation « Intégrité vérifiée » (un PDF exporté puis modifié
    // l'afficherait quand même) ni de jargon interne « Recalculé serveur ».
    expect(text.includes('Intégrité vérifiée')).toBe(false);
    expect(text.includes('Recalculé serveur')).toBe(false);
    // Libellé descriptif neutre.
    expect(text).toContain('Scellé (empreinte SHA-256');
  });

  it('RÉF PROJET : la ligne « Réf. <slug> » est RETIRÉE (projectName suffit)', () => {
    const text = collectPvPdfText(makeChausseePv());
    expect(text).toContain('Aménagement RN1 — Lot 3'); // libellé projet présent
    expect(text.includes('Réf. p-1')).toBe(false); // plus de réf slug
    expect(text.includes('Réf. ')).toBe(false);
  });

  it('NOTE SCIENCE : mention de co-validation sobre (pas « brouillon »)', () => {
    const text = collectPvPdfText(makeChausseePv());
    expect(text).toContain('co-validation avec l’expert');
    expect(text.toLowerCase().includes('brouillon')).toBe(false);
    expect(text.toLowerCase().includes('épreuve')).toBe(false);
  });

  it('QR vide RETIRÉ -> texte « Vérification en ligne : disponible en Phase 2 »', () => {
    const text = collectPvPdfText(makeChausseePv());
    expect(text).toContain('Vérification en ligne');
    expect(text).toContain('disponible en Phase 2');
  });

  it('FAIL-CLOSED (B-1/M-1) : un champ NON mappé n’est JAMAIS rendu (whitelist)', () => {
    // INVERSION de l'ancien test fail-open : un champ non prévu par le modèle (clé
    // plausiblement sensible) NE DOIT PAS apparaître au rendu — la voie riche est
    // une whitelist (DoD §8). La complétude « jamais omis » est garantie par le
    // test de complétude (pv-presentation.completeness.spec.ts), PAS par un rendu.
    const input = {
      ...(CHAUSSEE_INPUT as Record<string, unknown>),
      kr: 0.91, // coefficient de calage plausible (sensible) NON mappé
      sd2: 12.3, // intermédiaire plausible NON mappé
    } as SealableValue;
    const output = {
      ...(CHAUSSEE_OUTPUT as Record<string, unknown>),
      ks_interne: 1.234, // champ de sortie non mappé (sensible) NON mappé
    } as SealableValue;
    const text = collectPvPdfText(makeChausseePv({ input, output }));
    // AUCUN champ non mappé ne fuite, ni sa clé ni sa valeur.
    expect(text.includes('kr')).toBe(false);
    expect(text.includes('0,91')).toBe(false);
    expect(text.includes('sd2')).toBe(false);
    expect(text.includes('12,3')).toBe(false);
    expect(text.includes('ks_interne')).toBe(false);
    expect(text.includes('1,234')).toBe(false);
    // plus de section « Autres paramètres » du tout.
    expect(text.includes('AUTRES PARAM')).toBe(false);
    // le « projet » (clé moteur redondante) ne fuite plus non plus.
    expect(text.includes('Structure de reference')).toBe(false);
  });

  it('VÉRIFICATIONS : critère dimensionnant = orniérage (taux max) mis en avant', () => {
    // déjà couvert par les taux 141/174 ; ici on s'assure que le rendu ne casse
    // pas si fatigue est ABSENTE (moteur peut l'omettre) -> 1 seul critère affiché.
    const output = { ...(CHAUSSEE_OUTPUT as Record<string, unknown>) };
    delete output.fatigue;
    const text = collectPvPdfText(
      makeChausseePv({ output: output as SealableValue }),
    );
    expect(text).toContain('174'); // orniérage reste affiché
    // pas de crash, pas de « NaN ».
    expect(text.includes('NaN')).toBe(false);
  });

  // M-3 — un champ mappé qui résout vers un NON-SCALAIRE -> marqueur neutre,
  // JAMAIS JSON.stringify (anti-fuite de sous-champs confidentiels).
  it('M-3 : formatValue d’un objet/tableau -> « (structuré) », jamais le JSON brut', () => {
    const o = formatValue({ kr: 0.91, secret: 'X' });
    expect(o.value).toBe('(structuré)');
    expect(o.value.includes('kr')).toBe(false);
    expect(o.value.includes('0.91')).toBe(false);
    const a = formatValue([1, 2, 3]);
    expect(a.value).toBe('(structuré)');
    expect(a.value.includes('[')).toBe(false);
  });
});

// M-2 — le picto de verdict (✗/✓) est un CANVAS (Roboto n'a pas U+2713/U+2717) :
// invisible pour collectPvPdfText / pdf-parse. On le couvre par un TEST STRUCTUREL
// sur la docDefinition : la cellule de vérification porte un canvas ≥2 segments
// `line`, lineColor = COLORS.alert quand ok===false, COLORS.navy quand ok===true.
describe('#71 M-2 — picto verdict (canvas) couvert structurellement', () => {
  const prev = process.env.PV_SIGNING_SECRET;
  beforeAll(() => {
    process.env.PV_SIGNING_SECRET = SECRET;
  });
  afterAll(() => {
    if (prev === undefined) delete process.env.PV_SIGNING_SECRET;
    else process.env.PV_SIGNING_SECRET = prev;
  });

  it('ok===false (orniérage dépassé) -> croix canvas bordeaux (≥2 lignes, COLORS.alert)', () => {
    const def = buildPvDocDefinition(makeChausseePv());
    const marks = collectCanvasLines(def.content);
    // Au moins une cellule verdict avec un canvas multi-lignes en bordeaux (échec).
    const bad = marks.filter(
      (m) => m.length >= 2 && m.every((l) => l.lineColor === COLORS.alert),
    );
    expect(bad.length).toBeGreaterThanOrEqual(1);
  });

  it('ok===true -> coche canvas navy (≥2 lignes, COLORS.navy)', () => {
    // PV conforme + critère vérifié -> au moins une coche navy.
    const output = {
      ...(CHAUSSEE_OUTPUT as Record<string, unknown>),
      conforme: true,
      fatigue: {
        rigide: false,
        valeur: 100,
        admissible: 206,
        ok: true,
        requis: true,
      },
      ornierage: { valeur: 400, admissible: 511, ok: true },
    } as SealableValue;
    const def = buildPvDocDefinition(makeChausseePv({ output }));
    const marks = collectCanvasLines(def.content);
    const good = marks.filter(
      (m) => m.length >= 2 && m.every((l) => l.lineColor === COLORS.navy),
    );
    expect(good.length).toBeGreaterThanOrEqual(1);
  });
});

/** Récupère tous les groupes de segments `line` de tous les canvas de l'arbre. */
function collectCanvasLines(
  node: unknown,
): Array<Array<{ lineColor?: string }>> {
  const out: Array<Array<{ lineColor?: string }>> = [];
  const walk = (n: unknown): void => {
    if (n == null) return;
    if (Array.isArray(n)) {
      n.forEach(walk);
      return;
    }
    if (typeof n === 'object') {
      const o = n as Record<string, unknown>;
      if (Array.isArray(o.canvas)) {
        const lines = (o.canvas as Array<Record<string, unknown>>).filter(
          (c) => c.type === 'line',
        ) as Array<{ lineColor?: string }>;
        if (lines.length > 0) out.push(lines);
      }
      if (o.stack) walk(o.stack);
      if (o.columns) walk(o.columns);
      if (o.table && typeof o.table === 'object') {
        walk((o.table as { body?: unknown }).body);
      }
    }
  };
  walk(node);
  return out;
}

/**
 * Cherche dans la docDef une LIGNE de table à 3 colonnes (libellé|valeur|unité)
 * dont la 1re cellule texte === `label`, et renvoie { value, unit } des cellules
 * 2 et 3. Sert au mutation-check DISTINCT (cible la valeur EXACTE d'un champ, pas
 * une sous-chaîne du texte global). null si introuvable.
 */
function findRowValue(
  content: unknown,
  label: string,
): { value: string; unit: string } | null {
  let found: { value: string; unit: string } | null = null;
  const cellText = (c: unknown): string => {
    if (
      c &&
      typeof c === 'object' &&
      typeof (c as { text?: unknown }).text === 'string'
    ) {
      return (c as { text: string }).text;
    }
    return '';
  };
  const walk = (n: unknown): void => {
    if (found || n == null) return;
    if (Array.isArray(n)) {
      n.forEach(walk);
      return;
    }
    if (typeof n === 'object') {
      const o = n as Record<string, unknown>;
      const table = o.table as { body?: unknown[][] } | undefined;
      if (table?.body) {
        for (const row of table.body) {
          if (
            Array.isArray(row) &&
            row.length >= 3 &&
            cellText(row[0]) === label
          ) {
            found = { value: cellText(row[1]), unit: cellText(row[2]) };
            return;
          }
        }
      }
      Object.values(o).forEach(walk);
    }
  };
  walk(content);
  return found;
}

/** Variante chaussée avec un userDisplayName d'ingénieur SCELLÉ dans l'identité. */
function makeChausseePvWithEngineer(userDisplayName: string): OfficialPv {
  const base = makeChausseePv();
  const sealedAtIso = '2026-06-22T09:30:00.000Z';
  const content: SealableValue = {
    pvNumber: base.pvNumber,
    sealedAt: sealedAtIso,
    engineMeta: {
      engineId: 'chaussee-burmister',
      engineVersion: '1.0.0',
      engineSourceHash: 'a'.repeat(64),
    },
    identity: {
      userId: 'u-eng',
      userDisplayName,
      orgDisplayName: 'GEOTEST LABO',
      projectId: 'p-1',
      projectName: 'Aménagement RN1 — Lot 3',
    },
    input: CHAUSSEE_INPUT,
    output: CHAUSSEE_OUTPUT,
    scienceStatus: 'unsigned',
  };
  const canonical = canonicalize(content);
  return {
    ...base,
    inputCanonical: canonical,
    contentHash: sealContentHash(canonical),
    hmac: sealHmac(canonical, SECRET),
  };
}
