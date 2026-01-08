#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   DATABASE_URL="postgresql://..." ./database/run_all.sh
#
# Note: Supabase requires SSL, so your DATABASE_URL should include:
#   ?sslmode=require

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

: "${DATABASE_URL:?Set DATABASE_URL first}"

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$ROOT_DIR/database/migrations/001_extensions.sql"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$ROOT_DIR/database/migrations/002_tables.sql"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$ROOT_DIR/database/migrations/003_indexes_triggers.sql"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$ROOT_DIR/database/seed/001_seed_admin.sql"

echo "✅ DB migrated + seeded"
