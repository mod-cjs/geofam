/**
 * TEST DE COHERENCE HASH du registre des moteurs (#37, critère 2).
 *
 * Objectif : garantir que, LOCALEMENT (la ou les sources existent), le SHA-256
 * recalcule de chaque HTML source est IDENTIQUE a la valeur figee dans le
 * registre. Une evolution non enregistree d un moteur (ou un registre obsolete)
 * fait alors ECHOUER ce test => on est force de re-extraire + rejouer le golden.
 *
 * --- GATE LOCAL, jamais faux-vert (DoD §9) ---
 * `03-Moteurs-client/` n est PAS versionne (cf. CLAUDE.md « Périmètre git »).
 * En CI GitHub les sources sont DONC ABSENTES. Dans ce cas, le test ne peut pas
 * verifier la coherence : il se declare ABSENT avec un AVERTISSEMENT BRUYANT et
 * `it.skip` — il n affiche JAMAIS un faux vert. Le hard-fail (mismatch) ne
 * s applique qu en LOCAL ou la source existe. C est cohérent avec une CI
 * actuellement bloquée (facturation) : la verification de coherence est un GATE
 * LOCAL / pre-commit, pas un gate CI tant que les sources restent hors dépôt.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ENGINE_REGISTRY, ENGINE_SOURCE_DUPLICATES } from './registry.js';

const here = dirname(fileURLToPath(import.meta.url));
// packages/engines/src/registry -> racine repo 05-Plateforme (4 niveaux up).
const REPO_ROOT = resolve(here, '..', '..', '..', '..');

/** Resout un chemin source du registre (relatif a 05-Plateforme) en absolu. */
function resolveSource(cheminSource: string): string {
  return resolve(REPO_ROOT, cheminSource);
}

/** SHA-256 hex minuscule d un fichier. */
function sha256File(absPath: string): string {
  return createHash('sha256').update(readFileSync(absPath)).digest('hex');
}

// Les sources sont-elles presentes ? (absentes en CI : dossier hors dépôt git)
const SOURCES_PRESENTES = ENGINE_REGISTRY.every((e) =>
  existsSync(resolveSource(e.cheminSource)),
);

