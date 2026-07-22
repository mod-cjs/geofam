/**
 * relative-day — ancienneté exprimée en JOURS CALENDAIRES.
 *
 * POURQUOI CE MODULE EXISTE (P0-4)
 * --------------------------------
 * L'app calculait l'ancienneté par `Math.floor((maintenant - t) / 86400000)` :
 * des tranches de 24 h GLISSANTES, pas des jours. Un élément d'hier 23:00
 * consulté ce matin à 08:00 — 9 h d'écart — affichait « aujourd'hui ».
 *
 * Sur des pièces quasi-probatoires (calculs datés, PV scellés), dire
 * « aujourd'hui » pour un document de la veille n'est pas défendable. On
 * compare donc des DATES (minuit local à minuit local), pas des durées.
 *
 * Le « maintenant » est un paramètre explicite : cela rend la fonction pure et
 * testable, et évite qu'un test dépende de l'heure à laquelle il tourne.
 */

/** Minuit local du jour de `d` — la borne qui définit un jour calendaire. */
function minuitLocal(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

const MS_PAR_JOUR = 86_400_000;

/**
 * Nombre de jours calendaires écoulés entre `date` et `maintenant`.
 * Jamais négatif : une date future (horloge client décalée) vaut 0.
 * `NaN` si la date est invalide — l'appelant doit le traiter.
 */
export function joursCalendairesEcoules(date: Date, maintenant: Date): number {
  const t = date.getTime();
  if (Number.isNaN(t)) return Number.NaN;
  // Différence entre minuits : insensible à l'heure, donc « hier 23:00 » et
  // « hier 00:05 » comptent tous deux pour 1 jour.
  const jours = Math.round((minuitLocal(maintenant) - minuitLocal(date)) / MS_PAR_JOUR);
  return jours < 0 ? 0 : jours;
}

/**
 * Libellé relatif lisible. Chaîne VIDE si la date est invalide — jamais « NaN »
 * ni exception : un horodatage illisible ne doit pas casser une liste.
 */
export function libelleRelatif(date: Date, maintenant: Date): string {
  const j = joursCalendairesEcoules(date, maintenant);
  if (Number.isNaN(j)) return '';
  if (j === 0) return "aujourd'hui";
  if (j === 1) return 'hier';
  return `il y a ${j} jours`;
}
