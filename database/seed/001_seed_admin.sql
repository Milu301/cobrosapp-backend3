-- 001_seed_admin.sql
-- Seed: initial admin user.
-- IMPORTANT: Change email/password after first login.

-- Default credentials (for dev only):
--   Email: admin@demo.local
--   Password: Admin123!
-- This is a bcrypt hash with cost=12 for "Admin123!".
-- You can replace password_hash with a new bcrypt hash later.

INSERT INTO admins (email, password_hash, full_name, phone, subscription_expires_at, status)
VALUES (
  'admin@demo.local',
  '$2b$12$0SxnnQYFpehI5Ju2Qc2oCOdSA.HnPfMDt9L.FCZPRaKsTgNU4WYw6',
  'Admin Demo',
  NULL,
  now() + interval '30 days',
  'active'
)
ON CONFLICT (email) DO NOTHING;
