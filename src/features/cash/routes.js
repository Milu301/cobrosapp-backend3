const express = require("express");
const controller = require("./controller");
const { requireAuth } = require("../../middlewares/requireAuth");
const { subscriptionGuard } = require("../../middlewares/subscriptionGuard");

const cashRoutes = express.Router();

cashRoutes.use(requireAuth);
cashRoutes.use(subscriptionGuard);

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

module.exports = { cashRoutes };
