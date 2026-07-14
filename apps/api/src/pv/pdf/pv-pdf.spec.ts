/**
 * Tests unitaires du générateur PDF du PV (#63-C, correctifs qa-challenger).
 *
 * CRIT-1 — SOURCE UNIQUE = input_canonical + FAIL-CLOSED :
 *   - tout le contenu rendu dérive de input_canonical PARSÉ (jamais des colonnes
 *     hors-sceau : pv.output / pv.contentHash / pv.pvNumber…) ;
 *   - le hash AFFICHÉ est RECALCULÉ depuis la canonique (sealContentHash), pas lu
 *     dans la colonne ;
 *   - verifySeal DOIT passer AVANT le rendu : un sceau invalide OU une canonique
 *     illisible -> LÈVE (pas de PDF dégradé).
 *   - scienceStatus est dans le canonique mais N'EST JAMAIS rendu (anti-fuite).
 */
import type { OfficialPv } from '@prisma/client';
import {
  canonicalize,
  sealContentHash,
  sealHmac,
  type SealableValue,
} from '@roadsen/shared';

import { buildPvDocDefinition, collectPvPdfText, renderPvPdf } from './pv-pdf';
import { COLORS } from './pv-pdf.theme';

const SECRET = 'secret-unitaire-pv';

/**
 * Construit un OfficialPv COHÉRENT (sceau valide). NB : les 6 moteurs réels ont
 * désormais chacun une présentation dédiée (burmister via modèle + buildFondationBody,
 * buildFonProfondeBody, buildRadierBody, buildLaboBody, buildPressiometreBody). Le
 * FALLBACK générique clé-valeur (formatNumber + projection brute) ne s'exécute donc que
 * pour un engineId SANS builder : les tests du fallback passent un `engineId` générique
 * explicite (voie de sécurité). Les tests #71 de présentation riche utilisent leur
 * propre fabrique chaussée.
 */
function makeSealedPv(
  overrides: Partial<{
    pvNumber: string;
    input: SealableValue;
    output: SealableValue;
    projectName: string;
    scienceStatus: string;
    engineId: string;
  }> = {},
): OfficialPv {
  const pvNumber = overrides.pvNumber ?? 'PV-RDS-org-a-2026-000001';
  const engineId = overrides.engineId ?? 'fondation-superficielle';
  const sealedAtIso = '2026-06-25T10:00:00.000Z';
  const output = overrides.output ?? { epaisseur: 0.32, verdict: 'OK' };
  const content: SealableValue = {
    pvNumber,
    sealedAt: sealedAtIso,
    engineMeta: {
      engineId,
      engineVersion: '1.0.0',
      engineSourceHash: 'a'.repeat(64),
    },
    identity: {
      userId: 'u-1',
      projectId: 'p-1',
      projectName: overrides.projectName ?? 'Route A',
    },
    input: overrides.input ?? { trafic: 'T1', module: '1,5' },
    output,
    scienceStatus: overrides.scienceStatus ?? 'unsigned',
  };
  const canonical = canonicalize(content);
  return {
    id: 'pv-1',
    orgId: '11111111-1111-1111-1111-111111111111',
    calcResultId: 'c-1',
    projectId: 'p-1',
    pvNumber,
    userId: 'u-1',
    projectName: overrides.projectName ?? 'Route A',
    engineId,
    engineVersion: '1.0.0',
    engineSourceHash: 'a'.repeat(64),
    inputCanonical: canonical,
    output: output,
    scienceStatus: overrides.scienceStatus ?? 'unsigned',
    verdict: 'NON_APPLICABLE',
    contentHash: sealContentHash(canonical),
    hmac: sealHmac(canonical, SECRET),
    sealedAt: new Date(sealedAtIso),
  };
}

