const express = require("express");
const controller = require("./controller");
const { asyncHandler } = require("../../utils/asyncHandler");
const { roleGuard } = require("../../middlewares/roleGuard");

const cashRoutes = express.Router();

// Ya está protegido por protectedRouter (auth + subscriptionGuard)
// Aquí además controlamos roles de forma explícita.

// --------------------
// Admin
// --------------------
cashRoutes.get(
  "/admins/:adminId/cash/summary",
  roleGuard("admin"),
  asyncHandler(controller.adminCashSummary)
);

cashRoutes.get(
  "/admins/:adminId/cash",
  roleGuard("admin"),
  asyncHandler(controller.adminCashList)
);

// endpoint “nuevo”
cashRoutes.post(
  "/admins/:adminId/cash/movements",
  roleGuard("admin"),
  asyncHandler(controller.adminCashCreate)
);

// ✅ Alias para compatibilidad con Flutter (tu app usa POST /admins/:adminId/cash)
cashRoutes.post(
  "/admins/:adminId/cash",
  roleGuard("admin"),
  asyncHandler(controller.adminCashCreate)
);

// --------------------
// Vendor
// --------------------
cashRoutes.get(
  "/vendors/:vendorId/cash/summary",
  roleGuard("admin", "vendor"),
  asyncHandler(controller.vendorCashSummary)
);

cashRoutes.get(
  "/vendors/:vendorId/cash",
  roleGuard("admin", "vendor"),
  asyncHandler(controller.vendorCashList)
);

cashRoutes.post(
  "/vendors/:vendorId/cash/movements",
  roleGuard("vendor"),
  asyncHandler(controller.vendorCashCreate)
);

module.exports = { cashRoutes };
