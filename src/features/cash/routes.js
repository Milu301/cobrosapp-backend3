const express = require("express");
const controller = require("./controller");
const schema = require("./schema");
const { validate } = require("../../middlewares/validate");
const { asyncHandler } = require("../../utils/asyncHandler");
const { roleGuard } = require("../../middlewares/roleGuard");

function safeHandler(name) {
  const fn = controller?.[name];
  if (typeof fn === "function") return fn;
  return async (req, res) => {
    return res.status(501).json({
      ok: false,
      error: { code: "NOT_IMPLEMENTED", message: "Función no disponible" }
    });
  };
}

const cashRoutes = express.Router();

cashRoutes.get(
  "/cash/summary",
  roleGuard("admin", "vendor"),
  validate({ query: schema.cashSummaryQuerySchema }),
  asyncHandler(safeHandler("summary"))
);

cashRoutes.get(
  "/admins/:adminId/cash/summary",
  roleGuard("admin"),
  validate({ query: schema.cashSummaryQuerySchema }),
  asyncHandler(safeHandler("adminCashSummary"))
);

cashRoutes.get(
  "/vendors/:vendorId/cash/summary",
  roleGuard("admin", "vendor"),
  validate({ query: schema.cashSummaryQuerySchema }),
  asyncHandler(safeHandler("vendorCashSummary"))
);

cashRoutes.get(
  "/admins/:adminId/cash/all",
  roleGuard("admin"),
  validate({ query: schema.cashListQuerySchema }),
  asyncHandler(safeHandler("listAllCash"))
);

cashRoutes.get(
  "/admins/:adminId/cash/all/summary",
  roleGuard("admin"),
  validate({ query: schema.cashSummaryQuerySchema }),
  asyncHandler(safeHandler("allCashSummary"))
);

cashRoutes.get(
  "/admins/:adminId/cash",
  roleGuard("admin"),
  validate({ query: schema.cashListQuerySchema }),
  asyncHandler(safeHandler("listAdminCash"))
);

cashRoutes.get(
  "/vendors/:vendorId/cash",
  roleGuard("admin", "vendor"),
  validate({ query: schema.cashListQuerySchema }),
  asyncHandler(safeHandler("listVendorCash"))
);

cashRoutes.post(
  "/admins/:adminId/cash/movements",
  roleGuard("admin"),
  validate({ body: schema.cashMovementCreateSchema }),
  asyncHandler(safeHandler("createAdminCashMovement"))
);

cashRoutes.post(
  "/vendors/:vendorId/cash/movements",
  roleGuard("admin", "vendor"),
  validate({ body: schema.cashMovementCreateSchema }),
  asyncHandler(safeHandler("createVendorCashMovement"))
);

module.exports = { cashRoutes };
