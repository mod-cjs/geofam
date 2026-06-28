/**
 * Tests de la PRIMITIVE DE SCELLEMENT des PV (BUILD #63 — incrément A).
 *
 * Zone CRITIQUE (intégrité). Le scellement = SHA-256 (empreinte de contenu) +
 * HMAC-SHA256 (preuve d'origine, clé `PV_SIGNING_SECRET`) sur une sérialisation
 * CANONIQUE et DÉTERMINISTE du contenu scellé.
 *
 * Criteres prouves ici (test-first, red->green) :
 *   G1 — REPRODUCTIBILITE : un meme contenu -> MEME chaine canonique, MEME hash,
 *        MEME hmac, a N appels (aucune source de non-determinisme dans la
 *        primitive : pas de Date, pas de random, ordre des cles indifferent).
 *   G2 — DETECTION D'ALTERATION : changer UN champ (meme '1,5' -> '1,50', meme
 *        un espace) change le hash ET le hmac -> verifySeal echoue.
 *   G3 — CANONICALISATION LEXICALE-STABLE, PAS semantique-numerique : la valeur
 *        DEJA PROJETEE (telle que stockee) est rendue stable PAR TRI DE CLES ;
 *        on ne "normalise" PAS '1,5' en 1.5 (sinon le sceau serait irreproductible
 *        et masquerait une alteration de la chaine FR stockee). Le nombre 1.5 et
 *        la chaine '1.5' sont DISTINCTS (types distincts -> sceaux distincts).
 *   G4 — HMAC : depend du secret (secret different -> hmac different) ; verifySeal
 *        a comparaison TEMPS CONSTANT ; un hmac/hash falsifie est rejete.
 */
import { describe, expect, it } from 'vitest';

import { canonicalize, sealContentHash, sealHmac, verifySeal } from './seal.js';

const SECRET = 'secret-de-test-pv-roadsen';
const AUTRE_SECRET = 'un-autre-secret';

// Contenu scellé REPRESENTATIF d'un PV : input projeté (avec une chaine FR non
// pré-convertie '1,5'), output, méta moteur, identité, numéro, timestamp FIGE.
// Tout est fourni par l'appelant (incrément B) : la primitive ne fabrique RIEN.
const contenu = {
  pvNumber: 'PV-RDS-be-test-2026-000001',
  sealedAt: '2026-06-25T10:00:00.000Z',
  engineMeta: {
    engineId: 'chaussee-burmister',
    engineVersion: '1.0.0',
    engineSourceHash: 'a'.repeat(64),
  },
  identity: { userId: 'u-1', projectId: 'p-1', projectName: 'Route A' },
  input: { trafic: 'T1', module: '1,5' }, // '1,5' = chaine FR, NON pre-convertie
  output: { epaisseur: 0.32, verdict: 'OK' },
  scienceStatus: 'unsigned',
};

describe('G1 — reproductibilite (déterminisme)', () => {
  it('canonicalize : meme valeur -> MEME chaine a 100 appels', () => {
    const ref = canonicalize(contenu);
    for (let i = 0; i < 100; i++) {
      expect(canonicalize(contenu)).toBe(ref);
    }
  });

  it('canonicalize : ordre d insertion des cles INDIFFERENT (tri recursif)', () => {
    // Meme contenu, cles saisies dans un ordre different a tous les niveaux.
    const memeContenuOrdreDifferent = {
      scienceStatus: 'unsigned',
      output: { verdict: 'OK', epaisseur: 0.32 },
      input: { module: '1,5', trafic: 'T1' },
      identity: { projectName: 'Route A', projectId: 'p-1', userId: 'u-1' },
      engineMeta: {
        engineSourceHash: 'a'.repeat(64),
        engineVersion: '1.0.0',
        engineId: 'chaussee-burmister',
      },
      sealedAt: '2026-06-25T10:00:00.000Z',
      pvNumber: 'PV-RDS-be-test-2026-000001',
    };
    expect(canonicalize(memeContenuOrdreDifferent)).toBe(canonicalize(contenu));
  });

  it('hash + hmac : memes valeurs a 100 appels (aucun non-determinisme)', () => {
    const c = canonicalize(contenu);
    const h = sealContentHash(c);
    const m = sealHmac(c, SECRET);
    expect(h).toMatch(/^[0-9a-f]{64}$/); // SHA-256 hex
    expect(m).toMatch(/^[0-9a-f]{64}$/); // HMAC-SHA256 hex
    for (let i = 0; i < 100; i++) {
      expect(sealContentHash(c)).toBe(h);
      expect(sealHmac(c, SECRET)).toBe(m);
    }
  });
});

