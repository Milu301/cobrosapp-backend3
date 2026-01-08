-- 20251215_000009_fix_credits_balance_amount.sql
-- Fix: credits.balance_amount NOT NULL. Mantener balance_amount <-> balance sincronizados.

-- Asegurar columnas
ALTER TABLE credits ADD COLUMN IF NOT EXISTS balance numeric(12,2);
ALTER TABLE credits ADD COLUMN IF NOT EXISTS balance_amount numeric(12,2);

-- Rellenar datos existentes
UPDATE credits
SET balance_amount = balance
WHERE balance_amount IS NULL AND balance IS NOT NULL;

UPDATE credits
SET balance = balance_amount
WHERE balance IS NULL AND balance_amount IS NOT NULL;

-- Si aún quedan nulls, mínimo seguro (por si hay registros viejos incompletos)
UPDATE credits
SET balance = COALESCE(balance, 0),
    balance_amount = COALESCE(balance_amount, COALESCE(balance, 0))
WHERE balance IS NULL OR balance_amount IS NULL;

-- Default defensivo
ALTER TABLE credits ALTER COLUMN balance SET DEFAULT 0;
ALTER TABLE credits ALTER COLUMN balance_amount SET DEFAULT 0;

-- Trigger sync
CREATE OR REPLACE FUNCTION trg_credits_sync_balance_amount()
RETURNS trigger AS $$
BEGIN
  -- Si viene balance pero balance_amount no, copiar
  IF NEW.balance_amount IS NULL AND NEW.balance IS NOT NULL THEN
    NEW.balance_amount := NEW.balance;
  END IF;

  -- Si viene balance_amount pero balance no, copiar
  IF NEW.balance IS NULL AND NEW.balance_amount IS NOT NULL THEN
    NEW.balance := NEW.balance_amount;
  END IF;

  -- Si ambos nulos, asegurar 0
  IF NEW.balance IS NULL THEN
    NEW.balance := 0;
  END IF;
  IF NEW.balance_amount IS NULL THEN
    NEW.balance_amount := NEW.balance;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS credits_sync_balance_amount ON credits;

CREATE TRIGGER credits_sync_balance_amount
BEFORE INSERT OR UPDATE ON credits
FOR EACH ROW
EXECUTE FUNCTION trg_credits_sync_balance_amount();
