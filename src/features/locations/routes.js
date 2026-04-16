const express = require("express");
const { asyncHandler } = require("../../utils/asyncHandler");
const { roleGuard } = require("../../middlewares/roleGuard");
const { locationPostSchema, historyQuerySchema } = require("./schema");
const controller = require("./controller");

const locationRoutes = express.Router();

/**
 * Vendor sends location
 * POST /vendors/:vendorId/location
 */
locationRoutes.post(
  "/vendors/:vendorId/location",
  roleGuard("vendor"),
  asyncHandler(async (req, res) => {
    req.body = locationPostSchema.parse(req.body);
    return controller.postLocation(req, res);
  })
);

/**
 * Admin reads ALL vendors latest locations
 * GET /admins/:adminId/vendors/locations/latest
 */
locationRoutes.get(
  "/admins/:adminId/vendors/locations/latest",
  roleGuard("admin"),
  asyncHandler(controller.allLatest)
);

/**
 * Admin reads vendor location
 * GET /admins/:adminId/vendors/:vendorId/location/latest
 * GET /admins/:adminId/vendors/:vendorId/location/history?date=YYYY-MM-DD&limit=500&offset=0
 */
locationRoutes.get(
  "/admins/:adminId/vendors/:vendorId/location/latest",
  roleGuard("admin"),
  asyncHandler(controller.latest)
);

locationRoutes.get(
  "/admins/:adminId/vendors/:vendorId/location/history",
  roleGuard("admin"),
  asyncHandler(async (req, res) => {
    req.query = historyQuerySchema.parse(req.query);
    return controller.history(req, res);
  })
);

module.exports = { locationRoutes };
