const express = require("express");
const { asyncHandler } = require("../../utils/asyncHandler");
const { roleGuard } = require("../../middlewares/roleGuard");
const {
  collectionsQuerySchema,
  lateClientsQuerySchema,
  vendorPerformanceQuerySchema,
} = require("./schema");
const controller = require("./controller");

const reportRoutes = express.Router();

reportRoutes.get(
  "/admins/:adminId/reports/collections",
  roleGuard("admin"),
  asyncHandler(async (req, res) => {
    req.query = collectionsQuerySchema.parse(req.query);
    return controller.collections(req, res);
  })
);

reportRoutes.get(
  "/admins/:adminId/reports/collections.csv",
  roleGuard("admin"),
  asyncHandler(async (req, res) => {
    req.query = collectionsQuerySchema.parse(req.query);
    return controller.collectionsCsv(req, res);
  })
);

reportRoutes.get(
  "/admins/:adminId/reports/late-clients",
  roleGuard("admin"),
  asyncHandler(async (req, res) => {
    req.query = lateClientsQuerySchema.parse(req.query);
    return controller.lateClients(req, res);
  })
);

reportRoutes.get(
  "/admins/:adminId/reports/vendor-performance",
  roleGuard("admin"),
  asyncHandler(async (req, res) => {
    req.query = vendorPerformanceQuerySchema.parse(req.query);
    return controller.vendorPerformance(req, res);
  })
);

module.exports = { reportRoutes };
