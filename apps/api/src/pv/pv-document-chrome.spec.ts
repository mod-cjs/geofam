/**
 * Tests unitaires du cartouche PV — wrapSealedDocumentWithPvChrome (PUR).
 *
 * given/when/then : on part d'un document d'outil BRUT (sans marque de PV) et on
 * prouve que la copie SERVIE porte le bandeau, le pied, le CSS scope, un <title>
 * de PV, les valeurs SCELLEES injectees, et que les valeurs sont ECHAPPEES (pas
 * d'injection HTML via un nom de projet). L'entree n'est jamais mutee.
 */
import {
  extractSealedIdentity,
  wrapSealedDocumentWithPvChrome,
  type PvChromeMeta,
} from './pv-document-chrome';

const RAW =
  '<!doctype html><html lang="fr"><head><meta charset="utf-8">' +
  '<title>Rapport ROADSENS</title></head>' +
  '<body><h1>Note de calcul</h1><p>NE = 1 467 314 µdef</p></body></html>';

const META: PvChromeMeta = {
  pvNumber: 'PV-RDS-starfire-recette-2026-000007',
  contentHash:
    '0f894005fb632c3ea7d1c2b3a4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f607',
  sealedAt: '2026-07-19T15:30:00.000Z',
  projectName: 'Route Dakar-Thiès — dimensionnement',
  userDisplayName: 'Ingénieur STARFIRE',
  orgDisplayName: 'STARFIRE Recette',
  engineId: 'chaussee-burmister',
  engineVersion: '2.0.0',
  verdict: 'NON_CONFORME',
};