describe('CRIT-1 — fail-closed + source unique input_canonical', () => {
  const prevSecret = process.env.PV_SIGNING_SECRET;
  beforeAll(() => {
    process.env.PV_SIGNING_SECRET = SECRET;
  });
  afterAll(() => {
    if (prevSecret === undefined) delete process.env.PV_SIGNING_SECRET;
    else process.env.PV_SIGNING_SECRET = prevSecret;
  });

  it('PV au sceau VALIDE : rend la docDef + le hash affiché = recalculé', () => {
    const pv = makeSealedPv();
    const def = buildPvDocDefinition(pv);
    expect(def).toBeDefined();
    const text = collectPvPdfText(pv);
    // hash affiché = sealContentHash(inputCanonical) (recalculé), pas la colonne.
    const recomputed = sealContentHash(pv.inputCanonical);
    expect(text).toContain(recomputed);
    expect(recomputed).toBe(pv.contentHash); // ici colonne == recalcul (cohérent)
  });

  it('FAIL-CLOSED : sceau INVALIDE (hmac falsifié) -> LÈVE (pas de PDF)', () => {
    const pv = makeSealedPv();
    const tampered: OfficialPv = { ...pv, hmac: 'f'.repeat(64) };
    expect(() => buildPvDocDefinition(tampered)).toThrow(
      /sceau|intégrit|invalide/i,
    );
    return expect(renderPvPdf(tampered)).rejects.toThrow(
      /sceau|intégrit|invalide/i,
    );
  });

  it('FAIL-CLOSED : content_hash de colonne falsifié (≠ recalcul) -> LÈVE', () => {
    const pv = makeSealedPv();
    const tampered: OfficialPv = { ...pv, contentHash: 'b'.repeat(64) };
    expect(() => buildPvDocDefinition(tampered)).toThrow(
      /sceau|intégrit|invalide/i,
    );
  });

  it('FAIL-CLOSED : input_canonical illisible -> LÈVE (pas de rendu dégradé)', () => {
    const pv = makeSealedPv();
    const broken: OfficialPv = { ...pv, inputCanonical: '{ pas du json' };
    expect(() => buildPvDocDefinition(broken)).toThrow();
  });

  it('SOURCE UNIQUE : une colonne hors-sceau altérée n’apparaît PAS dans le rendu', () => {
    // On part d'un PV valide, puis on falsifie SEULEMENT des colonnes hors-sceau
    // (pvNumber, output, projectName) SANS toucher input_canonical/hmac/contentHash.
    // Le sceau reste valide (il ne couvre que la canonique) -> le PDF se rend, MAIS
    // ne doit montrer QUE les valeurs canoniques, jamais les colonnes falsifiées.
    const pv = makeSealedPv({
      pvNumber: 'PV-RDS-org-a-2026-000001',
      output: { epaisseur: 0.32, verdict: 'OK' },
      projectName: 'Route A',
    });
    const falsified: OfficialPv = {
      ...pv,
      pvNumber: 'PV-RDS-FRAUDE-9999',
      projectName: 'PROJET FALSIFIE',
      output: { epaisseur: 9.99, verdict: 'FRAUDE' },
    };
    const text = collectPvPdfText(falsified);
    // Valeurs CANONIQUES présentes :
    expect(text).toContain('PV-RDS-org-a-2026-000001');
    expect(text).toContain('Route A');
    // Valeurs de COLONNE falsifiées ABSENTES :
    expect(text.includes('PV-RDS-FRAUDE-9999')).toBe(false);
    expect(text.includes('PROJET FALSIFIE')).toBe(false);
    expect(text.includes('FRAUDE')).toBe(false);
    expect(text.includes('9.99')).toBe(false);
  });

  it('ANTI-FUITE : scienceStatus (dans le canonique) n’est JAMAIS rendu', () => {
    const pv = makeSealedPv({ scienceStatus: 'unsigned' });
    const text = collectPvPdfText(pv).toLowerCase();
    expect(text.includes('unsigned')).toBe(false);
    expect(text.includes('science')).toBe(false);
  });
});

