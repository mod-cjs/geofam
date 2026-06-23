/**
 * Tests du contrat d I/O moteurs (#56). Preuves des criteres d acceptation :
 *   C1 — sortie = WHITELIST stricte : tout champ intermediaire injecte est elimine.
 *   C2 — whitelist sur errorDetail ET inputs persistes.
 *   C3 — importable sans @roadsen/engines (verifie a part : import-poc.test).
 *   C4 — schemas Zod + types inferes (assure par typecheck).
 *   C5 — pattern generique + un exemple de reference.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  assertWhitelistSafe,
  defineEngineContract,
  defineEngineResult,
  libelleErreurMoteur,
  projectEngineInput,
  projectEngineOutput,
  toSafeEngineError,
  EngineErrorCodeSchema,
  ENGINE_ERROR_LIBELLES,
  SafeEngineErrorSchema,
  SafeNumberSchema,
} from './engine-io.js';
import { referenceEngineContract } from './engine-io.reference.js';

// Schema de sortie "client-safe" minimal reutilise par plusieurs tests.
// Mode STRIP (defaut) a tous les niveaux : la projection retire les inconnus.
const outputSchema = z.object({
  resultat: SafeNumberSchema,
  sousResultats: z.object({ marge: SafeNumberSchema }),
});

describe('C1 — whitelist stricte de sortie (anti pass-through)', () => {
  it('strippe un champ intermediaire injecte au niveau racine', () => {
    const brut = {
      resultat: 12.5,
      sousResultats: { marge: 0.3 },
      // intermediaire de calcul qui NE DOIT PAS fuiter :
      coefficientInterneSecret: 9.81,
    } as unknown;
    const projete = projectEngineOutput(outputSchema, brut);
    expect(projete).toEqual({ resultat: 12.5, sousResultats: { marge: 0.3 } });
    expect('coefficientInterneSecret' in projete).toBe(false);
  });

  it('strippe un champ intermediaire IMBRIQUE (objet enfant)', () => {
    const brut = {
      resultat: 1,
      sousResultats: { marge: 0.1, contrainteParCouche: [100, 200, 300] },
    } as unknown;
    const projete = projectEngineOutput(outputSchema, brut);
    expect(projete.sousResultats).toEqual({ marge: 0.1 });
    expect('contrainteParCouche' in projete.sousResultats).toBe(false);
  });

  it('strippe meme a travers tableaux et unions', () => {
    const schema = z.object({
      lignes: z.array(z.object({ valeur: SafeNumberSchema })),
    });
    const brut = {
      lignes: [
        { valeur: 1, intermediaire: 42 },
        { valeur: 2, debug: 'fuite' },
      ],
    } as unknown;
    const projete = projectEngineOutput(schema, brut);
    expect(projete.lignes).toEqual([{ valeur: 1 }, { valeur: 2 }]);
  });
});

describe('C1bis — LISTE BLANCHE fail-closed (portes ouvertes rejetees)', () => {
  // Helper : on enveloppe le type fuyant dans un objet et on verifie que la
  // DEFINITION du contrat echoue (defineEngineContract appelle assertWhitelistSafe
  // sur input ET output). Aucun de ces schemas ne doit pouvoir etre declare.
  function defineAvecOutput(out: z.ZodTypeAny): () => unknown {
    return () =>
      defineEngineContract({
        id: 'reference',
        inputSchema: z.object({ a: SafeNumberSchema }),
        outputSchema: out,
      });
  }

  const VECTEURS: Array<[string, z.ZodTypeAny]> = [
    ['z.record', z.object({ x: z.record(z.string(), z.number()) })],
    ['z.map', z.object({ x: z.map(z.string(), z.number()) })],
    ['z.set', z.object({ x: z.set(z.number()) })],
    ['z.any', z.object({ x: z.any() })],
    ['z.unknown', z.object({ x: z.unknown() })],
    ['z.tuple().rest()', z.object({ x: z.tuple([SafeNumberSchema]).rest(z.number()) })],
    [
      'z.intersection(obj, record)',
      z.object({
        x: z.intersection(
          z.object({ a: SafeNumberSchema }),
          z.record(z.string(), z.number()),
        ),
      }),
    ],
    ['z.lazy', z.object({ x: z.lazy(() => z.number()) })],
    ['.brand sur record', z.object({ x: z.record(z.string(), z.number()).brand('B') })],
    [
      '.readonly sur record',
      z.object({ x: z.record(z.string(), z.number()).readonly() }),
    ],
    ['z.catch', z.object({ x: z.number().catch(0) })],
    ['z.pipe', z.object({ x: z.string().pipe(z.coerce.number()) })],
    ['z.function', z.object({ x: z.function() })],
    ['z.promise', z.object({ x: z.promise(z.number()) })],
    ['.passthrough()', z.object({ x: SafeNumberSchema }).passthrough()],
    ['.catchall ouvert', z.object({ x: SafeNumberSchema }).catchall(z.number())],
    // Deballage-avant-jugement aussi sur optional/default (un wrapper ne doit pas
    // masquer un coeur fuyant).
    [
      'record sous .optional()',
      z.object({ x: z.record(z.string(), z.number()).optional() }),
    ],
    [
      'record sous .default()',
      z.object({ x: z.record(z.string(), z.number()).default({}) }),
    ],
  ];

  it.each(VECTEURS)('rejette la porte ouverte : %s', (_nom, schema) => {
    // 1) assertWhitelistSafe leve directement, avec le message explicite maison
    //    (on asserte le message, pas seulement "ca jette" : tue les mutants de
    //    chaine de message et garantit un diagnostic exploitable).
    expect(() => assertWhitelistSafe(schema)).toThrow(/Contrat moteur non sur/);
    // 2) et la porte n atteint JAMAIS defineEngineContract (donc ni la projection).
    expect(defineAvecOutput(schema)).toThrow(/Contrat moteur non sur/);
  });

  it('rejette un output avec .transform reinjecteur (MAJEUR-3)', () => {
    // .transform peut re-injecter l objet brut APRES le strip -> fuite.
    const reinjecteur = z
      .object({ resultat: SafeNumberSchema })
      .transform((o) => ({ ...o, intermediaireFuite: 9.81 }));
    expect(() => assertWhitelistSafe(reinjecteur)).toThrow(/transform|effet/i);
    expect(defineAvecOutput(reinjecteur)).toThrow();
  });

  it('TOLERE .refine (refinement, pas de re-injection)', () => {
    const refine = z
      .object({ resultat: SafeNumberSchema })
      .refine((o) => o.resultat >= 0, 'doit etre positif');
    expect(() => assertWhitelistSafe(refine)).not.toThrow();
  });

  it('SENTINELLE anti-fail-open : un typeName inconnu/undefined est REJETE', () => {
    // Faux schema avec _def.typeName non reconnu : le defaut DOIT etre le rejet.
    const fauxInconnu = {
      _def: { typeName: 'ZodFutureExotic' },
    } as unknown as z.ZodTypeAny;
    expect(() => assertWhitelistSafe(fauxInconnu)).toThrow(/fail-closed|non autorise/i);

    const fauxSansType = { _def: {} } as unknown as z.ZodTypeAny;
    expect(() => assertWhitelistSafe(fauxSansType)).toThrow(/fail-closed|typeName/i);
  });

  it('ACCEPTE les conteneurs fermes surs (objet/array/tuple sans rest/union/intersection)', () => {
    const sain = z.object({
      a: SafeNumberSchema,
      b: z.array(z.object({ c: SafeNumberSchema })),
      d: z.tuple([SafeNumberSchema, z.enum(['x', 'y'])]),
      e: z.union([SafeNumberSchema, z.literal('NA')]),
      f: z.intersection(z.object({ g: SafeNumberSchema }), z.object({ h: z.boolean() })),
      i: SafeNumberSchema.optional().nullable(),
    });
    expect(() => assertWhitelistSafe(sain)).not.toThrow();
  });
});

describe('C1ter — messages & sens assertes (ratchet mutation : chemin input/output + sens)', () => {
  it('un schema d ENTREE invalide echoue en mentionnant le chemin "input"', () => {
    expect(() =>
      defineEngineContract({
        id: 'reference',
        inputSchema: z.object({ x: z.record(z.string(), z.number()) }),
        outputSchema: z.object({ r: SafeNumberSchema }),
      }),
    ).toThrow(/input/);
  });

  it('un schema de SORTIE invalide echoue en mentionnant le chemin "output"', () => {
    expect(() =>
      defineEngineContract({
        id: 'reference',
        inputSchema: z.object({ a: SafeNumberSchema }),
        outputSchema: z.object({ x: z.record(z.string(), z.number()) }),
      }),
    ).toThrow(/output/);
  });

  it('sens : .default() est REJETE en SORTIE (valeur non calculee) mais TOLERE en ENTREE', () => {
    // SORTIE : .default() injecterait une valeur non calculee cote client -> rejet.
    expect(() =>
      defineEngineContract({
        id: 'reference',
        inputSchema: z.object({ a: SafeNumberSchema }),
        outputSchema: z.object({ r: SafeNumberSchema.default(0) }),
      }),
    ).toThrow(/default|SORTIE/i);
    // ENTREE : valeur par defaut d entree legitime -> tolere.
    expect(() =>
      defineEngineContract({
        id: 'reference',
        inputSchema: z.object({ a: SafeNumberSchema.default(0) }),
        outputSchema: z.object({ r: SafeNumberSchema }),
      }),
    ).not.toThrow();
  });
});

describe('C2a — errorDetail reduit a la forme sure', () => {
  it('reduit un errorDetail "riche" a la forme sure (aucun texte libre)', () => {
    const erreurRiche = {
      code: 'NON_CONVERGENCE',
      champ: 'epaisseur',
      // MAJEUR-4 : un message libre porteur d intermediaires NE DOIT PAS sortir.
      message: 'residu=1.2e-3 apres 999 iter (sigma=E*eps)',
      stack: 'Error: at engine.js:128 ...',
      valeursInternes: { residu: 1e-3, iter: 999 },
      formuleUtilisee: 'sigma = E * eps',
    };
    const sur = toSafeEngineError(erreurRiche);
    // Seuls code + champ (identifiant) survivent. PAS de `message`.
    expect(sur).toEqual({ code: 'NON_CONVERGENCE', champ: 'epaisseur' });
    expect('message' in sur).toBe(false);
    expect('stack' in sur).toBe(false);
    expect('valeursInternes' in sur).toBe(false);
    expect('formuleUtilisee' in sur).toBe(false);
  });

  it('ecarte un `champ` qui n est pas un identifiant (texte libre porteur de fuite)', () => {
    const sur = toSafeEngineError({
      code: 'INPUT_INVALIDE',
      champ: 'sigma = 12.3 MPa (intermediaire)',
    });
    expect(sur).toEqual({ code: 'INPUT_INVALIDE' });
    expect('champ' in sur).toBe(false);
  });

  it('le libelle d affichage derive du SEUL code (table fermee)', () => {
    expect(libelleErreurMoteur('NON_CONVERGENCE')).toBe(
      ENGINE_ERROR_LIBELLES.NON_CONVERGENCE,
    );
    // Toute valeur de l enum a un libelle (pas de trou).
    for (const code of EngineErrorCodeSchema.options) {
      expect(typeof libelleErreurMoteur(code)).toBe('string');
      expect(libelleErreurMoteur(code).length).toBeGreaterThan(0);
    }
  });

  it('retombe sur ERREUR_INTERNE pour un code inconnu (defense en profondeur)', () => {
    const sur = toSafeEngineError({ code: 'KABOOM', secret: 'x' });
    expect(sur.code).toBe('ERREUR_INTERNE');
    expect('secret' in sur).toBe(false);
  });

  it('gere une exception non-objet (string / null) sans crasher', () => {
    expect(toSafeEngineError('boom').code).toBe('ERREUR_INTERNE');
    expect(toSafeEngineError(null).code).toBe('ERREUR_INTERNE');
  });

  it('le schema d erreur rejette tout champ supplementaire, dont message (.strict)', () => {
    expect(
      SafeEngineErrorSchema.safeParse({ code: 'INPUT_INVALIDE', extra: 1 }).success,
    ).toBe(false);
    // Le canal `message` est definitivement ferme : il n existe plus au schema.
    expect(
      SafeEngineErrorSchema.safeParse({ code: 'INPUT_INVALIDE', message: 'x' }).success,
    ).toBe(false);
  });
});

describe('C2b — inputs persistes bornes (whitelist)', () => {
  const inputSchema = z.object({ valeurA: SafeNumberSchema.positive() });

  it('strippe un champ parasite des entrees persistees', () => {
    const recu = { valeurA: 3, traceurUtilisateur: 'inject', __proto: 'x' } as unknown;
    const persiste = projectEngineInput(inputSchema, recu);
    expect(persiste).toEqual({ valeurA: 3 });
  });
});

describe('C5 — enveloppe de resultat + exemple de reference', () => {
  it('valide une enveloppe de SUCCES et nettoie un output pollue (strip)', () => {
    const result = defineEngineResult(outputSchema);
    const ok = result.parse({
      ok: true,
      meta: { engineId: 'reference', engineVersion: '1.0.0' },
      output: { resultat: 5, sousResultats: { marge: 0.2 } },
    });
    expect(ok.ok).toBe(true);

    // Un output qui transporte un intermediaire est NETTOYE par l enveloppe :
    // l output etant en mode strip, le champ parasite est retire (pas de fuite),
    // sans transformer la chose en erreur.
    const nettoye = result.parse({
      ok: true,
      meta: { engineId: 'reference', engineVersion: '1.0.0' },
      output: { resultat: 5, sousResultats: { marge: 0.2 }, fuite: 1 },
    });
    expect(nettoye.ok).toBe(true);
    if (nettoye.ok) {
      expect('fuite' in nettoye.output).toBe(false);
    }

    // En revanche, l enveloppe elle-meme (cles ok/meta/output) est STRICTE :
    // un champ parasite AU NIVEAU enveloppe est rejete (notre propre forme).
    const ko = result.safeParse({
      ok: true,
      meta: { engineId: 'reference', engineVersion: '1.0.0' },
      output: { resultat: 5, sousResultats: { marge: 0.2 } },
      champEnveloppeParasite: 1,
    });
    expect(ko.success).toBe(false);
  });

  it('valide une enveloppe d ECHEC avec error sur', () => {
    const result = defineEngineResult(outputSchema);
    const echec = result.parse({
      ok: false,
      meta: { engineId: 'reference', engineVersion: '1.0.0' },
      error: { code: 'DOMAINE_NON_COUVERT' },
    });
    expect(echec.ok).toBe(false);
  });

  it('le contrat de reference expose un id, des schemas et une enveloppe', () => {
    expect(referenceEngineContract.id).toBe('reference');
    const projete = projectEngineOutput(referenceEngineContract.outputSchema, {
      resultat: 1,
      verdict: 'conforme',
      intermediaire: 'fuite',
    });
    expect('intermediaire' in projete).toBe(false);
  });

  it('rejette un id de moteur non conforme a la construction', () => {
    expect(() =>
      defineEngineContract({
        id: 'Reference Invalide!',
        inputSchema: z.object({}).strict(),
        outputSchema: z.object({ x: SafeNumberSchema }).strict(),
      }),
    ).toThrow();
  });
});
