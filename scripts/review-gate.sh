#!/usr/bin/env bash
# =====================================================================
#  ROADSEN — Gate de validation (backbone de /review-pr ET du pre-push)
#
#  Exécute, de façon DÉTERMINISTE et HONNÊTE, la validation locale (la CI
#  Actions étant bloquée — facturation). Versionné DANS le dépôt pour être
#  portable (autres clones, CI future, hook git).
#
#  Sections : lint · typecheck · build · unit (Vitest/Jest) · e2e backend +
#  isolation multi-tenant (Jest + Postgres Docker, rôle roadsen_app) ·
#  confidentialité DoD §8 (bundle navigateur + test négatif garde-fou ESLint) ·
#  garde-fou migrations destructrices · e2e frontend Playwright (si présents).
#
#  Principe : AUCUN faux-vert. Une suite absente = ABSENTE (jamais PASS).
#  Toute section requise rouge -> exit non nul.
#
#  Usage :
#    bash scripts/review-gate.sh [base_ref]        # gate COMPLET
#    bash scripts/review-gate.sh --fast [base_ref] # sous-ensemble RAPIDE
#       (lint, typecheck, unit, e2e backend+isolation, migrations ;
#        SAUTE build Next, confidentialité-bundle, Playwright — utilisé en
#        pre-push : ~4 min, attrape les régressions de type #56)
#
#  N'ÉCRIT RIEN dans le dépôt (hormis un guardcheck temporaire, nettoyé).
# =====================================================================
set -uo pipefail

# Racine = dossier parent de ce script (indépendant du CWD).
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API="$ROOT/apps/api"
WEB="$ROOT/apps/web"

FAST=false
if [ "${1:-}" = "--fast" ]; then FAST=true; shift; fi
BASE="${1:-main}"
PNPM="corepack pnpm@9.12.0"

cd "$ROOT" || { echo "FATAL: $ROOT introuvable"; exit 2; }

declare -a SECTIONS=() STATUSES=()
FAILED=0
record() { SECTIONS+=("$1"); STATUSES+=("$2"); [ "$2" = "FAIL" ] && FAILED=1; return 0; }
run() { local nom="$1"; shift; echo ">>> [$nom] \$ $*"
  if "$@"; then echo "<<< [$nom] PASS"; record "$nom" PASS
  else echo "<<< [$nom] FAIL ($?)"; record "$nom" FAIL; fi; }

echo "======================================================================"
echo " ROADSEN review-gate $([ "$FAST" = true ] && echo '(--fast)') — base=$BASE — $(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null)"
echo "======================================================================"

CHANGED="$(git -C "$ROOT" diff --name-only "$BASE"...HEAD 2>/dev/null || git -C "$ROOT" diff --name-only HEAD)"
has() { echo "$CHANGED" | grep -qE "$1"; }
TOUCH_MIG=false; has 'prisma/migrations/' && TOUCH_MIG=true

# --- 1) Qualité ------------------------------------------------------
run "lint"      $PNPM lint
run "typecheck" $PNPM typecheck
if [ "$FAST" = false ]; then run "build" $PNPM build; fi
run "unit (turbo test)" $PNPM test

# --- 2) Postgres Docker ----------------------------------------------
PG_OK=false
echo ">>> [postgres] pnpm db:up + attente"
$PNPM db:up >/dev/null 2>&1 || true
for _ in $(seq 1 30); do
  if docker exec roadsen-postgres pg_isready -U roadsen >/dev/null 2>&1; then PG_OK=true; break; fi
  sleep 1
done
if $PG_OK; then echo "<<< [postgres] READY"; record "postgres" PASS
else echo "<<< [postgres] INDISPONIBLE"; record "postgres" FAIL; fi

# --- 3) e2e backend + isolation --------------------------------------
if $PG_OK && [ -f "$API/.env" ]; then
  ( cd "$API" && $PNPM --filter @roadsen/api prisma migrate deploy \
    && set -a && . ./.env && set +a \
    && $PNPM --filter @roadsen/api test:e2e )
  if [ $? -eq 0 ]; then record "e2e-backend+isolation" PASS; else record "e2e-backend+isolation" FAIL; fi
else
  echo "<<< [e2e-backend] Postgres ou .env indisponible"; record "e2e-backend+isolation" FAIL
fi

