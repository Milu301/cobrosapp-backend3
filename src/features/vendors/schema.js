const { z } = require("zod");

const vendorCreateSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(6).max(200),
  name: z.string().min(2).max(200),
  phone: z.string().max(50).optional().nullable(),
  status: z.enum(["active", "inactive"]).optional().default("active"),
  permissions: z.record(z.any()).optional().default({})
});

const vendorUpdateSchema = z.object({
  email: z.string().email().max(200).optional(),
  password: z.string().min(6).max(200).optional(),
  name: z.string().min(2).max(200).optional(),
  phone: z.string().max(50).optional().nullable(),
  status: z.enum(["active", "inactive"]).optional(),
  permissions: z.record(z.any()).optional()
});

const vendorListQuerySchema = z.object({
  q: z.string().max(200).optional(),
  status: z.enum(["active", "inactive"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0)
});

module.exports = { vendorCreateSchema, vendorUpdateSchema, vendorListQuerySchema };
