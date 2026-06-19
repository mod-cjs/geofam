#!/usr/bin/env bash
#
# gh-project-setup.sh — cree les labels et les jalons (milestones) Phase 1 du depot.
# Necessite la CLI GitHub authentifiee :  gh auth login
#
# Usage :
#   bash scripts/gh-project-setup.sh <owner/repo>
#   ex.  bash scripts/gh-project-setup.sh starfire/roadsen
#
# Idempotent : les labels/jalons existants sont ignores (ou mis a jour).
# NB : le board GitHub Projects (colonnes/automatisations) se cree dans l UI
#      ou via `gh project` ; voir CADRE-INGENIERIE.md, section "Gestion de projet".

set -euo pipefail

REPO="${1:-}"
if [ -z "$REPO" ]; then
  echo "Usage : bash scripts/gh-project-setup.sh <owner/repo>" >&2
  exit 1
fi
if ! command -v gh >/dev/null 2>&1; then
  echo "La CLI GitHub (gh) est requise. Installe-la puis 'gh auth login'." >&2
  exit 1
fi

echo "Configuration du depot : $REPO"

# --- Labels ---------------------------------------------------------
# format : "nom|couleur(hex)|description"
labels=(
  "type:feature|1d76db|Nouvelle fonctionnalite"
  "type:bug|d73a4a|Defaut / comportement incorrect"
  "type:chore|cfd3d7|Tache technique / maintenance"
  "type:docs|0075ca|Documentation"
  "dependencies|0366d6|Mise a jour de dependances"
  "ci|fbca04|Integration / deploiement continus"
  "area:api|5319e7|Backend NestJS/Prisma"
  "area:web|0e8a16|Frontend Next.js/PWA"
  "area:engines|b60205|Moteurs de calcul (cote serveur, confidentiel)"
  "area:infra|c5def5|Infra / Cloudflare / Render"
  "area:security|e11d21|Securite / isolation multi-tenant"
  "priority:high|d93f0b|Priorite haute"
  "priority:medium|fbca04|Priorite moyenne"
  "priority:low|c2e0c6|Priorite basse"
  "blocked|000000|Bloque par une dependance"
  "needs-review|d4c5f9|En attente de revue (qa-challenger)"
)

echo "Creation/maj des labels..."
for entry in "${labels[@]}"; do
  IFS='|' read -r name color desc <<< "$entry"
  if gh label create "$name" --color "$color" --description "$desc" --repo "$REPO" 2>/dev/null; then
    echo "  + $name"
  else
    gh label edit "$name" --color "$color" --description "$desc" --repo "$REPO" >/dev/null 2>&1 \
      && echo "  ~ $name (mis a jour)" \
      || echo "  ! $name (ignore)"
  fi
done

# --- Jalons Phase 1 (milestones) ------------------------------------
milestones=(
  "P1 - Socle plateforme|Monorepo, CI/CD, auth/RBAC, multi-tenant, base scellement"
  "P1 - Integration moteurs|Extraction GeoSuite -> packages/engines (serveur), equivalence"
  "P1 - Module Chaussees|Recalcul serveur Burmister/AGEROUTE + PV scelle"
  "P1 - Fondations superficielles|Terzaghi/EC7 cote serveur + PV"
  "P1 - Fondations profondes (pieux)|Casagrande/Fascicule 62 + PV"
  "P1 - Durcissement & preprod|Observabilite, sauvegardes testees, revue securite"
)

echo "Creation des jalons Phase 1..."
for entry in "${milestones[@]}"; do
  IFS='|' read -r title desc <<< "$entry"
  gh api "repos/$REPO/milestones" -f title="$title" -f description="$desc" >/dev/null 2>&1 \
    && echo "  + $title" \
    || echo "  ~ $title (existe deja)"
done

echo
echo "Termine. Pense ensuite a :"
echo "  - activer la protection de branche 'main' (PR requise + CI verte)"
echo "  - creer le board GitHub Projects (colonnes Backlog/Ready/In progress/Review/Done)"
echo "  - donner un acces lecture au client sur le board"
