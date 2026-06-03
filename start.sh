#!/usr/bin/env bash
set -euo pipefail

BOLD='\033[1m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
RESET='\033[0m'

BACKEND_PORT=${PORT:-3000}
FRONTEND_PORT=5173

# ── Check .env ────────────────────────────────────────────────────────────────
if [ ! -f .env ]; then
  echo "No .env found — run ./setup.sh first"
  exit 1
fi

# Export env vars
set -a; source .env; set +a

# ── Choose binary: release if built, else cargo run ───────────────────────────
if [ -f target/release/mimix ]; then
  BACKEND_CMD="./target/release/mimix"
  BACKEND_LABEL="backend (release)"
else
  BACKEND_CMD="cargo run"
  BACKEND_LABEL="backend (dev — compiling…)"
fi

echo -e "${BOLD}KB — Starting${RESET}"
echo "────────────────────────────"
echo -e "  ${BLUE}${BACKEND_LABEL}${RESET}  →  http://localhost:${BACKEND_PORT}"
echo -e "  ${CYAN}frontend (dev)${RESET}       →  http://localhost:${FRONTEND_PORT}"
echo ""
echo "  Press Ctrl+C to stop all servers"
echo ""

# ── Start backend ─────────────────────────────────────────────────────────────
eval "$BACKEND_CMD" 2>&1 | sed "s/^/$(printf '\033[0;34m')[backend] $(printf '\033[0m')/" &
BACKEND_PID=$!

# Wait for backend to be ready (max 30s)
echo -e "${BLUE}[backend]${RESET} Waiting for port ${BACKEND_PORT}..."
for i in $(seq 1 30); do
  if curl -s "http://localhost:${BACKEND_PORT}/api/projects" &>/dev/null; then
    echo -e "${GREEN}[backend] Ready ✓${RESET}"
    break
  fi
  sleep 1
done

# ── Start frontend ────────────────────────────────────────────────────────────
(cd frontend-react && npm run dev) 2>&1 | sed "s/^/$(printf '\033[0;36m')[frontend]$(printf '\033[0m') /" &
FRONTEND_PID=$!

# ── Trap Ctrl+C ───────────────────────────────────────────────────────────────
cleanup() {
  echo ""
  echo "Stopping servers…"
  kill "$BACKEND_PID"  2>/dev/null || true
  kill "$FRONTEND_PID" 2>/dev/null || true
  # Kill any cargo processes that may have spawned
  pkill -f "target/debug/mimix"   2>/dev/null || true
  pkill -f "target/release/mimix" 2>/dev/null || true
  echo "Stopped."
  exit 0
}
trap cleanup INT TERM

wait
