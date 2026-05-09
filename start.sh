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

exec npm start
