-- 20251215_000008_fix_credits_term_count.sql
-- Fix: credits.term_count NOT NULL en tu DB. Mantener term_count <-> installments_count sincronizados.

-- Asegurar columnas
ALTER TABLE credits ADD COLUMN IF NOT EXISTS installments_count int;
ALTER TABLE credits ADD COLUMN IF NOT EXISTS term_count int;

-- Rellenar datos si existen registros viejos
UPDATE credits
SET installments_count = term_count
WHERE installments_count IS NULL AND term_count IS NOT NULL;

UPDATE credits
SET term_count = installments_count
WHERE term_count IS NULL AND installments_count IS NOT NULL;

-- Si aún quedan nulls, pon un valor mínimo seguro
UPDATE credits
SET installments_count = COALESCE(installments_count, 1),
    term_count = COALESCE(term_count, 1)
WHERE installments_count IS NULL OR term_count IS NULL;

-- Hacer que term_count quede consistente (si ya existe NOT NULL, esto no lo rompe)
ALTER TABLE credits ALTER COLUMN term_count SET DEFAULT 1;

-- Trigger para mantener sincronía
CREATE OR REPLACE FUNCTION trg_credits_sync_term_count()
RETURNS trigger AS $$
BEGIN
  -- Si viene installments_count pero term_count no, copiar
  IF NEW.term_count IS NULL AND NEW.installments_count IS NOT NULL THEN
    NEW.term_count := NEW.installments_count;
  END IF;

  -- Si viene term_count pero installments_count no, copiar
  IF NEW.installments_count IS NULL AND NEW.term_count IS NOT NULL THEN
    NEW.installments_count := NEW.term_count;
  END IF;

  -- Si ambos siguen NULL, asegurar mínimo
  IF NEW.term_count IS NULL THEN
    NEW.term_count := 1;
  END IF;
  IF NEW.installments_count IS NULL THEN
    NEW.installments_count := NEW.term_count;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS credits_sync_term_count ON credits;

CREATE TRIGGER credits_sync_term_count
BEFORE INSERT OR UPDATE ON credits
FOR EACH ROW 
EXECUTE FUNCTION trg_credits_sync_term_count();
