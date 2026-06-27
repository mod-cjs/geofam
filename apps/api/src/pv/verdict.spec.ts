import {
  resolveVerdict,
  VerdictIndeterminableError,
  type PvVerdict,
} from './verdict';

/**
 * resolveVerdict (ADR 0012) — verdict scelle, FAIL-CLOSED.
 *
 * On verifie : le mapping booleen des moteurs de dimensionnement (burmister
 * `conforme`, pieux `allOk`), le NON_APPLICABLE explicite des moteurs sans
 * verdict global, et le FAIL-CLOSED (un moteur a verdict attendu mais sortie
 * malformee -> on LEVE, pas de PV).
 */
describe('resolveVerdict', () => {
  describe('moteurs a verdict booleen global', () => {
    it('burmister conforme=true -> CONFORME', () => {
      expect(
        resolveVerdict('chaussee-burmister', { conforme: true }),
      ).toBe<PvVerdict>('CONFORME');
    });

    it('burmister conforme=false -> NON_CONFORME (emission AUTORISEE, ADR 0012)', () => {
      expect(
        resolveVerdict('chaussee-burmister', { conforme: false }),
      ).toBe<PvVerdict>('NON_CONFORME');
    });

    it('pieux allOk=true -> CONFORME', () => {
      expect(
        resolveVerdict('fondation-profonde-pieux', { allOk: true }),
      ).toBe<PvVerdict>('CONFORME');
    });

    it('pieux allOk=false -> NON_CONFORME', () => {
      expect(
        resolveVerdict('fondation-profonde-pieux', { allOk: false }),
      ).toBe<PvVerdict>('NON_CONFORME');
    });
  });

  describe('moteurs SANS verdict global -> NON_APPLICABLE (explicite, scelle)', () => {
    it.each([
      'fondation-superficielle',
      'radier-plaque',
      'pressiometre-menard',
      'labo-classification-gtr',
      'un-moteur-inconnu',
    ])('%s -> NON_APPLICABLE', (engineId) => {
      expect(resolveVerdict(engineId, { quelconque: 1 })).toBe<PvVerdict>(
        'NON_APPLICABLE',
      );
    });
  });

  describe('FAIL-CLOSED : verdict attendu mais sortie malformee -> leve', () => {
    it('burmister sans champ conforme -> VerdictIndeterminableError (pas de PV)', () => {
      expect(() => resolveVerdict('chaussee-burmister', { NE: 1.2e6 })).toThrow(
        VerdictIndeterminableError,
      );
    });

    it('burmister conforme non-booleen (string) -> leve', () => {
      expect(() =>
        resolveVerdict('chaussee-burmister', { conforme: 'oui' }),
      ).toThrow(VerdictIndeterminableError);
    });

    it('pieux allOk null -> leve', () => {
      expect(() =>
        resolveVerdict('fondation-profonde-pieux', { allOk: null }),
      ).toThrow(VerdictIndeterminableError);
    });

    it('sortie non-objet (null) sur moteur a verdict booleen -> leve', () => {
      expect(() => resolveVerdict('chaussee-burmister', null)).toThrow(
        VerdictIndeterminableError,
      );
    });
  });
});
