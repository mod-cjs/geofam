import * as argon2 from 'argon2';

/**
 * Hachage de mot de passe — argon2id (recommandation OWASP).
 *
 * argon2id combine resistance GPU (data-dependent) et resistance side-channel
 * (data-independent). Les parametres sont ceux par defaut d'argon2 (>= profil
 * OWASP "moderate") ; ils sont encodes DANS le hash PHC, donc une evolution
 * future ne casse pas la verification des anciens hashes.
 *
 * Regle absolue : aucun mot de passe en clair ne sort d'ici, n'est logge ni
 * stocke. Seul le hash PHC (`$argon2id$...`) est persiste dans users.password_hash.
 */
export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, { type: argon2.argon2id });
}

/**
 * Verifie un mot de passe en clair contre un hash PHC stocke.
 * Renvoie false (jamais throw) si le hash est absent/illisible -> l'appelant
 * traite cela comme un echec d'authentification generique (pas d'oracle).
 */
export async function verifyPassword(
  hash: string | null | undefined,
  plain: string,
): Promise<boolean> {
  if (!hash) return false;
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}
