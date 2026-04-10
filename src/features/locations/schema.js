const { z } = require("zod");

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

const locationPostSchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),

  accuracy_m: z.coerce.number().positive().max(100000).optional().nullable(),
  speed_mps: z.coerce.number().min(0).max(200).optional().nullable(),
  heading_deg: z.coerce.number().min(0).max(360).optional().nullable(),
  altitude_m: z.coerce.number().min(-500).max(20000).optional().nullable(),

  battery_level: z.coerce.number().int().min(0).max(100).optional().nullable(),
  is_mock: z.coerce.boolean().optional().default(false),
  source: z.string().max(30).optional().default("foreground"),

  recorded_at: z.string().datetime({ offset: true }).optional()
});

const historyQuerySchema = z.object({
  date: z.string().regex(dateRegex, "Formato inválido (YYYY-MM-DD)"),
  limit: z.coerce.number().int().min(1).max(2000).optional().default(500),
  offset: z.coerce.number().int().min(0).optional().default(0)
});

module.exports = { locationPostSchema, historyQuerySchema };
