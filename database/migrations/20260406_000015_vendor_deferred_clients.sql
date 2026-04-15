-- 20260406_000015_vendor_deferred_clients.sql
-- Clients a pasar al día siguiente (solo semanales)

CREATE TABLE IF NOT EXISTS vendor_deferred_clients (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id   uuid NOT NULL REFERENCES admins(id),
  vendor_id  uuid NOT NULL REFERENCES vendors(id),
  client_id  uuid NOT NULL REFERENCES clients(id),
  from_date  date NOT NULL,
  for_date   date NOT NULL,
  reason     text NULL,
  deleted_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vdc_vendor_for_date
  ON vendor_deferred_clients(vendor_id, for_date)
  WHERE deleted_at IS NULL;
