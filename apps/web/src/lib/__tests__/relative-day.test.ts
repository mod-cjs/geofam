// @vitest-environment node
/**
 * P0-4 — DATE RELATIVE EN JOURS CALENDAIRES.
 *
 * LE DÉFAUT CORRIGÉ
 * -----------------
 * L'ancien calcul faisait `Math.floor((maintenant - t) / 86400000)` : des
 * tranches de 24 h GLISSANTES, pas des jours. Conséquence directe :
 *
 *   élément d'hier 23:00, consulté ce matin 08:00  ->  9 h d'écart
 *   -> Math.floor(9h / 24h) = 0 -> « aujourd'hui »   alors que c'était HIER.
 *
 * Sur des pièces quasi-probatoires (calculs, PV scellés), afficher « aujourd'hui »
 * pour un document de la veille est indéfendable.
 *
 * CE QUE CE FICHIER VERROUILLE (given/when/then, esprit mutation)
 *  #1 le cas exact qui échouait : hier 23:00 vu à 08:00 -> « hier » ;
 *  #2 le cas inverse : aujourd'hui 00:30 vu à 23:00 (22,5 h) -> « aujourd'hui » ;
 *  #3 les bornes de minuit sont les frontières, pas l'écart en heures ;
 *  #4 une date invalide ne produit ni « NaN » ni exception.
 *
 * La fonction prend `maintenant` en paramètre : sans cela le test dépendrait de
 * l'heure d'exécution et serait instable (et `Date.now()` n'est pas mockable
 * proprement ici).
 */

import { describe, it, expect } from 'vitest';

import { joursCalendairesEcoules, libelleRelatif } from '../relative-day';

describe('joursCalendairesEcoules — compte des jours, pas des tranches de 24 h', () => {
  it('#1 GIVEN hier 23:00 consulté aujourd’hui 08:00 (9 h) — THEN 1 jour, pas 0', () => {
    const hier = new Date('2026-07-21T23:00:00');
    const maintenant = new Date('2026-07-22T08:00:00');
    // L'ancien calcul renvoyait 0 -> « aujourd'hui ». C'est LE cas du défaut.
    expect(joursCalendairesEcoules(hier, maintenant)).toBe(1);
  });

  it('#2 GIVEN aujourd’hui 00:30 consulté à 23:00 (22,5 h) — THEN 0 jour', () => {
    const tot = new Date('2026-07-22T00:30:00');
    const maintenant = new Date('2026-07-22T23:00:00');
    // Presque 24 h d'écart, mais MÊME jour calendaire.
    expect(joursCalendairesEcoules(tot, maintenant)).toBe(0);
  });

  it('#3 GIVEN 4 jours pleins — THEN 4', () => {
    expect(
      joursCalendairesEcoules(
        new Date('2026-07-18T10:54:00'),
        new Date('2026-07-22T09:00:00'),
      ),
    ).toBe(4);
  });

  it('#4 GIVEN une date future (horloge décalée) — THEN 0, jamais négatif', () => {
    expect(
      joursCalendairesEcoules(
        new Date('2026-07-23T10:00:00'),
        new Date('2026-07-22T09:00:00'),
      ),
    ).toBe(0);
  });
});

describe('libelleRelatif — formulation lisible', () => {
  const maintenant = new Date('2026-07-22T08:00:00');

  it('GIVEN aujourd’hui — THEN « aujourd’hui »', () => {
    expect(libelleRelatif(new Date('2026-07-22T01:00:00'), maintenant)).toBe(
      "aujourd'hui",
    );
  });

  it('GIVEN hier 23:00 — THEN « hier » (et non « aujourd’hui »)', () => {
    expect(libelleRelatif(new Date('2026-07-21T23:00:00'), maintenant)).toBe('hier');
  });

  it('GIVEN 4 jours — THEN « il y a 4 jours »', () => {
    expect(libelleRelatif(new Date('2026-07-18T10:54:00'), maintenant)).toBe(
      'il y a 4 jours',
    );
  });

  it('GIVEN une date invalide — THEN chaîne vide, ni « NaN » ni exception', () => {
    const label = libelleRelatif(new Date('pas-une-date'), maintenant);
    expect(label).not.toContain('NaN');
    expect(label).toBe('');
  });
});
