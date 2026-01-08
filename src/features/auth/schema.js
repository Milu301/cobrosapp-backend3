const { z } = require("zod");

const loginAdminSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(6).max(200)
});

// Vendor login binds the device on the first login.
// We keep deviceId optional to avoid breaking any legacy tooling/scripts.
const loginVendorSchema = loginAdminSchema.extend({
  deviceId: z.string().min(6).max(200).optional()
});

module.exports = { loginAdminSchema, loginVendorSchema };
