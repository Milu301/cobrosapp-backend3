const { z } = require("zod");

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

const dateQuerySchema = z.object({
  date: z.string().regex(dateRegex, "Formato inválido (YYYY-MM-DD)"),
});

const dateQueryWithPagingSchema = z.object({
  date: z.string().regex(dateRegex, "Formato inválido (YYYY-MM-DD)"),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

module.exports = { dateQuerySchema, dateQueryWithPagingSchema };
