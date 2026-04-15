const { z } = require("zod");

const phoneRegex = /^[+\d][\d\s\-().]{0,48}$/;
const docIdRegex = /^[A-Za-z0-9\-_.]{1,80}$/;

const clientCreateAdminSchema = z.object({
  name: z.string().trim().min(2).max(200),
  phone: z
    .string()
    .trim()
    .regex(phoneRegex, "Teléfono inválido")
    .max(50)
    .optional()
    .nullable(),
  doc_id: z
    .string()
    .trim()
    .regex(docIdRegex, "Documento inválido")
    .optional()
    .nullable(),
  address: z.string().trim().max(300).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
  status: z.enum(["active", "inactive"]).optional().default("active"),
  vendor_id: z.string().uuid().optional().nullable()
});

const clientCreateVendorSchema = clientCreateAdminSchema.omit({ vendor_id: true });

const clientUpdateSchema = z.object({
  name: z.string().trim().min(2).max(200).optional(),
  phone: z
    .string()
    .trim()
    .regex(phoneRegex, "Teléfono inválido")
    .max(50)
    .optional()
    .nullable(),
  doc_id: z
    .string()
    .trim()
    .regex(docIdRegex, "Documento inválido")
    .optional()
    .nullable(),
  address: z.string().trim().max(300).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
  status: z.enum(["active", "inactive"]).optional(),
  vendor_id: z.string().uuid().optional().nullable()
});

const clientListQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
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
