BEGIN;

ALTER TABLE admin_cash_movements
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

ALTER TABLE vendor_cash_movements
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

COMMIT;
