#!/usr/bin/env bash
#
# setup-macos.sh — prepare le poste de developpement ROADSEN sur macOS.
# Installe fnm + Node 20, active corepack/pnpm, verifie Docker, installe les hooks git.
# On evite Homebrew (lent sur ce poste) : fnm via le script officiel, pnpm via corepack.
#
# Usage :  bash scripts/setup-macos.sh
# Idempotent : peut etre relance sans danger.

set -euo pipefail

NODE_VERSION="20"
log()  { printf '\033[1;34m[setup]\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33m[warn ]\033[0m %s\n' "$1"; }
ok()   { printf '\033[1;32m[ ok  ]\033[0m %s\n' "$1"; }

# --- Detection du shell rc ---
detect_rc() {
  case "${SHELL:-}" in
    */zsh) echo "$HOME/.zshrc" ;;
    */bash) echo "$HOME/.bashrc" ;;
    *) echo "$HOME/.zshrc" ;;
  esac
}
RC_FILE="$(detect_rc)"

# --- 1. fnm (Fast Node Manager) ---
if command -v fnm >/dev/null 2>&1; then
  ok "fnm deja installe ($(fnm --version))"
else
  log "Installation de fnm (script officiel, sans Homebrew)..."
  curl -fsSL https://fnm.vercel.app/install | bash -s -- --skip-shell
  export PATH="$HOME/.local/share/fnm:$PATH"
  if ! grep -q 'fnm env' "$RC_FILE" 2>/dev/null; then
    {
      echo ''
      echo '# fnm (ROADSEN)'
      echo 'export PATH="$HOME/.local/share/fnm:$PATH"'
      echo 'eval "$(fnm env --use-on-cd)"'
    } >> "$RC_FILE"
    ok "fnm ajoute a $RC_FILE"
  fi
fi
export PATH="$HOME/.local/share/fnm:$PATH"
eval "$(fnm env)" || true

# --- 2. Node 20 LTS ---
log "Installation de Node ${NODE_VERSION} (LTS) via fnm..."
fnm install "$NODE_VERSION"
fnm default "$NODE_VERSION"
fnm use "$NODE_VERSION"
ok "Node $(node -v)"

# --- 3. pnpm via corepack (pas d install globale separee) ---
log "Activation de corepack + pnpm..."
corepack enable
corepack prepare pnpm@9.12.0 --activate
ok "pnpm $(pnpm -v)"

# --- 4. Docker (Postgres local) ---
if command -v docker >/dev/null 2>&1; then
  if docker info >/dev/null 2>&1; then
    ok "Docker present et demarre"
  else
    warn "Docker installe mais non demarre. Lance Docker Desktop avant 'pnpm db:up'."
  fi
else
  warn "Docker absent. Installe Docker Desktop (https://www.docker.com/products/docker-desktop/)"
  warn "  -> requis pour la base Postgres locale (pnpm db:up)."
fi

# --- 5. Dependances du monorepo + hooks git ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$SCRIPT_DIR"
if [ -f package.json ]; then
  log "Installation des dependances (pnpm install)..."
  pnpm install
  if [ -d .git ]; then
    log "Installation des hooks git (husky)..."
    pnpm exec husky || warn "husky : a relancer apres 'git init' si le depot n est pas encore initialise."
  else
    warn "Pas de depot git ici. Fais 'git init' puis 'pnpm exec husky' pour activer les hooks."
  fi
fi

echo
ok "Poste pret."
echo "Etapes suivantes :"
echo "  1) Recharge ton shell :  source $RC_FILE   (ou ouvre un nouveau terminal)"
echo "  2) Demarre la base    :  pnpm db:up"
echo "  3) Lance le dev       :  pnpm dev"
