-- 20260415_000014_add_missing_indexes.sql
-- Add missing indexes for hot-path queries on payments and vendor_cash_movements.
-- The vendor dashboard and reports filter payments by vendor_id + paid_at frequently.

BEGIN;

CREATE INDEX IF NOT EXISTS idx_payments_vendor_paid_at
  ON payments (admin_id, vendor_id, paid_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_vendor_cash_movements_vendor_occurred_at
  ON vendor_cash_movements (admin_id, vendor_id, occurred_at DESC)
  WHERE deleted_at IS NULL;

COMMIT;