describe('Bruit flottant IEEE-754 — nettoyé À L’AFFICHAGE seulement', () => {
  const prevSecret = process.env.PV_SIGNING_SECRET;
  beforeAll(() => {
    process.env.PV_SIGNING_SECRET = SECRET;
  });
  afterAll(() => {
    if (prevSecret === undefined) delete process.env.PV_SIGNING_SECRET;
    else process.env.PV_SIGNING_SECRET = prevSecret;
  });

  it('un double bruité (0.41000000000000003) s’affiche « 0,41 » (toPrecision 12, FR)', () => {
    // La SORTIE scellée contient le double EXACT issu du calcul (0.16+0.25 != 0.41).
    const noisy = 0.16 + 0.25; // = 0.41000000000000003
    expect(noisy).not.toBe(0.41); // c'est bien le double bruité
    const pv = makeSealedPv({
      engineId: 'generic-fallback',
      output: { epaisseur: noisy, verdict: 'OK' },
    });

    // LE SCELLEMENT reste INTOUCHÉ : la canonique contient le double exact bruité.
    expect(pv.inputCanonical).toContain('0.41000000000000003');

    // L'AFFICHAGE est nettoyé (virgule FR) : « 0,41 » apparaît, JAMAIS la forme bruitée.
    const text = collectPvPdfText(pv);
    expect(text).toContain('0,41');
    expect(text.includes('0.41000000000000003')).toBe(false);
    expect(text.includes('0,41000000000000003')).toBe(false);
  });

  it('une vraie valeur à 6-8 chiffres reste INTACTE (pas d’arrondi métier)', () => {
    // 290.5841975093014 -> toPrecision(12) garde 290.584197509 (>8 sig. figs) :
    // on ne supprime QUE l'artefact binaire, pas de la précision réelle.
    const pv = makeSealedPv({
      engineId: 'generic-fallback',
      output: { valeur: 290.5841975093014, verdict: 'OK' },
    });
    const text = collectPvPdfText(pv);
    // Les chiffres significatifs sont préservés (rendu FR : virgule).
    expect(text).toContain('290,584197');
  });

  it('un entier ou un petit décimal exact reste inchangé (FR)', () => {
    const pv = makeSealedPv({
      engineId: 'generic-fallback',
      output: { n: 20, p: 0.45, verdict: 'OK' },
    });
    const text = collectPvPdfText(pv);
    expect(text).toContain('20');
    expect(text).toContain('0,45');
  });

  it('FORMATAGE = AFFICHAGE SEUL : le content_hash recalculé est celui de la canonique NON formatée', () => {
    // Sentinelle clé : prouve que le formatage d'affichage ne change RIEN au sceau.
    const noisy = 0.16 + 0.25;
    const pv = makeSealedPv({ output: { epaisseur: noisy, verdict: 'OK' } });

    // Le hash recalculé au rendu = sealContentHash(canonique BRUTE, non formatée).
    const recomputed = sealContentHash(pv.inputCanonical);
    expect(recomputed).toBe(pv.contentHash); // sceau cohérent
    // La canonique (donc le hash) contient le double EXACT, pas « 0,41 ».
    expect(pv.inputCanonical).toContain('0.41000000000000003');
    expect(pv.inputCanonical.includes('0,41')).toBe(false);
    // Le hash AFFICHÉ dans le PDF = ce recompute (empreinte de la donnée exacte).
    const text = collectPvPdfText(pv);
    expect(text).toContain(recomputed);
    // sealValid resterait true (le rendu n'altère pas la donnée scellée) : on le
    // prouve indirectement — buildPvDocDefinition n'a pas levé (sceau valide).
    expect(() => buildPvDocDefinition(pv)).not.toThrow();
  });

  it('note d’honnêteté + INTÉGRITÉ/PORTÉE (validée fiscal-juridique, anti-surcote)', () => {
    const pv = makeSealedPv();
    const raw = collectPvPdfText(pv);
    const text = raw.toLowerCase();
    // Note d'affichage (version de référence) conservée.
    expect(raw).toContain('version de référence du contenu');
    // NOUVELLE note d'intégrité/portée (texte exact validé juridiquement).
    expect(raw).toContain('Document scellé pour contrôle d’intégrité');
    expect(raw).toContain(
      'la responsabilité de l’étude reste à l’ingénieur signataire',
    );
    expect(raw).toContain('Ne vaut pas signature électronique qualifiée');
    expect(raw).toContain('loi 2008-08');
    // TERMES JURIDIQUES BANNIS du document (sens probatoire non acquis).
    for (const banned of [
      'fait foi',
      'valeur probante',
      'certifié',
      'opposable',
      'authentifié',
    ]) {
      expect(text.includes(banned)).toBe(false);
    }
    // « vérifiable » non qualifié toujours retiré.
    expect(text.includes('— vérifiable')).toBe(false);
  });
});

