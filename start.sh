#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

: "${MASTER_API_KEY:?MASTER_API_KEY is required}"
: "${KIRO_API_KEY:?KIRO_API_KEY is required}"

if ! command -v npm >/dev/null 2>&1 && [[ -s "$HOME/.nvm/nvm.sh" ]]; then
  # systemd does not load interactive shell startup files; source nvm when needed.
  # shellcheck disable=SC1090
  source "$HOME/.nvm/nvm.sh"
fi

if command -v npm >/dev/null 2>&1; then
  exec npm start
fi

if command -v node >/dev/null 2>&1; then
  exec node server.js
fi

echo "Neither npm nor node was found on PATH" >&2
exit 127
