-- 003_indexes_triggers.sql
-- Indexes + updated_at triggers + tenant integrity triggers.
-- Run after 002_tables.sql

BEGIN;

-- =========================
-- updated_at trigger helper
-- =========================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Apply updated_at triggers
CREATE TRIGGER trg_admins_updated_at
BEFORE UPDATE ON admins
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_vendors_updated_at
BEFORE UPDATE ON vendors
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_clients_updated_at
BEFORE UPDATE ON clients
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_routes_updated_at
BEFORE UPDATE ON routes
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_route_clients_updated_at
BEFORE UPDATE ON route_clients
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_route_assignments_updated_at
BEFORE UPDATE ON route_assignments
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_credits_updated_at
BEFORE UPDATE ON credits
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_installments_updated_at
BEFORE UPDATE ON installments
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =========================
-- Indexes (performance + uniqueness)
-- =========================

-- Vendors email unique only if not soft-deleted
CREATE UNIQUE INDEX idx_vendors_email_unique_active
  ON vendors (email)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_vendors_admin_id ON vendors (admin_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_vendors_status ON vendors (admin_id, status) WHERE deleted_at IS NULL;

-- Clients
CREATE INDEX idx_clients_admin_id ON clients (admin_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_clients_vendor_id ON clients (vendor_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX idx_clients_doc_unique_per_admin_active
  ON clients (admin_id, doc_id)
  WHERE doc_id IS NOT NULL AND deleted_at IS NULL;

-- Routes
CREATE INDEX idx_routes_admin_id ON routes (admin_id) WHERE deleted_at IS NULL;

-- Route clients ordering & uniqueness
CREATE UNIQUE INDEX idx_route_clients_unique_active
  ON route_clients (route_id, client_id)
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX idx_route_clients_order_unique_active
  ON route_clients (route_id, visit_order)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_route_clients_route_id ON route_clients (route_id) WHERE deleted_at IS NULL;

-- Route assignments
CREATE INDEX idx_route_assignments_admin_date
  ON route_assignments (admin_id, assigned_date)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_route_assignments_vendor_date
  ON route_assignments (vendor_id, assigned_date)
  WHERE deleted_at IS NULL;

-- Enforce: one route per vendor per date (helps "ruta del día")
CREATE UNIQUE INDEX idx_route_assignments_vendor_date_unique_active
  ON route_assignments (vendor_id, assigned_date)
  WHERE deleted_at IS NULL AND status <> 'cancelled';

-- Route visits
CREATE INDEX idx_route_visits_assignment ON route_visits (route_assignment_id, visited_at DESC);
CREATE INDEX idx_route_visits_vendor_date ON route_visits (vendor_id, visited_at DESC);

-- Credits
CREATE INDEX idx_credits_admin_id ON credits (admin_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_credits_client_id ON credits (client_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_credits_status ON credits (admin_id, status) WHERE deleted_at IS NULL;

-- Installments
CREATE UNIQUE INDEX idx_installments_credit_no_unique
  ON installments (credit_id, installment_no);

CREATE INDEX idx_installments_admin_due
  ON installments (admin_id, due_date);

CREATE INDEX idx_installments_status_due
  ON installments (admin_id, status, due_date);

-- Payments
CREATE INDEX idx_payments_credit_paid_at
  ON payments (credit_id, paid_at DESC);

CREATE INDEX idx_payments_admin_paid_at
  ON payments (admin_id, paid_at DESC);

-- Cash
CREATE INDEX idx_vendor_cash_vendor_date
  ON vendor_cash_movements (vendor_id, occurred_at DESC);

CREATE INDEX idx_admin_cash_admin_date
  ON admin_cash_movements (admin_id, occurred_at DESC);

-- Locations
CREATE INDEX idx_vendor_locations_vendor_date
  ON vendor_locations (vendor_id, recorded_at DESC);

-- Audit logs
CREATE INDEX idx_audit_logs_created_at ON audit_logs (created_at DESC);
CREATE INDEX idx_audit_logs_admin ON audit_logs (admin_id, created_at DESC);
CREATE INDEX idx_audit_logs_vendor ON audit_logs (vendor_id, created_at DESC);
CREATE INDEX idx_audit_logs_action ON audit_logs (action, created_at DESC);

-- =========================
-- Tenant integrity triggers (guard rails)
-- =========================

-- clients.vendor_id must belong to same admin_id (and be not deleted)
CREATE OR REPLACE FUNCTION trg_clients_vendor_same_admin()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_admin uuid;
BEGIN
  IF NEW.vendor_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT admin_id INTO v_admin
  FROM vendors
  WHERE id = NEW.vendor_id
    AND deleted_at IS NULL;

  IF v_admin IS NULL THEN
    RAISE EXCEPTION 'Vendor not found or deleted'
      USING ERRCODE = '23503';
  END IF;

  IF v_admin <> NEW.admin_id THEN
    RAISE EXCEPTION 'Client.admin_id must match Vendor.admin_id'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_clients_vendor_same_admin
BEFORE INSERT OR UPDATE OF vendor_id, admin_id ON clients
FOR EACH ROW EXECUTE FUNCTION trg_clients_vendor_same_admin();

-- route_clients: route and client must belong to same admin (and be active/not deleted)
CREATE OR REPLACE FUNCTION trg_route_clients_same_admin()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  r_admin uuid;
  c_admin uuid;
BEGIN
  SELECT admin_id INTO r_admin FROM routes WHERE id = NEW.route_id AND deleted_at IS NULL;
  IF r_admin IS NULL THEN
    RAISE EXCEPTION 'Route not found or deleted' USING ERRCODE='23503';
  END IF;

  SELECT admin_id INTO c_admin FROM clients WHERE id = NEW.client_id AND deleted_at IS NULL;
  IF c_admin IS NULL THEN
    RAISE EXCEPTION 'Client not found or deleted' USING ERRCODE='23503';
  END IF;

  IF r_admin <> c_admin THEN
    RAISE EXCEPTION 'Route.admin_id must match Client.admin_id' USING ERRCODE='23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_route_clients_same_admin
BEFORE INSERT OR UPDATE OF route_id, client_id ON route_clients
FOR EACH ROW EXECUTE FUNCTION trg_route_clients_same_admin();

-- route_assignments: route + vendor must match admin_id (and be not deleted)
CREATE OR REPLACE FUNCTION trg_route_assignments_same_admin()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  r_admin uuid;
  v_admin uuid;
BEGIN
  SELECT admin_id INTO r_admin FROM routes WHERE id = NEW.route_id AND deleted_at IS NULL;
  IF r_admin IS NULL THEN
    RAISE EXCEPTION 'Route not found or deleted' USING ERRCODE='23503';
  END IF;

  SELECT admin_id INTO v_admin FROM vendors WHERE id = NEW.vendor_id AND deleted_at IS NULL;
  IF v_admin IS NULL THEN
    RAISE EXCEPTION 'Vendor not found or deleted' USING ERRCODE='23503';
  END IF;

  IF NEW.admin_id <> r_admin OR NEW.admin_id <> v_admin THEN
    RAISE EXCEPTION 'Assignment.admin_id must match Route/Vendor admin_id' USING ERRCODE='23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_route_assignments_same_admin
BEFORE INSERT OR UPDATE OF admin_id, route_id, vendor_id ON route_assignments
FOR EACH ROW EXECUTE FUNCTION trg_route_assignments_same_admin();

-- route_visits: assignment, client, vendor must match admin_id
CREATE OR REPLACE FUNCTION trg_route_visits_same_admin()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  a_admin uuid;
  c_admin uuid;
  v_admin uuid;
BEGIN
  SELECT admin_id INTO a_admin
  FROM route_assignments
  WHERE id = NEW.route_assignment_id
    AND deleted_at IS NULL;

  IF a_admin IS NULL THEN
    RAISE EXCEPTION 'Route assignment not found or deleted' USING ERRCODE='23503';
  END IF;

  SELECT admin_id INTO c_admin FROM clients WHERE id = NEW.client_id AND deleted_at IS NULL;
  IF c_admin IS NULL THEN
    RAISE EXCEPTION 'Client not found or deleted' USING ERRCODE='23503';
  END IF;

  SELECT admin_id INTO v_admin FROM vendors WHERE id = NEW.vendor_id AND deleted_at IS NULL;
  IF v_admin IS NULL THEN
    RAISE EXCEPTION 'Vendor not found or deleted' USING ERRCODE='23503';
  END IF;

  IF NEW.admin_id <> a_admin OR NEW.admin_id <> c_admin OR NEW.admin_id <> v_admin THEN
    RAISE EXCEPTION 'Visit.admin_id must match Assignment/Client/Vendor admin_id' USING ERRCODE='23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_route_visits_same_admin
BEFORE INSERT OR UPDATE OF admin_id, route_assignment_id, client_id, vendor_id ON route_visits
FOR EACH ROW EXECUTE FUNCTION trg_route_visits_same_admin();

-- credits: client + vendor must match admin_id
CREATE OR REPLACE FUNCTION trg_credits_same_admin()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  c_admin uuid;
  v_admin uuid;
BEGIN
  SELECT admin_id INTO c_admin FROM clients WHERE id = NEW.client_id AND deleted_at IS NULL;
  IF c_admin IS NULL THEN
    RAISE EXCEPTION 'Client not found or deleted' USING ERRCODE='23503';
  END IF;

  IF NEW.admin_id <> c_admin THEN
    RAISE EXCEPTION 'Credit.admin_id must match Client.admin_id' USING ERRCODE='23514';
  END IF;

  IF NEW.vendor_id IS NOT NULL THEN
    SELECT admin_id INTO v_admin FROM vendors WHERE id = NEW.vendor_id AND deleted_at IS NULL;
    IF v_admin IS NULL THEN
      RAISE EXCEPTION 'Vendor not found or deleted' USING ERRCODE='23503';
    END IF;
    IF NEW.admin_id <> v_admin THEN
      RAISE EXCEPTION 'Credit.admin_id must match Vendor.admin_id' USING ERRCODE='23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_credits_same_admin
BEFORE INSERT OR UPDATE OF admin_id, client_id, vendor_id ON credits
FOR EACH ROW EXECUTE FUNCTION trg_credits_same_admin();

-- installments: admin_id must match credit.admin_id
CREATE OR REPLACE FUNCTION trg_installments_same_admin()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  cr_admin uuid;
BEGIN
  SELECT admin_id INTO cr_admin FROM credits WHERE id = NEW.credit_id AND deleted_at IS NULL;
  IF cr_admin IS NULL THEN
    RAISE EXCEPTION 'Credit not found or deleted' USING ERRCODE='23503';
  END IF;

  IF NEW.admin_id <> cr_admin THEN
    RAISE EXCEPTION 'Installment.admin_id must match Credit.admin_id' USING ERRCODE='23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_installments_same_admin
BEFORE INSERT OR UPDATE OF admin_id, credit_id ON installments
FOR EACH ROW EXECUTE FUNCTION trg_installments_same_admin();

-- payments: admin_id must match credit.admin_id, and installment must belong to credit if provided
CREATE OR REPLACE FUNCTION trg_payments_integrity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  cr_admin uuid;
  inst_credit uuid;
BEGIN
  SELECT admin_id INTO cr_admin FROM credits WHERE id = NEW.credit_id AND deleted_at IS NULL;
  IF cr_admin IS NULL THEN
    RAISE EXCEPTION 'Credit not found or deleted' USING ERRCODE='23503';
  END IF;

  IF NEW.admin_id <> cr_admin THEN
    RAISE EXCEPTION 'Payment.admin_id must match Credit.admin_id' USING ERRCODE='23514';
  END IF;

  IF NEW.installment_id IS NOT NULL THEN
    SELECT credit_id INTO inst_credit FROM installments WHERE id = NEW.installment_id;
    IF inst_credit IS NULL THEN
      RAISE EXCEPTION 'Installment not found' USING ERRCODE='23503';
    END IF;
    IF inst_credit <> NEW.credit_id THEN
      RAISE EXCEPTION 'Payment.installment_id must belong to the same credit' USING ERRCODE='23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_payments_integrity
BEFORE INSERT OR UPDATE OF admin_id, credit_id, installment_id ON payments
FOR EACH ROW EXECUTE FUNCTION trg_payments_integrity();

-- vendor cash movements: admin_id must match vendor.admin_id
CREATE OR REPLACE FUNCTION trg_vendor_cash_same_admin()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_admin uuid;
BEGIN
  SELECT admin_id INTO v_admin FROM vendors WHERE id = NEW.vendor_id AND deleted_at IS NULL;
  IF v_admin IS NULL THEN
    RAISE EXCEPTION 'Vendor not found or deleted' USING ERRCODE='23503';
  END IF;
  IF NEW.admin_id <> v_admin THEN
    RAISE EXCEPTION 'VendorCash.admin_id must match Vendor.admin_id' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_vendor_cash_same_admin
BEFORE INSERT OR UPDATE OF admin_id, vendor_id ON vendor_cash_movements
FOR EACH ROW EXECUTE FUNCTION trg_vendor_cash_same_admin();

-- vendor locations: admin_id must match vendor.admin_id
CREATE OR REPLACE FUNCTION trg_vendor_locations_same_admin()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_admin uuid;
BEGIN
  SELECT admin_id INTO v_admin FROM vendors WHERE id = NEW.vendor_id AND deleted_at IS NULL;
  IF v_admin IS NULL THEN
    RAISE EXCEPTION 'Vendor not found or deleted' USING ERRCODE='23503';
  END IF;
  IF NEW.admin_id <> v_admin THEN
    RAISE EXCEPTION 'VendorLocation.admin_id must match Vendor.admin_id' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_vendor_locations_same_admin
BEFORE INSERT OR UPDATE OF admin_id, vendor_id ON vendor_locations
FOR EACH ROW EXECUTE FUNCTION trg_vendor_locations_same_admin();

COMMIT;
