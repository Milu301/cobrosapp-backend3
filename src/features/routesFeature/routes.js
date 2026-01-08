const express = require("express");
const { asyncHandler } = require("../../utils/asyncHandler");
const { roleGuard } = require("../../middlewares/roleGuard");
const {
  routeCreateSchema,
  routeUpdateSchema,
  routeListQuerySchema,
  routeClientsSetSchema,
  routeClientsReorderSchema,
  routeAssignSchema,
  routeDayQuerySchema,
  routeVisitCreateSchema
} = require("./schema");
const controller = require("./controller");

const routesFeatureRoutes = express.Router();

// ADMIN CRUD routes
routesFeatureRoutes.get(
  "/admins/:adminId/routes",
  roleGuard("admin"),
  asyncHandler(async (req, res) => {
    req.query = routeListQuerySchema.parse(req.query);
    return controller.adminList(req, res);
  })
);

routesFeatureRoutes.post(
  "/admins/:adminId/routes",
  roleGuard("admin"),
  asyncHandler(async (req, res) => {
    req.body = routeCreateSchema.parse(req.body);
    return controller.adminCreate(req, res);
  })
);

routesFeatureRoutes.put(
  "/routes/:routeId",
  roleGuard("admin"),
  asyncHandler(async (req, res) => {
    req.body = routeUpdateSchema.parse(req.body);
    return controller.adminUpdate(req, res);
  })
);

routesFeatureRoutes.delete(
  "/routes/:routeId",
  roleGuard("admin"),
  asyncHandler(controller.adminDelete)
);

// ✅ ADMIN: get route clients (NECESARIO para UI reorder)
routesFeatureRoutes.get(
  "/routes/:routeId/clients",
  roleGuard("admin"),
  asyncHandler(controller.adminGetRouteClients)
);

// ADMIN: set clients + reorder
routesFeatureRoutes.post(
  "/routes/:routeId/clients",
  roleGuard("admin"),
  asyncHandler(async (req, res) => {
    req.body = routeClientsSetSchema.parse(req.body);
    return controller.setClients(req, res);
  })
);

routesFeatureRoutes.put(
  "/routes/:routeId/clients/reorder",
  roleGuard("admin"),
  asyncHandler(async (req, res) => {
    req.body = routeClientsReorderSchema.parse(req.body);
    return controller.reorderClients(req, res);
  })
);

// ADMIN: assign route to vendor by date
routesFeatureRoutes.post(
  "/routes/:routeId/assign",
  roleGuard("admin"),
  asyncHandler(async (req, res) => {
    req.body = routeAssignSchema.parse(req.body);
    return controller.assign(req, res);
  })
);

// VENDOR: route-day
routesFeatureRoutes.get(
  "/vendors/:vendorId/route-day",
  roleGuard("vendor"),
  asyncHandler(async (req, res) => {
    req.query = routeDayQuerySchema.parse(req.query);
    return controller.vendorRouteDay(req, res);
  })
);

// VENDOR: visits
routesFeatureRoutes.post(
  "/route-visits",
  roleGuard("vendor"),
  asyncHandler(async (req, res) => {
    req.body = routeVisitCreateSchema.parse(req.body);
    return controller.vendorVisit(req, res);
  })
);

module.exports = { routesFeatureRoutes };
