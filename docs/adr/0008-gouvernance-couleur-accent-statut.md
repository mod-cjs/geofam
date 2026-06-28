# ADR 0008 — Gouvernance couleur : frontiere accent/statut et adjacence laterite/fail

- Statut : accepte
- Date : 2026-06-27

## Contexte
La laterite (#b86a2e marque / #a05226 action) et le bordeaux-verdict (#8b1a1a) sont des
teintes chaudes desaturees proches : sous protanopie/deuteranopie, elles convergent vers
des bruns voisins. Or le rouge et le vert portent une **semantique critique** dans ROADSEN :
la conformite d un dimensionnement (chaussee, fondation) engage la responsabilite d un
ingenieur. Une ambiguite couleur sur un verdict est inacceptable.

## Decision
- **Rouge et vert = verdicts de conformite UNIQUEMENT.** Jamais en lien, bouton, tag,
  decoration. A instrumenter en lint + **test negatif CI**.
- **Frontiere accent/statut** : `--accent-*` et `--struct-petrole` ne sont jamais utilises
  dans un composant de statut/verdict ; `--status-pass-*` / `--status-fail-*` ne sont jamais
  utilises hors contexte verdict. A instrumenter en lint.
- **Triple redondance de tout verdict** : couleur + icone (Lucide, stroke 1,5) + libelle
  texte. Jamais de couleur seule (couvre le daltonisme et l impression N&B).
- **Regle d adjacence** : `--accent-brand` (#b86a2e) et `--status-fail-tx` (#8b1a1a) ne sont
  jamais adjacents dans un meme bloc (UI ou PV) sans zone neutre intermediaire (asphalte,
  blanc, ou espace >= 16 px). A verifier en revue de maquette PV.
- **Tags de domaine** : redondance non-chromatique obligatoire (prefixe texte CH./FD./LB.),
  les fonds pastel etant indistinguables en N&B.

## Consequences
- Accessibilite verdicts couverte par trois canaux independants ; robustesse CVD et N&B.
- Verification ajoutee a la revue de maquette (adjacence) et a la CI (test negatif couleur).
- Contrainte de design assumee : la chaleur de marque reste a distance des signaux de statut.
