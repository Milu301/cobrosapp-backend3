-- 20251215_000007_vendor_locations.sql
-- Safe migration: vendor_locations para tracking GPS

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS vendor_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL REFERENCES admins(id),
  vendor_id uuid NOT NULL REFERENCES vendors(id),

  lat double precision NOT NULL,
  lng double precision NOT NULL,

  accuracy_m double precision NULL,
  speed_mps double precision NULL,
  heading_deg double precision NULL,
  altitude_m double precision NULL,

  battery_level int NULL,
  is_mock boolean NOT NULL DEFAULT false,
  source text NULL DEFAULT 'foreground',

  recorded_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE vendor_locations ADD COLUMN IF NOT EXISTS admin_id uuid;
ALTER TABLE vendor_locations ADD COLUMN IF NOT EXISTS vendor_id uuid;

ALTER TABLE vendor_locations ADD COLUMN IF NOT EXISTS lat double precision;
ALTER TABLE vendor_locations ADD COLUMN IF NOT EXISTS lng double precision;

ALTER TABLE vendor_locations ADD COLUMN IF NOT EXISTS accuracy_m double precision;
ALTER TABLE vendor_locations ADD COLUMN IF NOT EXISTS speed_mps double precision;
ALTER TABLE vendor_locations ADD COLUMN IF NOT EXISTS heading_deg double precision;
ALTER TABLE vendor_locations ADD COLUMN IF NOT EXISTS altitude_m double precision;

ALTER TABLE vendor_locations ADD COLUMN IF NOT EXISTS battery_level int;
ALTER TABLE vendor_locations ADD COLUMN IF NOT EXISTS is_mock boolean;
ALTER TABLE vendor_locations ADD COLUMN IF NOT EXISTS source text;

ALTER TABLE vendor_locations ADD COLUMN IF NOT EXISTS recorded_at timestamptz;
ALTER TABLE vendor_locations ADD COLUMN IF NOT EXISTS created_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_vendor_locations_admin_vendor_time
  ON vendor_locations(admin_id, vendor_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_vendor_locations_vendor_time
  ON vendor_locations(vendor_id, recorded_at DESC);
