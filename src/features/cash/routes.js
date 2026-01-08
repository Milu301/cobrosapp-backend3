const express = require("express");
const { asyncHandler } = require("../../utils/asyncHandler");
const { roleGuard } = require("../../middlewares/roleGuard");
const { cashListQuerySchema, cashSummaryQuerySchema, cashMovementCreateSchema } = require("./schema");
const controller = require("./controller");

const cashRoutes = express.Router();

/**
 * Vendor cash
 * GET  /vendors/:vendorId/cash?date=YYYY-MM-DD&limit=50&offset=0
 * POST /vendors/:vendorId/cash/movements
 * GET  /vendors/:vendorId/cash/summary?date=YYYY-MM-DD
 */
cashRoutes.get(
  "/vendors/:vendorId/cash",
  roleGuard("admin", "vendor"),
  asyncHandler(async (req, res) => {
    req.query = cashListQuerySchema.parse(req.query);
    return controller.vendorCashList(req, res);
  })
);

cashRoutes.post(
  "/vendors/:vendorId/cash/movements",
  roleGuard("vendor"),
  asyncHandler(async (req, res) => {
    req.body = cashMovementCreateSchema.parse(req.body);
    return controller.vendorCashCreate(req, res);
  })
);

cashRoutes.get(
  "/vendors/:vendorId/cash/summary",
  roleGuard("admin", "vendor"),
  asyncHandler(async (req, res) => {
    req.query = cashSummaryQuerySchema.parse(req.query);
    return controller.vendorCashSummary(req, res);
  })
);

/**
 * Admin cash
 * GET  /admins/:adminId/cash?date=YYYY-MM-DD&limit=50&offset=0
 * POST /admins/:adminId/cash/movements
 * GET  /admins/:adminId/cash/summary?date=YYYY-MM-DD
 */
cashRoutes.get(
  "/admins/:adminId/cash",
  roleGuard("admin"),
  asyncHandler(async (req, res) => {
    req.query = cashListQuerySchema.parse(req.query);
    return controller.adminCashList(req, res);
  })
);

cashRoutes.post(
  "/admins/:adminId/cash/movements",
  roleGuard("admin"),
  asyncHandler(async (req, res) => {
    req.body = cashMovementCreateSchema.parse(req.body);
    return controller.adminCashCreate(req, res);
  })
);

cashRoutes.get(
  "/admins/:adminId/cash/summary",
  roleGuard("admin"),
  asyncHandler(async (req, res) => {
    req.query = cashSummaryQuerySchema.parse(req.query);
    return controller.adminCashSummary(req, res);
  })
);

module.exports = { cashRoutes };
