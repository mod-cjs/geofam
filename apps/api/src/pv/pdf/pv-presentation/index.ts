import { CHAUSSEE_PRESENTATION } from './chaussee';
import type { PresentationModel } from './types';

export type { PresentationModel } from './types';

/**
 * REGISTRE des modèles de présentation PAR moteur (#71). Un moteur SANS modèle
 * -> le renderer tombe sur le FALLBACK table clé-valeur propre. Phase 1 : seule
 * la chaussée a son modèle riche ; les 5 autres moteurs fonctionnent en fallback.
 *
 * Clé = engineId du registre @roadsen/engines (= meta.engineId scellée).
 */
const PRESENTATION_BY_ENGINE: Readonly<Record<string, PresentationModel>> = {
  'chaussee-burmister': CHAUSSEE_PRESENTATION,
};

/** Modèle de présentation pour `engineId`, ou undefined (-> fallback). */
export function findPresentationModel(
  engineId: string,
): PresentationModel | undefined {
  return Object.prototype.hasOwnProperty.call(PRESENTATION_BY_ENGINE, engineId)
    ? PRESENTATION_BY_ENGINE[engineId]
    : undefined;
}
