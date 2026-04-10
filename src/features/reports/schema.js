const { z } = require("zod");

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

// Accepts YYYY-MM-DD string, empty string (→ undefined), or missing
const optDate = z.preprocess(
  (v) => (v === "" ? undefined : v),
  z.string().regex(dateRegex, "Formato inválido (YYYY-MM-DD)").optional()
);

const collectionsQuerySchema = z.object({
  date:       optDate,
  start_date: optDate,
  end_date:   optDate,
});

const lateClientsQuerySchema = z.object({
  date:   optDate,
  limit:  z.coerce.number().int().min(1).max(200).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

const vendorPerformanceQuerySchema = z.object({
  date:       optDate,
  start_date: optDate,
  end_date:   optDate,
});

// Legacy aliases (kept for any other callers)
const dateQuerySchema = vendorPerformanceQuerySchema;
const dateQueryWithPagingSchema = lateClientsQuerySchema;

module.exports = {
  dateQuerySchema,
  dateQueryWithPagingSchema,
  collectionsQuerySchema,
  lateClientsQuerySchema,
  vendorPerformanceQuerySchema,
};
