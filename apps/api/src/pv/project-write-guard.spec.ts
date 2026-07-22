import { NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { assertProjetEcrivable } from './project-write-guard';

/**
 * GARDE D'ECRITURE SUR PROJET — unitaire (la preuve REELLE est aux e2e :
 * test/projects-archived-write-guard.e2e-spec.ts pour le statut, et
 * test/pv-delete-race.e2e-spec.ts pour le VERROU, contre Postgres reel avec
 * deux transactions REELLEMENT entrelacees).
 *
 * Ce fichier verrouille le CONTRAT de la garde, pas l'isolation ni la
 * concurrence :
 *  #1 le predicat EXIGE `status <> 'ARCHIVED'` — c'est l'omission de ce filtre
 *     qui laissait bruler du quota et sceller un PV orphelin sur un projet
 *     archive ;
 *  #2 la lecture est VERROUILLANTE (`FOR SHARE`) : sans clause de verrou, le
 *     controle redevient un simple constat, et une suppression definitive
 *     concurrente peut detruire le projet entre ce controle et l'ecriture de
 *     l'appelant (course TOCTOU, revue adverse). Un unitaire ne peut pas prouver
 *     l'EFFET du verrou — il peut, lui, empecher qu'on le retire en silence ;
 *  #3 projet absent / hors tenant (RLS -> 0 ligne) / archive -> MEME 404, MEME
 *     message (anti-enumeration) ;
 *  #4 projet ecrivable -> elle rend {id, name} (l'appelant n'a plus aucune
 *     raison de re-lire le projet, donc de dupliquer le predicat).
 */
describe('assertProjetEcrivable — garde d’écriture sur projet', () => {
  /**
   * `$queryRaw` est appele en TEMPLATE BALISE : le mock recoit (fragments SQL,
   * ...valeurs liees). On reconstitue le SQL pour l'inspecter.
   */
  const tx = (queryRaw: jest.Mock) =>
    ({ $queryRaw: queryRaw }) as unknown as Prisma.TransactionClient;
  const appels = (queryRaw: jest.Mock): unknown[][] =>
    queryRaw.mock.calls as unknown[][];
  const sqlDe = (queryRaw: jest.Mock): string =>
    (appels(queryRaw)[0][0] as string[]).join('?');

  it('#1/#2/#4 GIVEN un projet écrivable — THEN elle le lit avec le filtre de statut ET un verrou partagé, et rend {id, name}', async () => {
    const queryRaw = jest
      .fn()
      .mockResolvedValue([{ id: 'proj-1', name: 'Pont de Mbodiène' }]);

    await expect(
      assertProjetEcrivable(tx(queryRaw), 'proj-1'),
    ).resolves.toEqual({ id: 'proj-1', name: 'Pont de Mbodiène' });

    const sql = sqlDe(queryRaw).replace(/\s+/g, ' ');
    // Le filtre de statut : sans lui, la garde ne fait que constater l'existence,
    // ce que faisait deja le code fautif corrige en PR #120.
    expect(sql).toContain("status <> 'ARCHIVED'");
    // Le VERROU : sans lui, la garde ne constate l'existence qu'A UN INSTANT — le
    // projet peut disparaitre avant l'ecriture de l'appelant.
    expect(sql).toContain('FOR SHARE');
    // Le projet vise est un parametre LIE, jamais interpole dans le SQL.
    expect(appels(queryRaw)[0][1]).toBe('proj-1');
  });

  it('#2-bis GIVEN la garde — THEN elle ne pose PAS de verrou EXCLUSIF (deux écritures concurrentes sur le même projet ne doivent pas se sérialiser)', async () => {
    const queryRaw = jest.fn().mockResolvedValue([{ id: 'p', name: 'P' }]);
    await assertProjetEcrivable(tx(queryRaw), 'p');
    // Corriger la course avec `FOR UPDATE` marcherait aussi — mais ferait
    // attendre chaque calcul derriere le precedent sur le meme projet. Le verrou
    // PARTAGE bloque la seule chose a bloquer : la destruction.
    expect(sqlDe(queryRaw)).not.toContain('FOR UPDATE');
  });

  it('#3 GIVEN un projet absent, hors tenant OU archivé (0 ligne) — THEN 404', async () => {
    const queryRaw = jest.fn().mockResolvedValue([]);

    await expect(
      assertProjetEcrivable(tx(queryRaw), 'proj-x'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('#3-bis GIVEN un refus — THEN le message ne révèle PAS que le projet est archivé', async () => {
    const queryRaw = jest.fn().mockResolvedValue([]);

    // « archive », « inexistant », « detruit entre-temps » et « hors tenant »
    // passent tous par ce meme chemin : un message qui mentionnerait l'archivage
    // permettrait d'enumerer.
    await expect(assertProjetEcrivable(tx(queryRaw), 'proj-x')).rejects.toThrow(
      'Projet introuvable dans cette organisation.',
    );
  });
});
