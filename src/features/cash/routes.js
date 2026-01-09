const express = require("express");
const controller = require("./controller");
const { auth } = require("../../middlewares/auth");

// ✅ FIX: imports faltantes (esto era lo que crasheaba)
const { roleGuard } = require("../../middlewares/roleGuard");
const { asyncHandler } = require("../../utils/asyncHandler");

const cashRoutes = express.Router();

// Admin cash summary
cashRoutes.get("/admins/:adminId/cash", auth, controller.adminCashSummary);
cashRoutes.get("/admins/:adminId/cash/movements", auth, controller.adminCashMovements);
cashRoutes.post("/admins/:adminId/cash/movements", auth, controller.adminCashCreate);

// Vendor cash summary
cashRoutes.get("/vendors/:vendorId/cash", auth, controller.vendorCashSummary);
cashRoutes.get("/vendors/:vendorId/cash/movements", auth, controller.vendorCashMovements);
cashRoutes.post("/vendors/:vendorId/cash/movements", auth, controller.vendorCashCreate);

// ✅ Alias legacy: /admins/:adminId/cash (no lo quitamos)
cashRoutes.post("/admins/:adminId/cash", auth, controller.adminCashCreate);

// ✅ (si quieres mantener el guard explícito, ahora sí funciona)
// OJO: roleGuard recibe roles como argumentos, NO array.
cashRoutes.post(
  "/admins/:adminId/cash",
  auth,
  roleGuard("admin"),
  asyncHandler(controller.adminCashCreate)
);

module.exports = cashRoutes;
