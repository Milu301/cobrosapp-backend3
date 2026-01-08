const express = require("express");
const { asyncHandler } = require("../../utils/asyncHandler");
const { roleGuard } = require("../../middlewares/roleGuard");
const { dateQuerySchema, dateQueryWithPagingSchema } = require("./schema");
const controller = require("./controller");

const reportRoutes = express.Router();

/**
 * Admin reports
 * GET /admins/:adminId/reports/collections?date=YYYY-MM-DD
 * GET /admins/:adminId/reports/collections.csv?date=YYYY-MM-DD
 * GET /admins/:adminId/reports/late-clients?date=YYYY-MM-DD&limit=50&offset=0
 * GET /admins/:adminId/reports/vendor-performance?date=YYYY-MM-DD
 */
reportRoutes.get(
  "/admins/:adminId/reports/collections",
  roleGuard("admin"),
  asyncHandler(async (req, res) => {
    req.query = dateQuerySchema.parse(req.query);
    return controller.collections(req, res);
  })
);

reportRoutes.get(
  "/admins/:adminId/reports/collections.csv",
  roleGuard("admin"),
  asyncHandler(async (req, res) => {
    req.query = dateQuerySchema.parse(req.query);
    return controller.collectionsCsv(req, res);
  })
);

reportRoutes.get(
  "/admins/:adminId/reports/late-clients",
  roleGuard("admin"),
  asyncHandler(async (req, res) => {
    req.query = dateQueryWithPagingSchema.parse(req.query);
    return controller.lateClients(req, res);
  })
);

reportRoutes.get(
  "/admins/:adminId/reports/vendor-performance",
  roleGuard("admin"),
  asyncHandler(async (req, res) => {
    req.query = dateQuerySchema.parse(req.query);
    return controller.vendorPerformance(req, res);
  })
);

module.exports = { reportRoutes };