describe('PV pieux — allowlist fail-closed du libellé de vérification (DoD §8)', () => {
  const prevSecret = process.env.PV_SIGNING_SECRET;
  beforeAll(() => {
    process.env.PV_SIGNING_SECRET = SECRET;
  });
  afterAll(() => {
    if (prevSecret === undefined) delete process.env.PV_SIGNING_SECRET;
    else process.env.PV_SIGNING_SECRET = prevSecret;
  });

  it('un nom de vérification NON whitelisté ne s’imprime PAS au PV (libellé générique)', () => {
    const pv = makeSealedPv({
      engineId: 'fondation-profonde-pieux',
      output: {
        allOk: true,
        RbK: 800,
        RsK: 1000,
        RcK: 1800,
        RcD: 1500,
        RcrK: 1200,
        tassementELS: 5,
        verifications: [
          {
            nom: 'ELU portance — MÉTHODE_INTERNE_kc=1.3',
            Fd: 100,
            Rd: 200,
            ok: true,
          },
          { nom: 'ELS caractéristique', Fd: 90, Rd: 180, ok: true },
        ],
      },
    });
    const text = collectPvPdfText(pv);
    // Le texte moteur piégé NE traverse PAS vers le livrable scellé.
    expect(text.includes('MÉTHODE_INTERNE')).toBe(false);
    expect(text.includes('kc=1.3')).toBe(false);
    // Repli générique indexé pour le nom non reconnu.
    expect(text).toContain('Vérification 1');
    // Le nom EC7 reconnu passe intact.
    expect(text).toContain('ELS caractéristique');
  });

  it('affiche le frottement négatif (#94) et la vérif béton (#95) quand calculés', () => {
    const pv = makeSealedPv({
      engineId: 'fondation-profonde-pieux',
      output: {
        allOk: true,
        RbK: 800,
        RsK: 1000,
        RcD: 1500,
        tassementELS: 5,
        // Frottement négatif (downdrag)
        Gsn: 250,
        Nmax: 1750,
        pointNeutre: 8.5,
        // Vérification structurale du béton
        betonApplicable: true,
        betonTauxELU: 0.75,
        betonOkELU: true,
        betonTauxELS: 0.5,
        betonOkELS: true,
        betonFcd: 14.2,
      },
    });
    const text = collectPvPdfText(pv);
    // Contenu (les titres de section ne sont pas collectés par collectPvPdfText).
    expect(text).toContain('Charge de frottement négatif');
    expect(text).toContain('G_sn');
    expect(text).toContain('250'); // Gsn kN
    expect(text).toContain('Taux béton');
    expect(text).toContain('75'); // taux ELU 0.75 -> 75 %
    expect(text).toContain('f_cd');
  });

  it('n’affiche AUCUNE section frottement négatif / béton quand non calculés (fail-closed)', () => {
    const pv = makeSealedPv({
      engineId: 'fondation-profonde-pieux',
      output: {
        allOk: true,
        RbK: 800,
        RsK: 1000,
        RcD: 1500,
        tassementELS: 5,
        // Gsn/Nmax/pointNeutre absents, betonApplicable absent (null)
      },
    });
    const text = collectPvPdfText(pv);
    expect(text.includes('Charge de frottement négatif')).toBe(false);
    expect(text.includes('Taux béton')).toBe(false);
    expect(text.includes('Non applicable')).toBe(false);
    expect(text.includes('NaN')).toBe(false);
  });

  it('affiche « Non applicable » quand betonApplicable=false (cas na)', () => {
    const pv = makeSealedPv({
      engineId: 'fondation-profonde-pieux',
      output: { allOk: true, RbK: 800, RcD: 1500, betonApplicable: false },
    });
    const text = collectPvPdfText(pv);
    expect(text).toContain('Non applicable');
  });
});

