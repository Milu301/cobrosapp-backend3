const { z } = require("zod");

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

const createCreditSchema = z.object({
  principal_amount: z.coerce.number().positive().max(999999999),
  interest_rate: z.coerce.number().min(0).max(999).optional().default(0),
  installments_count: z.coerce.number().int().min(1).max(3650),
  start_date: z.string().regex(dateRegex, "Formato inválido (YYYY-MM-DD)"),
  notes: z.string().max(1000).optional().nullable(),

  // ✅ NUEVO: divisa (acepta cualquier ISO 4217 de 3 letras, ej: COP, USD, MXN)
  currency_code: z
    .string()
    .regex(/^[A-Za-z]{3}$/, "Código de divisa inválido (ISO 4217)")
    .optional()
    .default("COP")
    .transform((s) => String(s).toUpperCase()),

  // opcional: si admin quiere asignar el crédito a un vendor específico
  vendor_id: z.string().uuid().optional().nullable()
});

const createPaymentSchema = z.object({
  amount: z.coerce.number().positive().max(999999999),
  method: z.enum(["cash", "transfer", "card", "other"]).optional().default("cash"),
  note: z.string().max(1000).optional().nullable(),
  paid_at: z.string().datetime().optional() // ISO opcional
});

module.exports = { createCreditSchema, createPaymentSchema };
