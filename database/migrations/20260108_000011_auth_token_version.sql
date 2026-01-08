-- 20260108_000011_auth_token_version.sql
BEGIN;

ALTER TABLE admins
  ADD COLUMN IF NOT EXISTS token_version int NOT NULL DEFAULT 0;

ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS token_version int NOT NULL DEFAULT 0;

-- (opcional pero recomendado si tu auth “amarra” el dispositivo)
ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS device_id_hash text,
  ADD COLUMN IF NOT EXISTS device_bound_at timestamptz,
  ADD COLUMN IF NOT EXISTS device_last_seen_at timestamptz;

COMMIT;