describe('PV pieux — TRANSPARENCE des paramètres réglementaires EC7 / NF P 94-262', () => {
  const prevSecret = process.env.PV_SIGNING_SECRET;
  beforeAll(() => {
    process.env.PV_SIGNING_SECRET = SECRET;
  });
  afterAll(() => {
    if (prevSecret === undefined) delete process.env.PV_SIGNING_SECRET;
    else process.env.PV_SIGNING_SECRET = prevSecret;
  });

  /** Coeffs par défaut du contrat pieux (aucun écart -> rien de tracé sauf da+ψ₂). */
  const DEFAULT_COEFFS = {
    k_gG: 1.35,
    k_gQ: 1.5,
    k_gb: 1.1,
    k_gs: 1.1,
    k_gst: 1.15,
    k_psi2: 0.3,
    cr_b_b: 0.7,
    cr_b_s: 0.7,
    cr_f_b: 0.5,
    cr_f_s: 0.7,
    cr_car: 0.9,
    cr_qp: 1.1,
    cr_car_t: 1.1,
    cr_qp_t: 1.5,
  };
  const OUTPUT = { allOk: true, RbK: 800, RcD: 1500 };

  it('TOUJOURS : approche de calcul (da) + ψ₂ tracés, même quand tous les coeffs sont par défaut', () => {
    const pv = makeSealedPv({
      engineId: 'fondation-profonde-pieux',
      input: { da: 'da2', coeffs: DEFAULT_COEFFS },
      output: OUTPUT,
    });
    const text = collectPvPdfText(pv);
    // Approche de calcul : da2 -> libellé normatif « DA2 (NA France) ».
    expect(text).toContain('Approche de calcul EC7');
    expect(text).toContain('DA2 (NA France)');
    // ψ₂ non universel -> TOUJOURS affiché (valeur défaut 0,3 comprise).
    expect(text).toContain('ψ₂ (quasi-permanent)');
    // Coeffs par défaut : AUCUN autre coefficient tracé.
    expect(text.includes('γG (permanente défavorable)')).toBe(false);
    expect(text.includes('γb (pointe, R2)')).toBe(false);
    expect(text.includes('γs;t (traction, R2)')).toBe(false);
    expect(text.includes('Rc;cr;k coef.')).toBe(false);
  });

  it('un coeff NON-DÉFAUT apparaît avec son libellé normatif ; les coeffs restés par défaut n’apparaissent PAS', () => {
    const pv = makeSealedPv({
      engineId: 'fondation-profonde-pieux',
      input: {
        da: 'da3',
        coeffs: {
          ...DEFAULT_COEFFS,
          k_gb: 1.2, // ≠ défaut (1,1)
          k_gst: 1.25, // ≠ défaut (1,15)
          cr_car: 0.85, // ≠ défaut (0,90)
        },
      },
      output: OUTPUT,
    });
    const def = buildPvDocDefinition(pv);
    const text = collectPvPdfText(pv);
    // Approche : da3 -> « DA3 ».
    expect(text).toContain('DA3');
    // Coeffs non-défaut : libellé + valeur (ciblage EXACT de la cellule valeur).
    expect(findRowValue(def.content, 'γb (pointe, R2)')?.value).toBe('1,2');
    expect(findRowValue(def.content, 'γs;t (traction, R2)')?.value).toBe(
      '1,25',
    );
    expect(
      findRowValue(
        def.content,
        'coef. fluage ELS caractéristique (compression)',
      )?.value,
    ).toBe('0,85');
    // Coeffs restés par défaut : ABSENTS (transparence = seulement les écarts).
    expect(text.includes('γG (permanente défavorable)')).toBe(false);
    expect(text.includes('γs (frottement, R2)')).toBe(false);
    expect(text.includes('γ fluage ELS q.perm. (compression)')).toBe(false);
  });

  it('FAIL-CLOSED : ni coeffs ni da dans l’entrée scellée -> AUCUNE section réglementaire (pas de crash)', () => {
    const pv = makeSealedPv({
      engineId: 'fondation-profonde-pieux',
      input: { pieu: 'P1' }, // pas de coeffs, pas de da
      output: OUTPUT,
    });
    const text = collectPvPdfText(pv);
    expect(text.includes('Approche de calcul EC7')).toBe(false);
    expect(text.includes('ψ₂ (quasi-permanent)')).toBe(false);
    // Le titre de section (majuscules) ne doit pas non plus apparaître.
    expect(text.includes('PARAMÈTRES RÉGLEMENTAIRES')).toBe(false);
    expect(text.includes('NaN')).toBe(false);
  });

  it('FAIL-CLOSED partiel : da présent mais coeffs absents -> approche tracée, ψ₂ non (pas de crash)', () => {
    const pv = makeSealedPv({
      engineId: 'fondation-profonde-pieux',
      input: { da: 'da1' }, // da seul, pas de coeffs
      output: OUTPUT,
    });
    const text = collectPvPdfText(pv);
    expect(text).toContain('Approche de calcul EC7');
    expect(text).toContain('DA1');
    expect(text.includes('ψ₂ (quasi-permanent)')).toBe(false);
    expect(text.includes('NaN')).toBe(false);
  });
});

