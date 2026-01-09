const express = require("express");
const controller = require("./controller");
const schema = require("./schema");
const { validate } = require("../../middlewares/validate");
const { asyncHandler } = require("../../utils/asyncHandler");
const { roleGuard } = require("../../middlewares/roleGuard");

// ✅ Fix anti-crash:
// si por error algún handler no existe, Express revienta al registrar la ruta.
// Esto lo evita y devuelve 500 con un mensaje claro.
function safeHandler(name) {
  const fn = controller?.[name];
  if (typeof fn === "function") return fn;

  return async (req, res) => {
    return res.status(500).json({
      ok: false,
      error: {
        code: "INTERNAL_ERROR",
        message: `Cash controller handler missing: ${name}`
      }
    });
  };
}

const cashRoutes = express.Router();

// Resumen (admin o vendor)
cashRoutes.get(
  "/cash/summary",
  roleGuard("admin", "vendor"),
  validate({ query: schema.cashSummaryQuerySchema }),
  asyncHandler(safeHandler("summary"))
);

// Admin: lista movimientos
cashRoutes.get(
  "/admins/:adminId/cash",
  roleGuard("admin"),
  validate({ query: schema.cashListQuerySchema }),
  asyncHandler(safeHandler("listAdminCash"))
);

// Vendor: lista movimientos
cashRoutes.get(
  "/vendors/:vendorId/cash",
  roleGuard("admin", "vendor"),
  validate({ query: schema.cashListQuerySchema }),
  asyncHandler(safeHandler("listVendorCash"))
);

// Admin: crear movimiento
cashRoutes.post(
  "/admins/:adminId/cash/movements",
  roleGuard("admin"),
  validate({ body: schema.cashMovementCreateSchema }),
  asyncHandler(safeHandler("createAdminCashMovement"))
);

// Vendor: crear movimiento
cashRoutes.post(
  "/vendors/:vendorId/cash/movements",
  roleGuard("admin", "vendor"),
  validate({ body: schema.cashMovementCreateSchema }),
  asyncHandler(safeHandler("createVendorCashMovement"))
);

module.exports = { cashRoutes };


