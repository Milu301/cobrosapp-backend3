const express = require("express");
const { asyncHandler } = require("../../utils/asyncHandler");
const { roleGuard } = require("../../middlewares/roleGuard");
const { vendorCreateSchema, vendorUpdateSchema, vendorListQuerySchema } = require("./schema");
const controller = require("./controller");

const vendorRoutes = express.Router();

// Admin: list/create
vendorRoutes.get(
  "/admins/:adminId/vendors",
  roleGuard("admin"),
  asyncHandler(async (req, res) => {
    req.query = vendorListQuerySchema.parse(req.query);
    return controller.list(req, res);
  })
);

vendorRoutes.post(
  "/admins/:adminId/vendors",
  roleGuard("admin"),
  asyncHandler(async (req, res) => {
    req.body = vendorCreateSchema.parse(req.body);
    return controller.create(req, res);
  })
);

// Get vendor (admin owner OR vendor self)
vendorRoutes.get(
  "/vendors/:vendorId",
  roleGuard("admin", "vendor"),
  asyncHandler(controller.getOne)
);

// Admin: update/delete vendor
vendorRoutes.put(
  "/vendors/:vendorId",
  roleGuard("admin"),
  asyncHandler(async (req, res) => {
    req.body = vendorUpdateSchema.parse(req.body);
    return controller.update(req, res);
  })
);

vendorRoutes.delete(
  "/vendors/:vendorId",
  roleGuard("admin"),
  asyncHandler(controller.remove)
);
vendorRoutes.post(
  "/vendors/:vendorId/reset-device",
  roleGuard("admin"),
  asyncHandler(controller.resetDevice)
);

vendorRoutes.post(
  "/vendors/:vendorId/force-logout",
  roleGuard("admin"),
  asyncHandler(controller.forceLogout)
);

vendorRoutes.post(
  "/vendors/:vendorId/reset-password",
  roleGuard("admin"),
  asyncHandler(controller.resetPassword)
);

module.exports = { vendorRoutes };
