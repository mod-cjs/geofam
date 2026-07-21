/**
 * project-ref — référence courte mnémonique d'un projet (ex. « CH-2026-4F7A »).
 *
 * Sert à repérer un projet d'un coup d'œil dans l'en-tête et à le citer
 * oralement ou par écrit, là où l'UUID est illisible et le nom trop long.
 *
 * Trois choix assumés :
 *
 *  1. DÉRIVÉE de l'identité réelle (domaine + année de création + id), et NON
 *     d'un compteur. Un numéro séquentiel (« -014 ») laisserait croire à un
 *     registre officiel que nous ne tenons pas : le seul numéro qui fait
 *     référence est celui du PV, attribué et scellé côté serveur. Cette
 *     référence-ci est un repère de lecture, pas une immatriculation.
 *  2. STABLE au renommage : elle ne dépend pas du nom. Renommer un projet ne
 *     doit pas invalider une référence déjà citée dans un échange.
 *  3. DÉTERMINISTE et purement client : aucun aller-retour serveur, donc
 *     calculable partout où l'on a l'objet Project.
 */

import type { Project } from './api/types';

/** Année de repli si `createdAt` est absent ou illisible — jamais « NaN ». */
const ANNEE_INCONNUE = '0000';

/** Alphabet du suffixe : chiffres + majuscules, sans I/O/0/1 ambigus à l'oral. */
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/** Longueur du suffixe — 4 signes sur 32 symboles ≈ 1,05 M combinaisons. */
const LONGUEUR_SUFFIXE = 4;

/**
 * Empreinte entière stable d'une chaîne (FNV-1a 32 bits).
 * Choisie pour sa stabilité inter-navigateurs et son absence de dépendance ;
 * ce n'est pas — et n'a pas à être — une empreinte cryptographique : elle ne
 * protège rien, elle ne fait que raccourcir un identifiant déjà public.
 */
function empreinte(valeur: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < valeur.length; i++) {
    h ^= valeur.charCodeAt(i);
    // Multiplication FNV en 32 bits non signés (évite la perte de précision).
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Encode l'empreinte sur `LONGUEUR_SUFFIXE` symboles de l'alphabet. */
function suffixe(id: string): string {
  let reste = empreinte(id);
  let out = '';
  for (let i = 0; i < LONGUEUR_SUFFIXE; i++) {
    out = ALPHABET[reste % ALPHABET.length] + out;
    reste = Math.floor(reste / ALPHABET.length);
  }
  return out;
}

/** Année de `createdAt`, ou repli si la date est absente/invalide. */
function annee(createdAt: string | undefined): string {
  if (!createdAt) return ANNEE_INCONNUE;
  const d = new Date(createdAt);
  const y = d.getFullYear();
  return Number.isNaN(y) ? ANNEE_INCONNUE : String(y);
}

/**
 * Référence courte d'un projet : `<DOMAINE>-<ANNÉE>-<SUFFIXE>`.
 *
 * Un projet LEGACY sans domaine reçoit le préfixe neutre `GEN` plutôt qu'un
 * domaine deviné — on n'invente pas une donnée métier absente.
 */
export function projectRef(
  project: Pick<Project, 'id' | 'domain' | 'createdAt'>,
): string {
  const domaine = project.domain ?? 'GEN';
  return `${domaine}-${annee(project.createdAt)}-${suffixe(project.id)}`;
}
