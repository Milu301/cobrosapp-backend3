const express = require("express");
const { asyncHandler } = require("../../utils/asyncHandler");
const { roleGuard } = require("../../middlewares/roleGuard");
const {
  clientCreateAdminSchema,
  clientCreateVendorSchema,
  clientUpdateSchema,
  clientListQuerySchema
} = require("./schema");
const controller = require("./controller");

const clientRoutes = express.Router();

clientRoutes.get(
  "/admins/:adminId/clients",
  roleGuard("admin"),
  asyncHandler(async (req, res) => {
    req.query = clientListQuerySchema.parse(req.query);
    return controller.adminList(req, res);
  })
);

clientRoutes.post(
  "/admins/:adminId/clients",
  roleGuard("admin"),
  asyncHandler(async (req, res) => {
    req.body = clientCreateAdminSchema.parse(req.body);
    return controller.adminCreate(req, res);
  })
);

clientRoutes.get(
  "/vendors/:vendorId/clients",
  roleGuard("vendor"),
  asyncHandler(async (req, res) => {
    req.query = clientListQuerySchema.omit({ vendor_id: true }).parse(req.query);
    return controller.vendorList(req, res);
  })
);

clientRoutes.post(
  "/vendors/:vendorId/clients",
  roleGuard("vendor"),
  asyncHandler(async (req, res) => {
    req.body = clientCreateVendorSchema.parse(req.body);
    return controller.vendorCreate(req, res);
  })
);

clientRoutes.get("/clients/:clientId", roleGuard("admin", "vendor"), asyncHandler(controller.getOne));

clientRoutes.put(
  "/clients/:clientId",
  roleGuard("admin", "vendor"),
  asyncHandler(async (req, res) => {
    req.body = clientUpdateSchema.parse(req.body);
    return controller.update(req, res);
  })
);

clientRoutes.delete("/clients/:clientId", roleGuard("admin", "vendor"), asyncHandler(controller.remove));

clientRoutes.delete("/admins/:adminId/clients/:clientId/hard", roleGuard("admin"), asyncHandler(controller.hardRemove));

module.exports = { clientRoutes };