describe('PV labo — complétude d’affichage des essais (#106)', () => {
  const prevSecret = process.env.PV_SIGNING_SECRET;
  beforeAll(() => {
    process.env.PV_SIGNING_SECRET = SECRET;
  });
  afterAll(() => {
    if (prevSecret === undefined) delete process.env.PV_SIGNING_SECRET;
    else process.env.PV_SIGNING_SECRET = prevSecret;
  });

  it('affiche les essais granulats + mécaniques + masses volumiques quand renseignés', () => {
    const pv = makeSealedPv({
      engineId: 'labo-classification-gtr',
      output: {
        erreur: null,
        warnings: [],
        Cu: 12.4,
        es: 65,
        la: 25,
        sz: 22,
        mde: 18,
        so3: 0.3,
        qu: 2.5,
        cu_uu: 45,
        k: 1.2e-7,
        gonfl: 1.5,
        rhos: 2.65,
        classe: {
          fam: 'B',
          code: 'B5',
          full: 'B5',
          desc: 'x',
          path: ['coefficient secret = 9.9 → B5.'],
          warn: [],
          etat: null,
          stApplies: false,
          rNote: null,
        },
      },
    });
    const text = collectPvPdfText(pv);
    expect(text).toContain('Los Angeles');
    expect(text).toContain('Micro-Deval');
    expect(text).toContain('Équivalent de sable');
    expect(text).toContain('compression simple');
    expect(text).toContain('Perméabilité');
    expect(text).toContain('Masse volumique des grains');
    // allowlist fail-closed : un libellé de path hors gabarit est écarté du PV.
    expect(text.includes('coefficient secret')).toBe(false);
  });

  it('chemin de décision : path allowlisté + desc affichés ; warn (maturité) JAMAIS', () => {
    const pv = makeSealedPv({
      engineId: 'labo-classification-gtr',
      output: {
        erreur: null,
        warnings: [],
        p80: 52,
        ip: 18,
        classe: {
          fam: 'A',
          code: 'A2',
          full: 'A2 h',
          desc: 'Sables fins argileux, limons, argiles peu plastiques',
          warn: ['Distinction C1/C2 : heuristique provisoire.'],
          path: [
            'Passant 80µm = 52.0 % > 35 % → sol fin → famille A.',
            'Ip = 18.0 (préférentiel) → A2.',
            'facteur interne = 1.3 → A2.',
          ],
          etat: 'h',
          stApplies: true,
          rNote: null,
        },
      },
    });
    const text = collectPvPdfText(pv);
    expect(text).toContain('Sables fins'); // desc (client-safe)
    expect(text).toContain('sol fin → famille A'); // path allowlisté
    expect(text.includes('facteur interne')).toBe(false); // injection écartée
    expect(text.includes('heuristique provisoire')).toBe(false); // warn jamais imprimé
  });
});

/**
 * Cherche dans la docDef une LIGNE de table dont la 1re cellule texte === `label`,
 * et renvoie { value, unit } des cellules 2 et 3 (cible la valeur EXACTE d'un
 * champ, pas une sous-chaîne du texte global). null si introuvable.
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
            row.length >= 2 &&
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

/** Concatène TOUT le texte sous un nœud (stack/columns/table). Sert à lire le
 * contenu d'un encadré repéré par sa couleur de fond. */
function nodeText(n: unknown): string {
  const parts: string[] = [];
  const walk = (x: unknown): void => {
    if (x == null) return;
    if (typeof x === 'string') {
      parts.push(x);
      return;
    }
    if (Array.isArray(x)) {
      x.forEach(walk);
      return;
    }
    if (typeof x === 'object') {
      const o = x as Record<string, unknown>;
      if (typeof o.text === 'string') parts.push(o.text);
      else if (o.text != null) walk(o.text);
      if (o.stack) walk(o.stack);
      if (o.columns) walk(o.columns);
      const table = o.table as { body?: unknown } | undefined;
      if (table?.body) walk(table.body);
    }
  };
  walk(n);
  return parts.join(' ');
}

