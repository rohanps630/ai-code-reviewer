#!/usr/bin/env bash
# Sets up a local PostgreSQL database for development and eval runs.
# Requires: PostgreSQL 15 (brew install postgresql@15)
# Run once after cloning, or to reset the local DB.
#
# Usage:
#   ./scripts/setup-local-db.sh           # create + migrate
#   ./scripts/setup-local-db.sh --reset   # drop, recreate, migrate

set -euo pipefail

DB_NAME="acr_dev"
DB_URL="postgresql://localhost/${DB_NAME}"
PG_CONFIG="/opt/homebrew/opt/postgresql@15/bin/pg_config"
PG_SHARE="/opt/homebrew/opt/postgresql@15/share/postgresql@15/extension"
PGVECTOR_VERSION="v0.8.0"

# ── colours ──────────────────────────────────────────────────────────────────
green() { printf '\033[0;32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[0;33m%s\033[0m\n' "$*"; }
red() { printf '\033[0;31m%s\033[0m\n' "$*"; }

# ── reset flag ───────────────────────────────────────────────────────────────
RESET=false
for arg in "$@"; do [[ "$arg" == "--reset" ]] && RESET=true; done

# ── 1. Check PostgreSQL is running ────────────────────────────────────────────
if ! pg_isready -q 2>/dev/null; then
  yellow "PostgreSQL not running — starting..."
  brew services start postgresql@15
  sleep 2
fi
green "✓ PostgreSQL running"

# ── 2. Install pgvector for PG15 if missing ──────────────────────────────────
if [[ ! -f "${PG_SHARE}/vector.control" ]]; then
  yellow "pgvector not found for PG15 — building from source..."
  TMP_DIR=$(mktemp -d)
  git clone --quiet --branch "${PGVECTOR_VERSION}" \
    https://github.com/pgvector/pgvector.git "${TMP_DIR}/pgvector"
  pushd "${TMP_DIR}/pgvector" > /dev/null
  make PG_CONFIG="${PG_CONFIG}" > /dev/null 2>&1
  make install PG_CONFIG="${PG_CONFIG}" > /dev/null 2>&1
  popd > /dev/null
  rm -rf "${TMP_DIR}"
  green "✓ pgvector installed for PG15"
else
  green "✓ pgvector already installed"
fi

# ── 3. Drop DB if --reset ─────────────────────────────────────────────────────
if $RESET; then
  yellow "Dropping ${DB_NAME}..."
  dropdb --if-exists "${DB_NAME}"
fi

# ── 4. Create DB ──────────────────────────────────────────────────────────────
if psql -lqt 2>/dev/null | cut -d \| -f 1 | grep -qw "${DB_NAME}"; then
  green "✓ Database '${DB_NAME}' already exists"
else
  createdb "${DB_NAME}"
  green "✓ Database '${DB_NAME}' created"
fi

# ── 5. Enable pgvector extension ─────────────────────────────────────────────
psql "${DB_NAME}" -c "CREATE EXTENSION IF NOT EXISTS vector;" > /dev/null 2>&1
green "✓ pgvector extension enabled"

# ── 6. Write DATABASE_URL to apps/indexer/.env ───────────────────────────────
INDEXER_ENV="$(dirname "$0")/../apps/indexer/.env"
if [[ -f "${INDEXER_ENV}" ]]; then
  # Update existing line
  sed -i '' "s|^DATABASE_URL=.*|DATABASE_URL=${DB_URL}|" "${INDEXER_ENV}"
else
  # Create from .env.example and set the URL
  cp "$(dirname "$0")/../.env.example" "${INDEXER_ENV}"
  sed -i '' "s|^DATABASE_URL=.*|DATABASE_URL=${DB_URL}|" "${INDEXER_ENV}"
  yellow "Created apps/indexer/.env — add your API keys there"
fi
green "✓ DATABASE_URL set to ${DB_URL}"

# ── 7. Run Drizzle migrations ─────────────────────────────────────────────────
yellow "Running migrations..."
cd "$(dirname "$0")/.."
DATABASE_URL="${DB_URL}" pnpm db:migrate
green "✓ Migrations applied"

echo ""
green "Local DB ready: ${DB_URL}"
echo "  Run evals:  cd apps/indexer && uv run python -m evals.cli run --dataset v1"
echo "  Studio:     DATABASE_URL=${DB_URL} pnpm db:studio"
