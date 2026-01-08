-- 20251215_000010_fix_installments_legacy_cols.sql
-- Fix: legacy schema mismatches for installments.
--
-- Problem
-- - Legacy DB (from 002_tables.sql) expects:
--   * installments.admin_id NOT NULL
--   * installments.installment_no NOT NULL
-- - Backend (new code) inserts only:
--   * credit_id, installment_number, due_date, amount_due, amount_paid, status
--   and reads using installment_number + deleted_at.
--
-- Solution
-- - Keep both columns and sync them.
-- - Auto-fill admin_id from credits.admin_id.
-- - Ensure deleted_at exists for backend filters.

-- Ensure columns exist
ALTER TABLE installments ADD COLUMN IF NOT EXISTS installment_number int;
ALTER TABLE installments ADD COLUMN IF NOT EXISTS installment_no int;
ALTER TABLE installments ADD COLUMN IF NOT EXISTS admin_id uuid;
ALTER TABLE installments ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- Backfill number columns both ways (for old rows)
UPDATE installments
SET installment_number = installment_no
WHERE installment_number IS NULL AND installment_no IS NOT NULL;

UPDATE installments
SET installment_no = installment_number
WHERE installment_no IS NULL AND installment_number IS NOT NULL;

-- Backfill admin_id from credit (for old rows)
UPDATE installments i
SET admin_id = c.admin_id
FROM credits c
WHERE i.credit_id = c.id
  AND i.admin_id IS NULL;

-- Trigger to keep legacy columns synced and auto-fill admin_id
CREATE OR REPLACE FUNCTION trg_installments_sync_legacy_cols()
RETURNS trigger AS $$
DECLARE
  c_admin uuid;
BEGIN
  -- Keep installment_no <-> installment_number synced
  IF NEW.installment_no IS NULL AND NEW.installment_number IS NOT NULL THEN
    NEW.installment_no := NEW.installment_number;
  END IF;

  IF NEW.installment_number IS NULL AND NEW.installment_no IS NOT NULL THEN
    NEW.installment_number := NEW.installment_no;
  END IF;

  -- Auto-fill admin_id from credit (needed if legacy column is NOT NULL)
  IF NEW.admin_id IS NULL THEN
    SELECT admin_id INTO c_admin
    FROM credits
    WHERE id = NEW.credit_id;

    IF c_admin IS NOT NULL THEN
      NEW.admin_id := c_admin;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger name intentionally sorts BEFORE trg_installments_same_admin (from 003_indexes_triggers.sql)
DROP TRIGGER IF EXISTS trg_installments_000_sync_legacy_cols ON installments;

CREATE TRIGGER trg_installments_000_sync_legacy_cols
BEFORE INSERT OR UPDATE ON installments
FOR EACH ROW
EXECUTE FUNCTION trg_installments_sync_legacy_cols();
