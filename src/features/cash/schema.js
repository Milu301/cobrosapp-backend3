const { z } = require("zod");

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

const cashListQuerySchema = z.object({
  date: z.string().regex(dateRegex, "Formato inválido (YYYY-MM-DD)"),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0)
});

const cashSummaryQuerySchema = z.object({
  date: z.string().regex(dateRegex, "Formato inválido (YYYY-MM-DD)")
});

const cashMovementCreateSchema = z.object({
  movement_type: z.enum(["income", "expense"]),
  category: z.string().trim().max(80).optional().nullable(),
  amount: z.coerce.number().positive().max(999999999),
  occurred_at: z.string().datetime({ offset: true }).optional(),
  reference_type: z.string().trim().max(50).optional().nullable(),
  reference_id: z.string().uuid().optional().nullable(),
  note: z.string().trim().max(1000).optional().nullable()
});

module.exports = {
  cashListQuerySchema,
  cashSummaryQuerySchema,
  cashMovementCreateSchema
};
