-- 002_tables.sql
-- Core schema for cobranzas/rutas/créditos.
-- Run after 001_extensions.sql

BEGIN;

-- =========================
-- Core identity / tenancy
-- =========================

CREATE TABLE admins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email citext NOT NULL UNIQUE,
  password_hash text NOT NULL,
  full_name text,
  phone text,

  -- Subscription control (CRITICAL)
  subscription_expires_at timestamptz NOT NULL,

  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  last_login_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL REFERENCES admins(id) ON DELETE RESTRICT,

  email citext NOT NULL,
  password_hash text NOT NULL,
  name text NOT NULL,
  phone text,

  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  permissions jsonb NOT NULL DEFAULT '{}'::jsonb, -- e.g. { "canCreateCredits": true }

  last_login_at timestamptz,

  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL REFERENCES admins(id) ON DELETE RESTRICT,
  vendor_id uuid REFERENCES vendors(id) ON DELETE SET NULL,

  name text NOT NULL,
  phone text,
  doc_id text,        -- cedula / documento
  address text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  notes text,

  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- =========================
-- Routes / daily assignments / visits
-- =========================

CREATE TABLE routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL REFERENCES admins(id) ON DELETE RESTRICT,

  name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),

  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE route_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id uuid NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,

  visit_order int NOT NULL CHECK (visit_order >= 1),
  is_active boolean NOT NULL DEFAULT true,

  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE route_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL REFERENCES admins(id) ON DELETE RESTRICT,
  route_id uuid NOT NULL REFERENCES routes(id) ON DELETE RESTRICT,
  vendor_id uuid NOT NULL REFERENCES vendors(id) ON DELETE RESTRICT,

  assigned_date date NOT NULL,
  status text NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned','completed','cancelled')),
  notes text,

  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE route_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL REFERENCES admins(id) ON DELETE RESTRICT,

  route_assignment_id uuid NOT NULL REFERENCES route_assignments(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  vendor_id uuid NOT NULL REFERENCES vendors(id) ON DELETE RESTRICT,

  visited boolean NOT NULL,
  note text,
  visited_at timestamptz NOT NULL DEFAULT now(),

  created_at timestamptz NOT NULL DEFAULT now()
);

-- =========================
-- Credits / installments / payments
-- =========================

CREATE TABLE credits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL REFERENCES admins(id) ON DELETE RESTRICT,
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  vendor_id uuid REFERENCES vendors(id) ON DELETE SET NULL, -- who created / manages

  principal_amount numeric(12,2) NOT NULL CHECK (principal_amount > 0),
  interest_rate numeric(5,2) NOT NULL DEFAULT 0 CHECK (interest_rate >= 0), -- %
  term_count int NOT NULL CHECK (term_count >= 1),
  start_date date NOT NULL,

  total_amount numeric(12,2) NOT NULL CHECK (total_amount > 0),
  balance_amount numeric(12,2) NOT NULL CHECK (balance_amount >= 0),

  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paid','late','cancelled')),
  currency_code char(3) NOT NULL DEFAULT 'COP',
  notes text,

  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE installments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL REFERENCES admins(id) ON DELETE RESTRICT,
  credit_id uuid NOT NULL REFERENCES credits(id) ON DELETE CASCADE,

  installment_no int NOT NULL CHECK (installment_no >= 1),
  due_date date NOT NULL,
  amount_due numeric(12,2) NOT NULL CHECK (amount_due > 0),
  amount_paid numeric(12,2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),

  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','late')),
  paid_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL REFERENCES admins(id) ON DELETE RESTRICT,
  credit_id uuid NOT NULL REFERENCES credits(id) ON DELETE RESTRICT,
  installment_id uuid REFERENCES installments(id) ON DELETE SET NULL,
  vendor_id uuid REFERENCES vendors(id) ON DELETE SET NULL,

  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  method text NOT NULL DEFAULT 'cash' CHECK (method IN ('cash','transfer','card','other')),
  paid_at timestamptz NOT NULL DEFAULT now(),
  note text,

  created_at timestamptz NOT NULL DEFAULT now()
);

-- =========================
-- Cash movements
-- =========================

CREATE TABLE vendor_cash_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL REFERENCES admins(id) ON DELETE RESTRICT,
  vendor_id uuid NOT NULL REFERENCES vendors(id) ON DELETE RESTRICT,

  movement_type text NOT NULL CHECK (movement_type IN ('income','expense')),
  category text,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  occurred_at timestamptz NOT NULL DEFAULT now(),

  reference_type text, -- e.g. 'payment'
  reference_id uuid,   -- id of referenced entity
  note text,

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE admin_cash_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL REFERENCES admins(id) ON DELETE RESTRICT,

  movement_type text NOT NULL CHECK (movement_type IN ('income','expense')),
  category text,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  occurred_at timestamptz NOT NULL DEFAULT now(),

  reference_type text,
  reference_id uuid,
  note text,

  created_at timestamptz NOT NULL DEFAULT now()
);

-- =========================
-- Vendor locations
-- =========================

CREATE TABLE vendor_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL REFERENCES admins(id) ON DELETE RESTRICT,
  vendor_id uuid NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,

  lat double precision NOT NULL,
  lng double precision NOT NULL,
  accuracy_m double precision,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'foreground' CHECK (source IN ('foreground','manual','unknown')),

  created_at timestamptz NOT NULL DEFAULT now()
);

-- =========================
-- Audit logs
-- =========================

CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  admin_id uuid REFERENCES admins(id) ON DELETE SET NULL,
  vendor_id uuid REFERENCES vendors(id) ON DELETE SET NULL,

  actor_role text NOT NULL CHECK (actor_role IN ('admin','vendor','system')),
  actor_id uuid, -- admin_id or vendor_id (redundant but handy)

  action text NOT NULL,      -- e.g. 'ADMIN_LOGIN', 'VENDOR_CREATE', 'PAYMENT_CREATE'
  entity_type text,          -- e.g. 'vendor', 'client', 'credit'
  entity_id uuid,

  request_ip inet,
  user_agent text,
  request_id text,

  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMIT;
