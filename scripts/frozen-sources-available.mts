/**
 * Sonde LOCALE : les sources client GELEES (03-Moteurs-client/, HORS depot) requises
 * pour la preuve d'equivalence (note scellee == reference) sont-elles presentes ?
 * Ecrit 'yes' si terzaghi ET burmister sont disponibles, 'no' sinon. Utilise par
 * scripts/review-gate.sh (porte de fidelite) — un script FILE (pas `tsx -e`, dont la
 * resolution des imports relatifs echoue).
 */
import { burmisterSourceAvailable } from '../packages/engines/src/burmister/equivalence-harness.js';
import { terzaghiSourceAvailable } from '../packages/engines/src/terzaghi/equivalence-harness.js';

process.stdout.write(terzaghiSourceAvailable() && burmisterSourceAvailable() ? 'yes' : 'no');
