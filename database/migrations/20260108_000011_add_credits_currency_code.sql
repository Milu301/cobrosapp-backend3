-- 20260108_000011_add_credits_currency_code.sql
-- Permite elegir divisa al crear créditos.

BEGIN;

ALTER TABLE credits
  ADD COLUMN IF NOT EXISTS currency_code char(3) NOT NULL DEFAULT 'COP';

-- Normalizar datos viejos (por si existía NULL o vacío)
UPDATE credits
SET currency_code = 'COP'
WHERE currency_code IS NULL OR currency_code = '   ';

COMMIT;
