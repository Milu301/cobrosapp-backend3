-- 20260330_000013_fix_installments_status_paid_late.sql
--
-- Problem: installments.status CHECK constraint (from 002_tables.sql) only allows
-- ('pending','paid','late') but the application writes 'paid_late' for installments
-- paid after their due date. This causes a constraint violation on payment.
--
-- Solution: Drop the old constraint and add a new one that includes 'paid_late'.

ALTER TABLE installments DROP CONSTRAINT IF EXISTS installments_status_check;

ALTER TABLE installments
  ADD CONSTRAINT installments_status_check
  CHECK (status IN ('pending', 'paid', 'late', 'paid_late'));

-- Backfill any rows that may have been blocked (shouldn't exist, but safe):
UPDATE installments
SET status = 'paid_late'
WHERE status NOT IN ('pending', 'paid', 'late', 'paid_late');
