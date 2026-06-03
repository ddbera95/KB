#!/usr/bin/env bash
set -euo pipefail

BOLD='\033[1m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RESET='\033[0m'

step() { echo -e "\n${BLUE}▶ $1${RESET}"; }
ok()   { echo -e "${GREEN}✓ $1${RESET}"; }
warn() { echo -e "${YELLOW}⚠ $1${RESET}"; }

echo -e "${BOLD}KB — Setup${RESET}"
echo "────────────────────────────"

# ── Check prerequisites ───────────────────────────────────────────────────────
step "Checking prerequisites"

command -v rustc &>/dev/null || { echo "Rust not found. Install from https://rustup.rs"; exit 1; }
command -v cargo &>/dev/null || { echo "cargo not found. Install from https://rustup.rs"; exit 1; }
command -v node  &>/dev/null || { echo "Node.js not found. Install from https://nodejs.org"; exit 1; }
command -v npm   &>/dev/null || { echo "npm not found. Install Node.js from https://nodejs.org"; exit 1; }

ok "Rust $(rustc --version | cut -d' ' -f2), Node $(node --version)"

# ── Environment file ──────────────────────────────────────────────────────────
step "Environment"
if [ ! -f .env ]; then
  cp .env.example .env
  ok "Created .env from .env.example"
else
  warn ".env already exists — skipping"
fi

# ── Build backend ─────────────────────────────────────────────────────────────
step "Building Rust backend (release)"
cargo build --release
ok "Backend built → target/release/mimix"

# ── Frontend dependencies ─────────────────────────────────────────────────────
step "Installing frontend dependencies"
(cd frontend-react && npm install --legacy-peer-deps)
ok "frontend-react/node_modules ready"

# ── MCP server ────────────────────────────────────────────────────────────────
step "Installing MCP server dependencies"
(cd mcp-server && npm install)
ok "mcp-server/node_modules ready"

step "Installing mimix-mcp globally"
(cd mcp-server && npm install -g . 2>/dev/null) && ok "mimix-mcp installed globally" || warn "Global install failed — run: cd mcp-server && npm install -g ."

# ── Claude Code MCP registration ──────────────────────────────────────────────
step "Registering MCP server with Claude Code"
if command -v claude &>/dev/null; then
  claude mcp add mimix -s user -e KB_API_URL=http://localhost:3000 -- mimix-mcp 2>/dev/null \
    && ok "mimix MCP server registered (restart Claude Code to activate)" \
    || warn "Already registered or registration failed"
else
  warn "claude CLI not found — skip MCP registration (register manually)"
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}Setup complete!${RESET}"
echo ""
echo "  Start dev servers:   ./start.sh"
echo "  Start with make:     make start"
echo "  Build for prod:      make build"
echo ""
