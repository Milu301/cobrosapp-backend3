-- 003_cash_deleted_at.sql

ALTER TABLE admin_cash_movements
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

ALTER TABLE vendor_cash_movements
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- Índices (opcionales pero recomendados)
CREATE INDEX IF NOT EXISTS idx_admin_cash_movements_admin_deleted
  ON admin_cash_movements (admin_id, deleted_at);

CREATE INDEX IF NOT EXISTS idx_vendor_cash_movements_vendor_deleted
  ON vendor_cash_movements (admin_id, vendor_id, deleted_at);