describe('G2 — detection d alteration', () => {
  it('changer UN champ (1,5 -> 1,50) change hash ET hmac', () => {
    const altere = {
      ...contenu,
      input: { ...contenu.input, module: '1,50' }, // 1 caractere de plus
    };
    const cRef = canonicalize(contenu);
    const cAlt = canonicalize(altere);
    expect(cAlt).not.toBe(cRef);
    expect(sealContentHash(cAlt)).not.toBe(sealContentHash(cRef));
    expect(sealHmac(cAlt, SECRET)).not.toBe(sealHmac(cRef, SECRET));
  });

  it('un espace de plus quelque part change le sceau', () => {
    const altere = { ...contenu, pvNumber: 'PV-RDS-be-test-2026-000001 ' };
    expect(canonicalize(altere)).not.toBe(canonicalize(contenu));
    expect(sealContentHash(canonicalize(altere))).not.toBe(
      sealContentHash(canonicalize(contenu)),
    );
  });

  it('verifySeal : VRAI sur le sceau d origine, FAUX apres alteration', () => {
    const c = canonicalize(contenu);
    const hash = sealContentHash(c);
    const hmac = sealHmac(c, SECRET);
    // Sceau d'origine : valide.
    expect(verifySeal(c, hash, hmac, SECRET)).toBe(true);
    // Re-canonicalisation d'une ligne ALTEREE confrontee au hash/hmac STOCKES :
    // le hash ne correspond plus -> rejet (c'est la verif d'integrite d'un PV).
    const cAltere = canonicalize({
      ...contenu,
      output: { ...contenu.output, epaisseur: 0.33 },
    });
    expect(verifySeal(cAltere, hash, hmac, SECRET)).toBe(false);
  });
});

describe('G3 — canonicalisation LEXICALE, pas semantique-numerique', () => {
  it('le nombre 1.5 et la chaine "1.5" donnent des sceaux DISTINCTS', () => {
    // On ne "comprend" pas les nombres : un type distinct = une serialisation
    // distincte. Sinon le sceau masquerait une substitution type/valeur.
    const avecNombre = canonicalize({ v: 1.5 });
    const avecChaine = canonicalize({ v: '1.5' });
    expect(avecNombre).not.toBe(avecChaine);
  });

  it('la chaine FR "1,5" est rendue TELLE QUELLE (pas convertie en 1.5)', () => {
    // Preuve negative : si la primitive normalisait '1,5' en nombre, ces deux
    // contenus auraient le meme sceau -> elle ne le fait PAS.
    expect(canonicalize({ v: '1,5' })).not.toBe(canonicalize({ v: 1.5 }));
    expect(canonicalize({ v: '1,5' })).not.toBe(canonicalize({ v: '1.5' }));
  });

  it('null, tableaux et imbrications profondes sont stables', () => {
    const a = { liste: [3, 1, 2], n: null, obj: { z: 1, a: 2 } };
    const b = { obj: { a: 2, z: 1 }, n: null, liste: [3, 1, 2] };
    // L'ORDRE d'un tableau est SIGNIFICATIF (pas trie) : [3,1,2] != [1,2,3].
    expect(canonicalize(a)).toBe(canonicalize(b));
    expect(canonicalize({ liste: [3, 1, 2] })).not.toBe(
      canonicalize({ liste: [1, 2, 3] }),
    );
  });
});

describe('G3b — FAIL-CLOSED sur les objets NON-PLAIN (anti-collision, revue secu #63-A)', () => {
  it('Date / Map / Set / instance de classe -> REJET (jamais serialises en {})', () => {
    // Sans la garde, Object.keys(new Date()) = [] -> deux dates differentes
    // donneraient le MEME sceau `{}` (collision silencieuse). On REFUSE.
    class Truc {
      x = 1;
    }
    expect(() => canonicalize({ v: new Date(0) } as never)).toThrow(/non-plain/);
    expect(() => canonicalize({ v: new Map() } as never)).toThrow(/non-plain/);
    expect(() => canonicalize({ v: new Set() } as never)).toThrow(/non-plain/);
    expect(() => canonicalize({ v: new Truc() } as never)).toThrow(/non-plain/);
  });

  it('un objet PLAIN reste accepte (Object.create(null) compris)', () => {
    expect(() => canonicalize({ a: 1, b: 'x' })).not.toThrow();
    const sansProto = Object.create(null) as Record<string, unknown>;
    sansProto.a = 1;
    expect(() => canonicalize(sansProto as never)).not.toThrow();
  });
});

describe('G4 — HMAC (origine) + comparaison robuste', () => {
  it('hmac depend du secret : secret different -> hmac different', () => {
    const c = canonicalize(contenu);
    expect(sealHmac(c, SECRET)).not.toBe(sealHmac(c, AUTRE_SECRET));
  });

  it('verifySeal : FAUX si le secret de verification differe', () => {
    const c = canonicalize(contenu);
    const hash = sealContentHash(c);
    const hmac = sealHmac(c, SECRET);
    expect(verifySeal(c, hash, hmac, AUTRE_SECRET)).toBe(false);
  });

  it('verifySeal : FAUX si le hmac est falsifie (meme longueur)', () => {
    const c = canonicalize(contenu);
    const hash = sealContentHash(c);
    const hmac = sealHmac(c, SECRET);
    const faux = hmac.slice(0, -1) + (hmac.endsWith('0') ? '1' : '0');
    expect(verifySeal(c, hash, faux, SECRET)).toBe(false);
  });

  it('verifySeal : FAUX si le hash est falsifie', () => {
    const c = canonicalize(contenu);
    const hash = sealContentHash(c);
    const hmac = sealHmac(c, SECRET);
    const faux = hash.slice(0, -1) + (hash.endsWith('0') ? '1' : '0');
    expect(verifySeal(c, faux, hmac, SECRET)).toBe(false);
  });

  it('verifySeal : FAUX (pas de throw) sur une longueur de hmac incoherente', () => {
    // Comparaison temps constant : une longueur differente NE DOIT PAS lever
    // (timingSafeEqual jette si longueurs != -> on borne en amont -> false).
    const c = canonicalize(contenu);
    const hash = sealContentHash(c);
    expect(verifySeal(c, hash, 'court', SECRET)).toBe(false);
  });
});
