const express = require("express");
const controller = require("./controller");

const cashRoutes = express.Router();

// Ya está protegido por protectedRouter (auth + subscriptionGuard)

// Admin
cashRoutes.get("/admins/:adminId/cash/summary", controller.adminCashSummary);
cashRoutes.get("/admins/:adminId/cash", controller.adminCashList);
cashRoutes.post("/admins/:adminId/cash/movements", controller.adminCashCreate);

// ✅ Alias para compatibilidad con Flutter (tu app usa POST /admins/:adminId/cash)
cashRoutes.post("/admins/:adminId/cash", controller.adminCashCreate);

// Vendor
cashRoutes.get("/vendors/:vendorId/cash/summary", controller.vendorCashSummary);
cashRoutes.get("/vendors/:vendorId/cash", controller.vendorCashList);
cashRoutes.post("/vendors/:vendorId/cash/movements", controller.vendorCashCreate);
cashRoutes.post(
  "/admins/:adminId/cash",
  roleGuard("admin"),
  asyncHandler(async (req, res) => controller.adminCashCreate(req, res))
);

module.exports = { cashRoutes };
