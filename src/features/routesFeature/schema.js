const { z } = require("zod");

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

const routeCreateSchema = z.object({
  name: z.string().min(2).max(200),
  description: z.string().max(1000).optional().nullable(),
  status: z.enum(["active", "inactive"]).optional().default("active")
});

const routeUpdateSchema = z.object({
  name: z.string().min(2).max(200).optional(),
  description: z.string().max(1000).optional().nullable(),
  status: z.enum(["active", "inactive"]).optional()
});

const routeListQuerySchema = z.object({
  q: z.string().max(200).optional(),
  status: z.enum(["active", "inactive"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0)
});

const routeClientsSetSchema = z.object({
  clients: z
    .array(
      z.object({
        client_id: z.string().uuid(),
        visit_order: z.coerce.number().int().min(1).optional()
      })
    )
    .min(0)
});

const routeClientsReorderSchema = z.object({
  items: z
    .array(
      z.object({
        client_id: z.string().uuid(),
        visit_order: z.coerce.number().int().min(1)
      })
    )
    .min(1)
});

const routeAssignSchema = z.object({
  vendor_id: z.string().uuid(),
  assigned_date: z.string().regex(dateRegex, "Formato inválido (YYYY-MM-DD)"),
  status: z.enum(["assigned", "completed", "cancelled"]).optional().default("assigned"),
  notes: z.string().max(1000).optional().nullable()
});

const routeDayQuerySchema = z.object({
  date: z.string().regex(dateRegex, "Formato inválido (YYYY-MM-DD)").optional()
});

const routeVisitCreateSchema = z.object({
  route_assignment_id: z.string().uuid().optional().nullable(),
  client_id: z.string().uuid(),
  visited: z.coerce.boolean(),
  note: z.string().max(1000).optional().nullable(),
  visited_at: z.string().datetime({ offset: true }).optional()
});

module.exports = {
  routeCreateSchema,
  routeUpdateSchema,
  routeListQuerySchema,
  routeClientsSetSchema,
  routeClientsReorderSchema,
  routeAssignSchema,
  routeDayQuerySchema,
  routeVisitCreateSchema
};
