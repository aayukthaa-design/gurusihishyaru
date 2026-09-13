#!/usr/bin/env bash
# Deploys the current local branch's already-pushed HEAD to the production VPS.
# Usage: git push origin main   (do this first — the VPS pulls from GitHub, it never
#                                 receives code directly from this machine)
#        ./scripts/deploy.sh
set -euo pipefail

REMOTE_HOST="gurushishyaru-vps"   # see ~/.ssh/config
REMOTE_DIR="/var/www/gurushishyaru.in"
SERVICE="gurushishyaru"

echo "==> Deploying to ${REMOTE_HOST}:${REMOTE_DIR}"
ssh "$REMOTE_HOST" "
  set -euo pipefail
  cd '$REMOTE_DIR'
  git fetch origin
  git reset --hard origin/main
  npm ci
  npm run build
  systemctl restart '$SERVICE'
  sleep 1
  systemctl is-active '$SERVICE'
"
echo "==> Done. Live at https://gurushishyaru.in"
