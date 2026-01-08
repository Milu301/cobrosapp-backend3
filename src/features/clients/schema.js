const { z } = require("zod");

const clientCreateAdminSchema = z.object({
  name: z.string().min(2).max(200),
  phone: z.string().max(50).optional().nullable(),
  doc_id: z.string().max(80).optional().nullable(),
  address: z.string().max(300).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
  status: z.enum(["active", "inactive"]).optional().default("active"),
  vendor_id: z.string().uuid().optional().nullable()
});

// Vendor crea clientes (no permite elegir vendor_id)
const clientCreateVendorSchema = clientCreateAdminSchema.omit({ vendor_id: true });

const clientUpdateSchema = z.object({
  name: z.string().min(2).max(200).optional(),
  phone: z.string().max(50).optional().nullable(),
  doc_id: z.string().max(80).optional().nullable(),
  address: z.string().max(300).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
  status: z.enum(["active", "inactive"]).optional(),
  vendor_id: z.string().uuid().optional().nullable()
});

const clientListQuerySchema = z.object({
  q: z.string().max(200).optional(),
  status: z.enum(["active", "inactive"]).optional(),
  vendor_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0)
});

module.exports = {
  clientCreateAdminSchema,
  clientCreateVendorSchema,
  clientUpdateSchema,
  clientListQuerySchema
};
