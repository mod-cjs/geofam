import {
  AXI_CONTRACT,
  burmisterContract,
  laboContract,
  pieuxContract,
  planeStrainContract,
  pressioCalibrageContract,
  pressioEtalonnageContract,
  pressiometreContract,
  radierContract,
  runAxi,
  runBurmister,
  runLabo,
  runPieux,
  runPlaneStrain,
  runPressioCalibrage,
  runPressioEtalonnage,
  runPressiometre,
  runRadier,
  runTerzaghi,
  runTriRaft,
  terzaghiContract,
  triRaftContract,
} from '@roadsen/engines';
import type { EngineContract, EngineResultEnvelope } from '@roadsen/shared';
import type { z } from 'zod';

/**
 * TABLE DE DISPATCH des moteurs pour la surface TENANT (#63, incr. B).
 *
 * La surface authentifiee reutilise STRICTEMENT les memes `run<Engine>` et les
 * memes contrats Zod que la surface recette (`calc/*.controller.ts`) : aucune
 * duplication de logique, EQUIVALENCE preservee (le calcul persiste pour un PV
 * est rigoureusement celui qu'un POST /calc/<engine> recette produirait).
 *
 * Chaque entree expose :
 *  - `run`        : la fonction de calcul confidentielle (server-only, @roadsen/engines) ;
 *  - `contract`   : le contrat Zod (inputSchema/outputSchema) — sert a la projection
 *                   sure des entrees/sorties persistees (projectEngineInput/Output) ;
 *  - `registryId` : l'id logique de registre (= meta.engineId), pour retrouver
 *                   version + sha256 source via findEngine().
 *
 * La cle de la map est le SLUG d'URL (`:engine`), volontairement aligne sur les
 * chemins recette existants (burmister, terzaghi, pressiometre, pieux, radier, labo).
 */
export interface EngineDispatchEntry {
  readonly run: (raw: unknown) => EngineResultEnvelope<unknown>;
  readonly contract: EngineContract<z.ZodTypeAny, z.ZodTypeAny>;
  readonly registryId: string;
}

export const ENGINE_DISPATCH: Readonly<Record<string, EngineDispatchEntry>> = {
  burmister: {
    run: runBurmister,
    contract: burmisterContract,
    registryId: 'chaussee-burmister',
  },
  terzaghi: {
    run: runTerzaghi,
    contract: terzaghiContract,
    registryId: 'fondation-superficielle',
  },
  pressiometre: {
    run: runPressiometre,
    contract: pressiometreContract,
    registryId: 'pressiometre-menard',
  },
  // PressioPro — appareillage (meme HTML source que pressiometre, calculs distincts) :
  // etalonnage (sonde dans l'air -> Vs/Pe/a) et calibrage (forage libre -> a). Recalcul
  // SERVEUR only ; groupes sous l'entitlement 'pressiometre' (cf. subscription.guard).
  'pressio-etalonnage': {
    run: runPressioEtalonnage,
    contract: pressioEtalonnageContract,
    registryId: 'pressio-etalonnage',
  },
  'pressio-calibrage': {
    run: runPressioCalibrage,
    contract: pressioCalibrageContract,
    registryId: 'pressio-calibrage',
  },
  pieux: {
    run: runPieux,
    contract: pieuxContract,
    registryId: 'fondation-profonde-pieux',
  },
  radier: {
    run: runRadier,
    contract: radierContract,
    registryId: 'radier-plaque',
  },
  // Variantes GEOPLAQUE (meme HTML source, solveurs distincts) — recalcul SERVEUR only.
  'plane-strain': {
    run: runPlaneStrain,
    contract: planeStrainContract,
    registryId: 'plane-strain',
  },
  axi: {
    run: runAxi,
    contract: AXI_CONTRACT,
    registryId: 'axi-plaque',
  },
  'tri-raft': {
    run: runTriRaft,
    contract: triRaftContract,
    registryId: 'radier-tri',
  },
  labo: {
    run: runLabo,
    contract: laboContract,
    registryId: 'labo-classification-gtr',
  },
};

/** Slug d'URL -> entree de dispatch, ou undefined si le moteur est inconnu. */
export function findEngineDispatch(
  slug: string,
): EngineDispatchEntry | undefined {
  return Object.prototype.hasOwnProperty.call(ENGINE_DISPATCH, slug)
    ? ENGINE_DISPATCH[slug]
    : undefined;
}

/** registryId (= meta.engineId persiste) -> entree de dispatch. Pour re-executer le
 * moteur a l'emission d'un PV (l'integrite : le calc_result est mutable). */
export function findEngineDispatchByRegistryId(
  registryId: string,
): EngineDispatchEntry | undefined {
  return Object.values(ENGINE_DISPATCH).find(
    (e) => e.registryId === registryId,
  );
}

/** Liste des slugs supportes (pour message d'erreur borne). */
export const SUPPORTED_ENGINE_SLUGS = Object.keys(ENGINE_DISPATCH);
