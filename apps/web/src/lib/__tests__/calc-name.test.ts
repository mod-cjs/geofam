// @vitest-environment node
/**
 * Tests — calc-name (nom mnémonique des calculs/PV, décision titulaire 22/07/2026).
 *
 * DoD §9 : given/when/then. Verrouille :
 *  - le nom personnalisé prime toujours sur le mnémonique ;
 *  - le mnémonique = « Logiciel · Projet · #n » avec le nom COURT du logiciel
 *    (pas le nom métier long) ;
 *  - `undefined` et `null` traités identiquement (repli mnémonique) ;
 *  - un nom personnalisé réduit à des espaces est traité comme absent ;
 *  - `seqParCreation` ordonne par date croissante (le plus ancien = #1), sur
 *    l'ensemble complet, jamais sur un sous-ensemble filtré.
 */

import { describe, it, expect } from 'vitest';

import { nomAffiche, nomAfficheCompact, seqParCreation } from '../calc-name';

describe('nomAffiche — nom personnalisé prime toujours', () => {
  it('GIVEN une entité avec un nom personnalisé — WHEN nomAffiche — THEN ce nom est retourné tel quel (le mnémonique ne se calcule même pas)', () => {
    const entite = { name: 'Semelle P3 — variante finale', engineId: 'terzaghi' };
    expect(nomAffiche(entite, 'Pont de Mbodiène', 3)).toBe(
      'Semelle P3 — variante finale',
    );
  });

  it('GIVEN un nom personnalisé réduit à des espaces — WHEN nomAffiche — THEN traité comme ABSENT (mnémonique calculé, pas une chaîne d’espaces affichée)', () => {
    const entite = { name: '   ', engineId: 'burmister' };
    expect(nomAffiche(entite, 'RN2', 1)).toBe('ROADSENS · RN2 · #1');
  });
});

describe('nomAffiche — mnémonique par défaut (Logiciel · Projet · #n)', () => {
  it('GIVEN aucun nom personnalisé (undefined) — WHEN nomAffiche — THEN mnémonique avec le nom COURT du logiciel (pas le nom métier long)', () => {
    const entite = { engineId: 'pieux' };
    // Nom court du catalogue = "CASAGRANDE" — PAS "CASAGRANDE — Pieux" (nom
    // métier long de metaOf, déjà utilisé ailleurs à l'écran).
    expect(nomAffiche(entite, 'Pont de Mbodiène', 3)).toBe(
      'CASAGRANDE · Pont de Mbodiène · #3',
    );
  });

  it('GIVEN name explicitement null — WHEN nomAffiche — THEN même repli mnémonique qu’avec undefined (traités identiquement)', () => {
    const avecNull = { name: null, engineId: 'radier' };
    const avecUndefined = { engineId: 'radier' };
    expect(nomAffiche(avecNull, 'Zone industrielle', 5)).toBe(
      nomAffiche(avecUndefined, 'Zone industrielle', 5),
    );
    expect(nomAffiche(avecNull, 'Zone industrielle', 5)).toBe(
      'GEOPLAQUE · Zone industrielle · #5',
    );
  });

  it('GIVEN les 6 moteurs du catalogue — WHEN nomAffiche sans nom — THEN chaque mnémonique porte le nom court exact du logiciel (jamais le slug technique)', () => {
    expect(nomAffiche({ engineId: 'burmister' }, 'P', 1)).toBe('ROADSENS · P · #1');
    expect(nomAffiche({ engineId: 'terzaghi' }, 'P', 1)).toBe('Terzaghi · P · #1');
    expect(nomAffiche({ engineId: 'pieux' }, 'P', 1)).toBe('CASAGRANDE · P · #1');
    expect(nomAffiche({ engineId: 'radier' }, 'P', 1)).toBe('GEOPLAQUE · P · #1');
    expect(nomAffiche({ engineId: 'pressiometre' }, 'P', 1)).toBe('PressioPro · P · #1');
    expect(nomAffiche({ engineId: 'labo' }, 'P', 1)).toBe('FASTLAB · P · #1');
  });

  it('GIVEN un engineId brut (registryId backend, ex. chaussee-burmister) — WHEN nomAffiche — THEN résolu vers le même nom court (slugOf appliqué en amont par logicielCourtFor)', () => {
    expect(nomAffiche({ engineId: 'chaussee-burmister' }, 'P', 2)).toBe(
      'ROADSENS · P · #2',
    );
  });
});