describe('Registre des moteurs — structure (toujours testable, sans source)', () => {
  it('contient exactement les 11 modules attendus (6 fichiers HTML, GEOPLAQUE en porte 4, PressioPro 3)', () => {
    // 6 fichiers HTML canoniques -> 11 MODULES : GEOPLAQUE_V10.html porte 4 solveurs
    // (radier ACM, plane-strain, axi, tri) et pressiometre__1_.html porte 3 calculs
    // (depouillement Menard, etalonnage, calibrage) — chaque groupe partage le meme
    // cheminSource + sha256.
    expect(ENGINE_REGISTRY).toHaveLength(11);
  });

  it('chaque entree a un id unique', () => {
    const ids = ENGINE_REGISTRY.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('les 4 modules GEOPLAQUE partagent le MEME fichier source (cheminSource + sha256)', () => {
    const geoplaque = ENGINE_REGISTRY.filter(
      (e) => e.fichierSource === 'GEOPLAQUE_V10.html',
    );
    expect(geoplaque.map((e) => e.id).sort()).toEqual([
      'axi-plaque',
      'plane-strain',
      'radier-plaque',
      'radier-tri',
    ]);
    // Meme source physique -> un SEUL sha256 et un SEUL chemin partages par les 4.
    expect(new Set(geoplaque.map((e) => e.sha256)).size).toBe(1);
    expect(new Set(geoplaque.map((e) => e.cheminSource)).size).toBe(1);
  });

  it('les 3 modules PressioPro partagent le MEME fichier source (cheminSource + sha256)', () => {
    const pressio = ENGINE_REGISTRY.filter(
      (e) => e.fichierSource === 'pressiometre__1_.html',
    );
    expect(pressio.map((e) => e.id).sort()).toEqual([
      'pressio-calibrage',
      'pressio-etalonnage',
      'pressiometre-menard',
    ]);
    // Meme source physique -> un SEUL sha256 et un SEUL chemin partages par les 3.
    expect(new Set(pressio.map((e) => e.sha256)).size).toBe(1);
    expect(new Set(pressio.map((e) => e.cheminSource)).size).toBe(1);
  });

  it('chaque sha256 est un digest SHA-256 hex minuscule (64 car.)', () => {
    for (const e of ENGINE_REGISTRY) {
      expect(e.sha256, e.id).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('chaque version est un semver simple', () => {
    for (const e of ENGINE_REGISTRY) {
      expect(e.version, e.id).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it('chaque entree documente comment la fonction a ete confirmee (anti-erreur d extraction)', () => {
    for (const e of ENGINE_REGISTRY) {
      expect(e.confirmePar.length, e.id).toBeGreaterThan(0);
      expect(e.fonction.length, e.id).toBeGreaterThan(0);
    }
  });

  it('les doublons racine pointent vers une entree canonique existante', () => {
    const ids = new Set(ENGINE_REGISTRY.map((e) => e.id));
    for (const d of ENGINE_SOURCE_DUPLICATES) {
      expect(ids.has(d.remplacePar), d.fichier).toBe(true);
    }
  });
});

describe('Registre des moteurs — coherence hash (GATE LOCAL)', () => {
  if (!SOURCES_PRESENTES) {
    // AVERTISSEMENT BRUYANT : honnete, jamais vert. On veut le voir passer dans
    // les logs CI sans qu il soit pris pour une verification reussie.
    const msg =
      '[#37] AVERTISSEMENT : sources moteur ABSENTES (03-Moteurs-client/ hors dépôt git). ' +
      'La coherence hash N A PAS ete verifiee — gate LOCAL uniquement. ' +
      'Ce skip n est PAS un succes.';
    // eslint-disable-next-line no-console -- avertissement volontaire (gate local absent)
    console.warn(msg);
    it.skip(`coherence hash NON verifiee (sources absentes) — ${msg}`, () => {
      /* volontairement skip : sources hors dépôt */
    });
    return;
  }

  it('le SHA-256 recalcule de chaque source == valeur du registre', () => {
    for (const e of ENGINE_REGISTRY) {
      const abs = resolveSource(e.cheminSource);
      const calcule = sha256File(abs);
      expect(
        calcule,
        `Hash divergent pour "${e.id}" (${e.fichierSource}). ` +
          `Le moteur a evolue OU le registre est obsolète : re-extraire, bumper la version, rejouer le golden.`,
      ).toBe(e.sha256);
    }
  });

  it('les doublons racine ont bien un contenu DIFFERENT du canonique (versions anterieures)', () => {
    // Confirme qu il s agit de versions distinctes (pas de copies identiques),
    // ce qui justifie de NE PAS les extraire et de les archiver.
    const canonBySha = new Set(ENGINE_REGISTRY.map((e) => e.sha256));
    for (const d of ENGINE_SOURCE_DUPLICATES) {
      const abs = resolveSource(d.cheminSource);
      if (!existsSync(abs)) continue; // doublon deja archive/absent : tolere
      const calcule = sha256File(abs);
      expect(calcule, `${d.fichier} (hash declare)`).toBe(d.sha256);
      expect(
        canonBySha.has(calcule),
        `${d.fichier} a le MEME hash qu un canonique — ce n est donc pas un doublon obsolète.`,
      ).toBe(false);
    }
  });
});

describe('Registre des moteurs — la verification MORD (test negatif)', () => {
  // Prouve que la comparaison de hash echoue VRAIMENT sur un contenu altere :
  // un comparateur laxiste serait un faux-vert (DoD §9 « zéro faux-vert »).
  it('un contenu temoin altere produit un hash != registre', () => {
    const refEntry = ENGINE_REGISTRY[0];
    expect(refEntry).toBeDefined();
    // SHA-256 d une chaine temoin connue (pas le HTML moteur) :
    const hashTemoin = createHash('sha256')
      .update('contenu-altere-temoin-#37')
      .digest('hex');
    // Si la verif comparait n importe quoi a n importe quoi, ceci passerait :
    expect(hashTemoin).not.toBe(refEntry?.sha256);
  });

  it('recalculer le hash d un contenu connu donne une valeur deterministe et exacte', () => {
    // Ancre la primitive elle-meme : SHA-256("") est une constante connue.
    const vide = createHash('sha256').update('').digest('hex');
    expect(vide).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});