# --- 4) Confidentialité DoD §8 -------------------------------------------
# BARRIÈRE #1 — test négatif du garde-fou ESLint (import moteur -> lint DOIT échouer).
# Ne nécessite AUCUN build -> exécutée TOUJOURS, y compris en --fast (pre-push). La revue
# adverse a montré que cette barrière était sautée en --fast et que la CI (qui la porte)
# était bloquée : §8 se retrouvait sans porte automatique. Elle est désormais non
# contournable au pre-push.
GUARD_DIR="$WEB/src/__reviewgate_guardcheck__"
mkdir -p "$GUARD_DIR" 2>/dev/null
printf "import '@roadsen/engines';\nexport const x = 1;\n" > "$GUARD_DIR/forbidden.ts" 2>/dev/null
if [ -f "$GUARD_DIR/forbidden.ts" ]; then
  if $PNPM --filter @roadsen/web lint >/dev/null 2>&1; then
    echo "<<< [garde-fou-eslint-moteurs] FAIL"; record "garde-fou-eslint-moteurs (DoD8)" FAIL
  else echo "<<< [garde-fou-eslint-moteurs] PASS"; record "garde-fou-eslint-moteurs (DoD8)" PASS; fi
  rm -rf "$GUARD_DIR"
else
  # FAIL-CLOSED (verification adverse) : si le fichier guardcheck n'a pas pu etre ecrit
  # (permission, FS plein), NE JAMAIS sauter en silence -> barriere NON prouvee = ROUGE.
  echo "<<< [garde-fou-eslint-moteurs] FAIL — guardcheck non ecrit (barriere §8 non prouvee)"
  record "garde-fou-eslint-moteurs (DoD8)" FAIL
fi

# BARRIÈRE #2 — contrôle de bundle navigateur (grep .next/static). Nécessite le build
# Next -> gate COMPLET uniquement (trop coûteux au pre-push). fail-closed si non bâti.
if [ "$FAST" = false ]; then
  if [ -d "$WEB/.next/static" ]; then
    if grep -rIl -e "@roadsen/engines" -e "__ROADSEN_ENGINE_CONFIDENTIAL_DO_NOT_SHIP__" "$WEB/.next/static" >/dev/null 2>&1; then
      echo "<<< [confidentialité-bundle] FAIL"; record "confidentialité-bundle (DoD8)" FAIL
    else echo "<<< [confidentialité-bundle] PASS"; record "confidentialité-bundle (DoD8)" PASS; fi
  else echo "<<< [confidentialité-bundle] FAIL — .next/static non bâti : la confidentialité §8 ne peut PAS être vérifiée (fail-closed). Lancer 'pnpm --filter @roadsen/web build' avant le gate complet."; record "confidentialité-bundle (DoD8)" FAIL; fi
fi

# --- 5) Garde-fou migrations destructrices ---------------------------
if $TOUCH_MIG; then
  fail=0
  while IFS= read -r f; do
    if grep -IniE "drop +(table|column|schema|constraint|index|type|sequence|view)|truncate|delete +from|alter +table .* drop" "$f" >/dev/null 2>&1; then
      grep -Iq "ROADSEN-MIGRATION-REVIEWED:" "$f" || { echo "   DDL destructeur non revu : $f"; fail=1; }
    fi
  done < <(find "$API/prisma/migrations" -name "migration.sql" 2>/dev/null)
  [ "$fail" -eq 0 ] && record "migrations-destructrices" PASS || record "migrations-destructrices" FAIL
fi

# --- 6) e2e frontend Playwright (complet uniquement) -----------------
if [ "$FAST" = false ]; then
  if ls "$WEB"/playwright.config.* >/dev/null 2>&1 || find "$WEB" -path '*e2e*' -name '*.spec.ts' 2>/dev/null | grep -q .; then
    ( cd "$ROOT" && $PNPM test:e2e )
    [ $? -eq 0 ] && record "e2e-frontend (Playwright)" PASS || record "e2e-frontend (Playwright)" FAIL
  else echo "<<< [e2e-frontend Playwright] ABSENT (frontend Sprint 2)"; record "e2e-frontend (Playwright)" ABSENT; fi
fi

# --- Synthèse --------------------------------------------------------
echo ""
echo "======================== SYNTHÈSE GATE ==============================="
for i in "${!SECTIONS[@]}"; do printf "  %-34s %s\n" "${SECTIONS[$i]}" "${STATUSES[$i]}"; done
echo "----------------------------------------------------------------------"
if [ "$FAILED" -eq 0 ]; then
  echo "  RÉSULTAT GATE : VERT$([ "$FAST" = true ] && echo ' (--fast)') — (ABSENT n'est pas un succès)"; exit 0
else
  echo "  RÉSULTAT GATE : ROUGE — au moins une section requise en échec"; exit 1
fi
