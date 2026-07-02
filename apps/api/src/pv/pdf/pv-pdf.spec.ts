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
    const pv = makeSealedPv({ engineId: 'generic-fallback', output: { epaisseur: noisy, verdict: 'OK' } });

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
    const pv = makeSealedPv({ engineId: 'generic-fallback', output: { n: 20, p: 0.45, verdict: 'OK' } });
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
          { nom: 'ELU portance — MÉTHODE_INTERNE_kc=1.3', Fd: 100, Rd: 200, ok: true },
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
});
