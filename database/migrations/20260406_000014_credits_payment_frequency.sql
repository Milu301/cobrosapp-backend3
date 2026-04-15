-- 20260406_000014_credits_payment_frequency.sql
-- Add payment_frequency column to credits table

ALTER TABLE credits ADD COLUMN IF NOT EXISTS payment_frequency text NOT NULL DEFAULT 'daily';
