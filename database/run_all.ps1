param(
  [Parameter(Mandatory=$true)]
  [string]$DatabaseUrl
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot

psql "$DatabaseUrl" -v ON_ERROR_STOP=1 -f "$root\database\migrations\001_extensions.sql"
psql "$DatabaseUrl" -v ON_ERROR_STOP=1 -f "$root\database\migrations\002_tables.sql"
psql "$DatabaseUrl" -v ON_ERROR_STOP=1 -f "$root\database\migrations\003_indexes_triggers.sql"

psql "$DatabaseUrl" -v ON_ERROR_STOP=1 -f "$root\database\migrations\20251215_000006_credits_installments_payments.sql"

psql "$DatabaseUrl" -v ON_ERROR_STOP=1 -f "$root\database\seed\001_seed_admin.sql"

Write-Host "✅ DB migrated + seeded"