describe('seqParCreation — position 1-based par date croissante', () => {
  it('GIVEN trois éléments créés à des dates différentes, dans le désordre — WHEN seqParCreation — THEN le plus ANCIEN porte #1, le plus récent #3', () => {
    const items = [
      { id: 'c-recent', createdAt: '2026-07-20T10:00:00.000Z' },
      { id: 'c-ancien', createdAt: '2026-07-01T10:00:00.000Z' },
      { id: 'c-milieu', createdAt: '2026-07-10T10:00:00.000Z' },
    ];
    const seq = seqParCreation(items, (i) => i.createdAt);
    expect(seq.get('c-ancien')).toBe(1);
    expect(seq.get('c-milieu')).toBe(2);
    expect(seq.get('c-recent')).toBe(3);
  });

  it('GIVEN une clé de date différente (sealedAt pour un PV, pas createdAt) — WHEN seqParCreation avec un extracteur dédié — THEN le tri utilise bien cette date', () => {
    const pvs = [
      { id: 'pv-2', sealedAt: '2026-07-15T00:00:00.000Z' },
      { id: 'pv-1', sealedAt: '2026-07-05T00:00:00.000Z' },
    ];
    const seq = seqParCreation(pvs, (p) => p.sealedAt);
    expect(seq.get('pv-1')).toBe(1);
    expect(seq.get('pv-2')).toBe(2);
  });

  it('GIVEN une liste vide — WHEN seqParCreation — THEN une Map vide (pas d’exception)', () => {
    expect(seqParCreation([], () => '').size).toBe(0);
  });
});

describe('nomAfficheCompact — colonne étroite (décision titulaire 22/07/2026)', () => {
  // LE DÉFAUT VÉRIFIÉ DANS L'APPLICATION RÉELLE : dans la colonne des calculs,
  // « ROADSENS · Route Dakar-Thies — dimensionnement · #6 » était tronqué à
  // « ROADSENS · Route Dakar-T… » sur TOUTES les lignes — coupant le #n, seule
  // partie distinctive. Le nom du projet y est redondant (on est DANS ce projet).
  it('GIVEN un calcul sans nom personnalisé — WHEN nomAfficheCompact — THEN « Logiciel · #n », SANS le nom du projet', () => {
    const calc = { name: null, engineId: 'chaussee-burmister' };
    expect(nomAfficheCompact(calc, 6)).toBe('ROADSENS · #6');
  });

  it('GIVEN deux calculs du même logiciel — WHEN nomAfficheCompact — THEN ils restent DISTINCTS (le défaut d’origine)', () => {
    const a = { name: null, engineId: 'fondation-profonde-pieux' };
    const b = { name: null, engineId: 'fondation-profonde-pieux' };
    expect(nomAfficheCompact(a, 1)).not.toBe(nomAfficheCompact(b, 2));
  });

  it('GIVEN un nom personnalisé — WHEN nomAfficheCompact — THEN il prime et n’est JAMAIS raccourci', () => {
    const calc = { name: 'Pieu Ø1000 — appui P2', engineId: 'fondation-profonde-pieux' };
    expect(nomAfficheCompact(calc, 3)).toBe('Pieu Ø1000 — appui P2');
  });

  it('GIVEN la forme compacte — WHEN comparée à la forme complète — THEN elle ne contient PAS le nom du projet', () => {
    const calc = { name: null, engineId: 'chaussee-burmister' };
    const complet = nomAffiche(calc, 'Route Dakar-Thies — dimensionnement', 6);
    const compact = nomAfficheCompact(calc, 6);
    expect(complet).toContain('Route Dakar-Thies');
    expect(compact).not.toContain('Route Dakar-Thies');
    // Le rang reste présent dans les DEUX : c'est lui qui distingue les lignes.
    expect(compact).toContain('#6');
  });
});
