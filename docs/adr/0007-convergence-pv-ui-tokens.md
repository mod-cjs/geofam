# ADR 0007 — Convergence PV / UI : un seul systeme de tokens, abandon navy/orange

- Statut : accepte
- Date : 2026-06-27

## Contexte
Le PV scelle (note de calcul, sortie PDF) et le devis utilisaient la palette navy #1a4a7a
+ orange accent #bf6a04. L app v3 (ADR 0006) introduit un nouveau systeme de tokens.
Maintenir deux palettes en parallele = incoherence de marque app/livrable, double
maintenance, et une collision orange/bordeaux problematique sous deficience visuelle (CVD).

## Decision
- **Un seul systeme de tokens (v3) de bout en bout** : application web ET PV generes
  desormais partagent les memes tokens.
- **navy #1a4a7a et orange #bf6a04 sont abandonnes** et interdits dans tout nouveau
  livrable. Decision irreversible.
- Le theme PDF du PV (`apps/api/src/pv/pdf/pv-pdf.theme.ts`) migrera vers les tokens v3.
  C est un chantier de **presentation uniquement** : le recalcul serveur, la serialisation
  canonique et le scellement HMAC sont inchanges (aucun impact sur l integrite/le sceau).
- **Le `Devis_ROADSEN.html` (livrable gele et signe) n est PAS rebrande retroactivement.**
  Il ne sera repasse sur les tokens v3 que lors d une **reemission** (nouvelle version /
  avenant), et uniquement sur validation humaine explicite (cf. regle de gouvernance des
  livrables geles). Rebrander du gele pour des raisons cosmetiques est exclu.

## Consequences
- Coherence visuelle totale entre l app et les PV produits.
- Un chantier dedie de migration du theme PV (a planifier ; tests d equivalence de rendu PV
  a prevoir, le contenu scelle restant identique).
- Pas de double maintenance de palette pour le neuf ; l historique gele reste tel quel.
