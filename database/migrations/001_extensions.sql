-- 001_extensions.sql
-- Enable extensions used by this project (Supabase Postgres).
-- Run first.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;   -- case-insensitive text (emails)

COMMIT;
