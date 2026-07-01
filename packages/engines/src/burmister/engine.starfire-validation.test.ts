/**
 * VALIDATION SCIENTIFIQUE burmister — moteur vs référence externe STARFIRE (§11, #36).
 *
 * Distinct de `engine.equivalence.test.ts` (portage module <-> HTML). ICI on prouve la
 * JUSTESSE : le moteur reproduit, à 0,4 % près, les calculs de référence indépendants
 * (type Alizé-LCPC) publiés au §11 du manuel utilisateur STARFIRE, sur les structures
 * EX_1 (bitumineuse épaisse) et EX_2 (souple). Provenance externe (kit STARFIRE), donc
 * pas d'auto-référence.
 *
 * ⚠️ NIVEAU MOTEUR BRUT : les grandeurs (ε_t base GB, ε_z sommet GNT…) sont par
 * interface et NE sont PAS exposées par le contrat client-safe (redaction). On lit donc
 * le résultat brut de `computeBurmister`, jamais `runBurmister`.
 *
 * GATE : tant que STARFIRE n'a pas transmis les STRUCTURES D'ENTRÉE EX_1/EX_2 (le §11
 * ne donne que les sorties), EX1_INPUT/EX2_INPUT valent null -> SKIP BRUYANT. Ce skip
 * n'est PAS un succès (DoD §9 : suite sautée = ABSENTE, jamais réussie). Cf. l'en-tête
 * de `starfire-validation.ts` pour la liste exacte à demander au client.
 */
import { describe, expect, it } from 'vitest';

import { computeBurmister } from './engine.js';
import {
  EX1_GRANDEURS,
  EX1_INPUT,
  EX2_GRANDEURS,
  EX2_INPUT,
  STARFIRE_REL_TOLERANCE,
  starfireInputsAvailable,
  type StarfireGrandeur,
} from './starfire-validation.js';

const INPUTS_OK = starfireInputsAvailable();

describe('burmister — validation scientifique vs référence STARFIRE §11 (#36)', () => {
  if (!INPUTS_OK) {
    const msg =
      '[#36] AVERTISSEMENT : structures de validation EX_1/EX_2 NON transmises par ' +
      'STARFIRE (le §11 du manuel donne les sorties de référence mais PAS les couches/' +
      'épaisseurs/modules qui les produisent). La JUSTESSE scientifique du moteur ' +
      'chaussées N A PAS ete verifiee. Ce skip n est PAS un succes (@science-unsigned). ' +
      'Renseigner EX1_INPUT/EX2_INPUT dans starfire-validation.ts pour activer.';
    // eslint-disable-next-line no-console -- avertissement volontaire (kit STARFIRE absent)
    console.warn(msg);
    it.skip(`validation scientifique NON verifiee (structures EX_1/EX_2 absentes) — ${msg}`, () => {
      /* volontairement skip : entrées de référence non fournies par le client */
    });
    return;
  }

  // ── À partir d'ici : structures fournies. Filet anti faux-vert : le mapping
  //    interface->grandeur (rawPath) DOIT etre etabli, sinon on ne sait pas OU lire la
  //    valeur -> echec dur (pas de skip silencieux, pas d'assertion vide).
  const cases = [
    { id: 'EX_1', input: EX1_INPUT, grandeurs: EX1_GRANDEURS },
    { id: 'EX_2', input: EX2_INPUT, grandeurs: EX2_GRANDEURS },
  ] as const;

  for (const c of cases) {
    describe(c.id, () => {
      it('a des grandeurs de référence (suite non vide)', () => {
        expect(c.grandeurs.length).toBeGreaterThanOrEqual(1);
      });

      it('a un mapping interface->grandeur complet (rawPath non null)', () => {
        const nonMappees = c.grandeurs.filter((g) => g.rawPath === null).map((g) => g.libelle);
        expect(
          nonMappees,
          `Structures ${c.id} fournies mais rawPath manquant pour : ${nonMappees.join(', ')}. ` +
            'Compléter le mapping + l accessor readGrandeur avant assertion (sinon faux-vert).',
        ).toEqual([]);
      });

      const raw = computeBurmister(c.input) as unknown;
      for (const g of c.grandeurs) {
        it(`[${g.libelle}] moteur ≈ référence ${g.reference} μdef (±${STARFIRE_REL_TOLERANCE * 100} %)`, () => {
          const valeur = readGrandeur(raw, g);
          const ecartRel = Math.abs(valeur - g.reference) / Math.max(Math.abs(g.reference), 1e-9);
          expect(
            ecartRel,
            `${c.id}/${g.libelle} : moteur=${valeur} vs référence=${g.reference} ` +
              `(écart ${(ecartRel * 100).toFixed(3)} % > ${STARFIRE_REL_TOLERANCE * 100} %)`,
          ).toBeLessThanOrEqual(STARFIRE_REL_TOLERANCE);
        });
      }
    });
  }
});

/**
 * Lit la grandeur de référence dans le résultat BRUT du moteur selon `g.rawPath`.
 * À IMPLÉMENTER quand les structures EX_1/EX_2 (donc le stackup des interfaces) seront
 * connues : `rawPath` encodera l'interface + le champ (ε_t / ε_z). Tant que le mapping
 * est incomplet, le test « mapping complet » ci-dessus échoue AVANT d'arriver ici.
 */
function readGrandeur(_raw: unknown, g: StarfireGrandeur): number {
  throw new Error(
    `readGrandeur non implémenté pour "${g.libelle}" (rawPath=${g.rawPath}). ` +
      'Établir l accès au résultat brut computeBurmister une fois EX_1/EX_2 connus.',
  );
}