/** Texte de TOUS les nœuds ayant un fond de couleur `fill` (test de PROÉMINENCE :
 * un encadré coloré, pas une ligne noyée dans une table). */
function findFilledText(content: unknown, fill: string): string[] {
  const out: string[] = [];
  const walk = (n: unknown): void => {
    if (n == null) return;
    if (Array.isArray(n)) {
      n.forEach(walk);
      return;
    }
    if (typeof n === 'object') {
      const o = n as Record<string, unknown>;
      if (o.fillColor === fill) out.push(nodeText(o));
      Object.values(o).forEach(walk);
    }
  };
  walk(content);
  return out;
}

/**
 * PV RADIER / GEOPLAQUE — complétude de la synthèse + proéminence de l'alerte de
 * poinçonnement (lot ADR 0014). Le moteur expose désormais dans la sortie scellée
 * les diagnostics globaux du panneau « Synthèse » de l'outil client (bilans de
 * charge/réaction, rotations, réactions/moments extrêmes) + conditionnels
 * Winkler/ressorts/décollement (null si option inactive) + le warning de
 * poinçonnement (résultats NON VALIDES). Le PDF doit les rendre — sans « — »
 * parasites sur les options inactives, et le poinçonnement en ENCADRÉ D'ALERTE.
 */
describe('PV radier — synthèse (ADR 0014) + alerte de poinçonnement', () => {
  const prevSecret = process.env.PV_SIGNING_SECRET;
  beforeAll(() => {
    process.env.PV_SIGNING_SECRET = SECRET;
  });
  afterAll(() => {
    if (prevSecret === undefined) delete process.env.PV_SIGNING_SECRET;
    else process.env.PV_SIGNING_SECRET = prevSecret;
  });

  /** Sortie radier représentative — options Winkler/ressorts/décollement INACTIVES
   * (conditionnels null). tassements mm, distorsions ‰ (unités TRANCHÉES). */
  const RADIER_OUT: SealableValue = {
    erreur: null,
    warnings: [],
    wMax: 6.25,
    wMin: 1.1,
    diff: 5.15,
    slopeMax: 0.8,
    tiltMax: 0.3,
    betaIntra: 1.2,
    betaInter: 0,
    interDiff: 0,
    betaGov: 1.2,
    nRafts: 1,
    totalLoad: 1200,
    sumReact: 1200,
    txMax: 0.45,
    tyMax: 0.38,
    pMin: 12.3,
    pMax: 210.7,
    mxMax: 88.2,
    myMax: 61.4,
    mxyMax: 15.9,
    sumWink: null,
    sumSpr: null,
    decolNodes: null,
    worstLoadPair: null,
  };

  // Message CLIENT-SAFE émis par le moteur (OVER_CAP_WARNING) — recopié verbatim.
  const OVER_CAP =
    "Capacite de l'interface depassee (poinconnement) : la reaction requise excede le " +
    "seuil de plastification q_lim sans qu'un equilibre admissible soit atteint — " +
    'resultats a considerer comme NON VALIDES. Augmenter q_lim, elargir la fondation ou ' +
    'reduire la charge.';

  it('rend la synthèse : charge/réactions, rotations θx/θy, réactions sol min/max, |Mx|/|My|/|Mxy|', () => {
    const pv = makeSealedPv({ engineId: 'radier-plaque', output: RADIER_OUT });
    const def = buildPvDocDefinition(pv);
    // fdnKvRow rend « valeur unité » dans une SEULE cellule (index 1).
    expect(findRowValue(def.content, 'Charge appliquée Σ')?.value).toMatch(
      /kN$/,
    );
    expect(findRowValue(def.content, 'Σ réactions du sol')?.value).toMatch(
      /kN$/,
    );
    expect(findRowValue(def.content, 'Rotation θx max')?.value).toMatch(/‰$/);
    expect(findRowValue(def.content, 'Rotation θy max')?.value).toMatch(/‰$/);
    expect(
      findRowValue(def.content, 'Réaction de sol minimale')?.value,
    ).toMatch(/kPa$/);
    expect(
      findRowValue(def.content, 'Réaction de sol maximale')?.value,
    ).toMatch(/kPa$/);
    expect(findRowValue(def.content, 'Moment |Mx| max')?.value).toMatch(
      /kN·m\/ml$/,
    );
    expect(findRowValue(def.content, 'Moment |My| max')?.value).toMatch(
      /kN·m\/ml$/,
    );
    expect(
      findRowValue(def.content, 'Moment de torsion |Mxy| max')?.value,
    ).toMatch(/kN·m\/ml$/);
    // Valeur exacte d'une ligne (pas une sous-chaîne globale).
    expect(findRowValue(def.content, 'Réaction de sol maximale')?.value).toBe(
      '210,7 kPa',
    );
  });

  it('conditionnels INACTIFS (Winkler/ressorts/décollement = null) : lignes OMISES, aucun « — » parasite', () => {
    const pv = makeSealedPv({ engineId: 'radier-plaque', output: RADIER_OUT });
    const def = buildPvDocDefinition(pv);
    // La section de synthèse EST rendue (ligne non conditionnelle présente)…
    expect(findRowValue(def.content, 'Charge appliquée Σ')).not.toBeNull();
    // …mais les grandeurs d'options inactives sont ABSENTES (pas de ligne « — »).
    expect(findRowValue(def.content, 'Σ réaction de Winkler')).toBeNull();
    expect(findRowValue(def.content, 'Σ réaction des ressorts')).toBeNull();
    expect(
      findRowValue(def.content, 'Nœuds décollés (contact unilatéral)'),
    ).toBeNull();
    expect(collectPvPdfText(pv)).not.toContain('Winkler');
  });

  it('conditionnels ACTIFS : Winkler/ressorts affichés (kN) ; 0 nœud décollé RENDU (décollement actif ≠ omis)', () => {
    const pv = makeSealedPv({
      engineId: 'radier-plaque',
      output: { ...RADIER_OUT, sumWink: 120.5, sumSpr: 45, decolNodes: 0 },
    });
    const def = buildPvDocDefinition(pv);
    expect(findRowValue(def.content, 'Σ réaction de Winkler')?.value).toMatch(
      /kN$/,
    );
    expect(findRowValue(def.content, 'Σ réaction des ressorts')?.value).toMatch(
      /kN$/,
    );
    // décollement ACTIF avec 0 nœud décollé : la ligne existe et vaut « 0 »
    // (distinct de l'option inactive, qui l'omet).
    expect(
      findRowValue(def.content, 'Nœuds décollés (contact unilatéral)')?.value,
    ).toBe('0');
  });

  it('warning de poinçonnement : ENCADRÉ D’ALERTE proéminent (fond bordeaux) mentionnant NON VALIDES', () => {
    const pv = makeSealedPv({
      engineId: 'radier-plaque',
      output: { ...RADIER_OUT, warnings: [OVER_CAP] },
    });
    const def = buildPvDocDefinition(pv);
    const alerts = findFilledText(def.content, COLORS.alert);
    expect(alerts.length).toBeGreaterThan(0);
    const joined = alerts.join(' ');
    expect(joined).toMatch(/NON VALIDES/i);
    expect(joined).toMatch(/poincon|poinçonn/i);
  });

  it('sans warning : AUCUN encadré d’alerte (pas de faux positif)', () => {
    const pv = makeSealedPv({ engineId: 'radier-plaque', output: RADIER_OUT });
    const def = buildPvDocDefinition(pv);
    expect(findFilledText(def.content, COLORS.alert)).toHaveLength(0);
  });

  it('rendu réel en Buffer : PV radier complet (synthèse + alerte + glyphes ‰/·) sans erreur', async () => {
    const pv = makeSealedPv({
      engineId: 'radier-plaque',
      output: {
        ...RADIER_OUT,
        sumWink: 120.5,
        sumSpr: 45,
        decolNodes: 0,
        warnings: [OVER_CAP],
      },
    });
    const buf = await renderPvPdf(pv);
    expect(buf.length).toBeGreaterThan(0);
  });
});