describe('wrapSealedDocumentWithPvChrome', () => {
  it('given un document brut, when enrobe, then insere bandeau + pied', () => {
    const out = wrapSealedDocumentWithPvChrome(RAW, META);
    expect(out).toContain('class="pvx-band"');
    expect(out).toContain('class="pvx-foot"');
    // Bandeau (div) APRES <body>, pied (div) AVANT </body>. NB : les selecteurs
    // CSS `.pvx-band`/`.pvx-foot` vivent dans le <head> -> on cible les DIV.
    expect(out.indexOf('<div class="pvx-band">')).toBeGreaterThan(
      out.indexOf('<body>'),
    );
    expect(out.indexOf('<div class="pvx-foot">')).toBeLessThan(
      out.indexOf('</body>'),
    );
    // Le contenu ORIGINAL de l'outil est preserve entre les deux.
    expect(out).toContain('<h1>Note de calcul</h1>');
    expect(out).toContain('NE = 1 467 314 µdef');
  });

  it('given un document, when enrobe, then injecte le CSS scope avant </head>', () => {
    const out = wrapSealedDocumentWithPvChrome(RAW, META);
    expect(out).toContain('<style>');
    expect(out).toContain('.pvx-band{');
    expect(out.indexOf('.pvx-band{')).toBeLessThan(out.indexOf('</head>'));
    // Aucun <script> ni handler inline (contrainte §8 / CSP).
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toMatch(/\son[a-z]+=/i);
  });

  it('given un <title> existant, when enrobe, then remplace par le titre du PV', () => {
    const out = wrapSealedDocumentWithPvChrome(RAW, META);
    expect(out).toContain(
      '<title>Procès-verbal PV-RDS-starfire-recette-2026-000007</title>',
    );
    expect(out).not.toContain('<title>Rapport ROADSENS</title>');
    // Un seul <title> dans le document servi.
    expect(out.match(/<title>/g)?.length).toBe(1);
  });

  it('given un document SANS <title>, when enrobe, then insere le titre du PV', () => {
    const noTitle =
      '<!doctype html><html><head><meta charset="utf-8"></head><body><p>x</p></body></html>';
    const out = wrapSealedDocumentWithPvChrome(noTitle, META);
    expect(out).toContain(
      '<title>Procès-verbal PV-RDS-starfire-recette-2026-000007</title>',
    );
    expect(out.indexOf('<title>')).toBeLessThan(out.indexOf('</head>'));
  });

  it('given les meta scellees, when enrobe, then injecte numero/hash/emetteur/org', () => {
    const out = wrapSealedDocumentWithPvChrome(RAW, META);
    // Numero (bandeau + pied).
    expect(out).toContain('N° PV-RDS-starfire-recette-2026-000007');
    // Empreinte COMPLETE (64 hex) dans le pied.
    expect(out).toContain(META.contentHash);
    // Chip = 16 premiers hex tronques.
    expect(out).toContain(META.contentHash.slice(0, 16) + '…');
    // Identite scellee.
    expect(out).toContain('Ingénieur STARFIRE');
    expect(out).toContain('STARFIRE Recette');
    expect(out).toContain('Route Dakar-Thiès — dimensionnement');
    // Logiciel + version mappes.
    expect(out).toContain('ROADSENS — Chaussées');
    expect(out).toContain('Burmister v2.0.0');
    // Horodatage FR + UTC.
    expect(out).toContain('19/07/2026 · 15:30 UTC');
    // Note legale (wording juridique exact).
    expect(out).toContain(
      'Ne constitue pas une signature électronique qualifiée',
    );
    expect(out).toContain('loi 2008-08');
    expect(out).toContain("Vérification d'intégrité en ligne — Phase 2");
  });

  it('given verdict NON_CONFORME, when enrobe, then pastille « NON CONFORME » (rouge)', () => {
    const out = wrapSealedDocumentWithPvChrome(RAW, META);
    expect(out).toContain('pvx-pill--bad');
    expect(out).toContain('>NON CONFORME<');
  });

  it('given verdict CONFORME, when enrobe, then pastille « CONFORME » (verte)', () => {
    const out = wrapSealedDocumentWithPvChrome(RAW, {
      ...META,
      verdict: 'CONFORME',
    });
    expect(out).toContain('pvx-pill--ok');
    expect(out).toContain('>CONFORME<');
  });

  it('given un nom de projet contenant du HTML, when enrobe, then ECHAPPE (pas d injection)', () => {
    const out = wrapSealedDocumentWithPvChrome(RAW, {
      ...META,
      projectName: 'Route <script>alert(1)</script> & "Thiès"',
    });
    // Aucune balise script injectee via la valeur.
    expect(out).not.toContain('<script>alert(1)</script>');
    expect(out).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(out).toContain('&amp;');
    expect(out).toContain('&quot;Thiès&quot;');
  });

  it('given identite vide, when enrobe, then degrade proprement sans planter', () => {
    const out = wrapSealedDocumentWithPvChrome(RAW, {
      ...META,
      userDisplayName: '',
      orgDisplayName: '   ',
      verdict: null,
    });
    expect(out).toContain('(identité non renseignée)');
    expect(out).toContain('(organisation non renseignée)');
    expect(out).toContain('(verdict non renseigné)');
    expect(out).toContain('pvx-empty');
  });

  it('given un verdict NON_APPLICABLE, when enrobe, then pastille neutre', () => {
    const out = wrapSealedDocumentWithPvChrome(RAW, {
      ...META,
      verdict: 'NON_APPLICABLE',
    });
    expect(out).toContain('pvx-pill--na');
    expect(out).toContain('>NON APPLICABLE<');
  });

  it('given un moteur inconnu, when enrobe, then fallback engineId + version brute', () => {
    const out = wrapSealedDocumentWithPvChrome(RAW, {
      ...META,
      engineId: 'radier-plaque',
      engineVersion: '1.4.2',
    });
    expect(out).toContain('radier-plaque');
    expect(out).toContain('1.4.2');
  });

  it('given une entree, when enrobe, then n altere pas la chaine d origine', () => {
    const before = RAW;
    wrapSealedDocumentWithPvChrome(RAW, META);
    expect(RAW).toBe(before);
  });
});

describe('extractSealedIdentity', () => {
  it('given une canonique valide, when extrait, then rend emetteur + organisation', () => {
    const canonical = JSON.stringify({
      identity: {
        userDisplayName: 'Ingénieur STARFIRE',
        orgDisplayName: 'STARFIRE Recette',
      },
    });
    expect(extractSealedIdentity(canonical)).toEqual({
      userDisplayName: 'Ingénieur STARFIRE',
      orgDisplayName: 'STARFIRE Recette',
    });
  });

  it('given une canonique sans identity, when extrait, then rend des chaines vides', () => {
    expect(extractSealedIdentity('{}')).toEqual({
      userDisplayName: '',
      orgDisplayName: '',
    });
  });

  it('given une canonique illisible, when extrait, then degrade sans throw', () => {
    expect(extractSealedIdentity('not json')).toEqual({
      userDisplayName: '',
      orgDisplayName: '',
    });
  });
});
