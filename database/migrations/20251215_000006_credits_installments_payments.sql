-- 20251215_000006_credits_installments_payments.sql
-- Safe migration: crea tablas si no existen y agrega columnas faltantes si ya existen.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =========================
-- credits
-- =========================
CREATE TABLE IF NOT EXISTS credits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL REFERENCES admins(id),
  client_id uuid NOT NULL REFERENCES clients(id),
  vendor_id uuid NULL REFERENCES vendors(id),

  principal_amount numeric(12,2) NOT NULL,
  interest_rate numeric(5,2) NOT NULL DEFAULT 0,
  installments_count int NOT NULL,
  start_date date NOT NULL,

  status text NOT NULL DEFAULT 'active', -- active|paid|late
  total_amount numeric(12,2) NOT NULL,
  balance numeric(12,2) NOT NULL,

  notes text NULL,

  deleted_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE credits ADD COLUMN IF NOT EXISTS admin_id uuid;
ALTER TABLE credits ADD COLUMN IF NOT EXISTS client_id uuid;
ALTER TABLE credits ADD COLUMN IF NOT EXISTS vendor_id uuid;

ALTER TABLE credits ADD COLUMN IF NOT EXISTS principal_amount numeric(12,2);
ALTER TABLE credits ADD COLUMN IF NOT EXISTS interest_rate numeric(5,2);
ALTER TABLE credits ADD COLUMN IF NOT EXISTS installments_count int;
ALTER TABLE credits ADD COLUMN IF NOT EXISTS start_date date;

ALTER TABLE credits ADD COLUMN IF NOT EXISTS status text;
ALTER TABLE credits ADD COLUMN IF NOT EXISTS total_amount numeric(12,2);
ALTER TABLE credits ADD COLUMN IF NOT EXISTS balance numeric(12,2);

ALTER TABLE credits ADD COLUMN IF NOT EXISTS notes text;

ALTER TABLE credits ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE credits ADD COLUMN IF NOT EXISTS created_at timestamptz;
ALTER TABLE credits ADD COLUMN IF NOT EXISTS updated_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_credits_admin_id ON credits(admin_id);
CREATE INDEX IF NOT EXISTS idx_credits_client_id ON credits(client_id);
CREATE INDEX IF NOT EXISTS idx_credits_vendor_id ON credits(vendor_id);
CREATE INDEX IF NOT EXISTS idx_credits_status ON credits(status);

-- =========================
-- installments
-- =========================
CREATE TABLE IF NOT EXISTS installments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_id uuid NOT NULL REFERENCES credits(id) ON DELETE CASCADE,

  installment_number int NOT NULL,
  due_date date NOT NULL,

  amount_due numeric(12,2) NOT NULL,
  amount_paid numeric(12,2) NOT NULL DEFAULT 0,

  status text NOT NULL DEFAULT 'pending', -- pending|paid|late
  paid_at timestamptz NULL,

  deleted_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE installments ADD COLUMN IF NOT EXISTS credit_id uuid;

ALTER TABLE installments ADD COLUMN IF NOT EXISTS installment_number int;
ALTER TABLE installments ADD COLUMN IF NOT EXISTS due_date date;

ALTER TABLE installments ADD COLUMN IF NOT EXISTS amount_due numeric(12,2);
ALTER TABLE installments ADD COLUMN IF NOT EXISTS amount_paid numeric(12,2);

ALTER TABLE installments ADD COLUMN IF NOT EXISTS status text;
ALTER TABLE installments ADD COLUMN IF NOT EXISTS paid_at timestamptz;

ALTER TABLE installments ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE installments ADD COLUMN IF NOT EXISTS created_at timestamptz;
ALTER TABLE installments ADD COLUMN IF NOT EXISTS updated_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS uq_installments_credit_num
ON installments(credit_id, installment_number);

CREATE INDEX IF NOT EXISTS idx_installments_credit_id ON installments(credit_id);
CREATE INDEX IF NOT EXISTS idx_installments_due_date ON installments(due_date);
CREATE INDEX IF NOT EXISTS idx_installments_status ON installments(status);

-- =========================
-- payments
-- =========================
CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_id uuid NOT NULL REFERENCES credits(id) ON DELETE CASCADE,

  admin_id uuid NOT NULL REFERENCES admins(id),
  vendor_id uuid NULL REFERENCES vendors(id),

  amount numeric(12,2) NOT NULL,
  paid_at timestamptz NOT NULL DEFAULT now(),
  method text NULL,
  note text NULL,

  deleted_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE payments ADD COLUMN IF NOT EXISTS credit_id uuid;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS admin_id uuid;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS vendor_id uuid;

ALTER TABLE payments ADD COLUMN IF NOT EXISTS amount numeric(12,2);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS paid_at timestamptz;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS method text;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS note text;

ALTER TABLE payments ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS created_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_payments_credit_id ON payments(credit_id);
CREATE INDEX IF NOT EXISTS idx_payments_admin_id ON payments(admin_id);
CREATE INDEX IF NOT EXISTS idx_payments_vendor_id ON payments(vendor_id);
