-- 20260108_000012_vendor_default_permissions.sql
-- Defaults para vendors ya existentes: permitir crear clientes y créditos (si la key no existe).

BEGIN;

-- canCreateClients
UPDATE vendors
SET permissions = jsonb_set(COALESCE(permissions, '{}'::jsonb), '{canCreateClients}', 'true'::jsonb, true)
WHERE NOT (COALESCE(permissions, '{}'::jsonb) ? 'canCreateClients');

-- canCreateCredits
UPDATE vendors
SET permissions = jsonb_set(COALESCE(permissions, '{}'::jsonb), '{canCreateCredits}', 'true'::jsonb, true)
WHERE NOT (COALESCE(permissions, '{}'::jsonb) ? 'canCreateCredits');

COMMIT;
