const { AppError } = require("../../utils/appError");
const { ok, created } = require("../../utils/response");
const { auditLog } = require("../../services/audit.service");
const service = require("./service");

function requireAdminParamMatch(req) {
  if (req.params.adminId !== req.auth.adminId) {
    throw new AppError(403, "FORBIDDEN", "adminId no coincide con tu sesión");
  }
}

function requireVendorParamMatch(req) {
  if (req.params.vendorId !== req.auth.vendorId) {
    throw new AppError(403, "FORBIDDEN", "vendorId no coincide con tu sesión");
  }
}

function todayYYYYMMDD() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// ADMIN: routes
async function adminList(req, res) {
  requireAdminParamMatch(req);
  const { q, status, limit, offset } = req.query;
  const result = await service.listRoutes(req.auth.adminId, { q, status, limit, offset });
  return ok(res, result.items, { total: result.total, limit, offset });
}

async function adminCreate(req, res) {
  requireAdminParamMatch(req);
  const adminId = req.auth.adminId;

  const route = await service.createRoute(adminId, req.body);

  await auditLog({
    adminId,
    actorRole: "admin",
    actorId: adminId,
    action: "ROUTE_CREATE",
    entityType: "route",
    entityId: route.id,
    requestIp: req.ctx.ip,
    userAgent: req.ctx.userAgent,
    requestId: req.ctx.requestId,
    meta: { name: route.name }
  });

  return created(res, route);
}

async function adminUpdate(req, res) {
  const adminId = req.auth.adminId;
  const routeId = req.params.routeId;

  const patch = {};
  if (req.body.name !== undefined) patch.name = req.body.name;
  if (req.body.description !== undefined) patch.description = req.body.description;
  if (req.body.status !== undefined) patch.status = req.body.status;

  const updated = await service.updateRoute(routeId, adminId, patch);
  if (!updated) throw new AppError(404, "NOT_FOUND", "Ruta no encontrada");

  await auditLog({
    adminId,
    actorRole: "admin",
    actorId: adminId,
    action: "ROUTE_UPDATE",
    entityType: "route",
    entityId: routeId,
    requestIp: req.ctx.ip,
    userAgent: req.ctx.userAgent,
    requestId: req.ctx.requestId,
    meta: { fields: Object.keys(patch) }
  });

  return ok(res, updated);
}

async function adminDelete(req, res) {
  const adminId = req.auth.adminId;
  const routeId = req.params.routeId;

  const deleted = await service.softDeleteRoute(routeId, adminId);
  if (!deleted) throw new AppError(404, "NOT_FOUND", "Ruta no encontrada");

  await auditLog({
    adminId,
    actorRole: "admin",
    actorId: adminId,
    action: "ROUTE_DELETE",
    entityType: "route",
    entityId: routeId,
    requestIp: req.ctx.ip,
    userAgent: req.ctx.userAgent,
    requestId: req.ctx.requestId,
    meta: {}
  });

  return ok(res, { id: routeId, deleted: true });
}

// ✅ ADMIN: get route clients
async function adminGetRouteClients(req, res) {
  const adminId = req.auth.adminId;
  const routeId = req.params.routeId;

  const items = await service.getRouteClientsAdmin(adminId, routeId);
  return ok(res, items);
}

// ADMIN: set clients / reorder / assign
async function setClients(req, res) {
  const adminId = req.auth.adminId;
  const routeId = req.params.routeId;

  await service.setRouteClients(adminId, routeId, req.body.clients);

  await auditLog({
    adminId,
    actorRole: "admin",
    actorId: adminId,
    action: "ROUTE_CLIENTS_SET",
    entityType: "route",
    entityId: routeId,
    requestIp: req.ctx.ip,
    userAgent: req.ctx.userAgent,
    requestId: req.ctx.requestId,
    meta: { count: req.body.clients.length }
  });

  return ok(res, { routeId, updated: true });
}

async function reorderClients(req, res) {
  const adminId = req.auth.adminId;
  const routeId = req.params.routeId;

  await service.reorderRouteClients(adminId, routeId, req.body.items);

  await auditLog({
    adminId,
    actorRole: "admin",
    actorId: adminId,
    action: "ROUTE_CLIENTS_REORDER",
    entityType: "route",
    entityId: routeId,
    requestIp: req.ctx.ip,
    userAgent: req.ctx.userAgent,
    requestId: req.ctx.requestId,
    meta: { count: req.body.items.length }
  });

  return ok(res, { routeId, reordered: true });
}

async function assign(req, res) {
  const adminId = req.auth.adminId;
  const routeId = req.params.routeId;

  const assignment = await service.assignRouteToVendor(adminId, routeId, req.body);

  await auditLog({
    adminId,
    actorRole: "admin",
    actorId: adminId,
    action: "ROUTE_ASSIGN",
    entityType: "route_assignment",
    entityId: assignment.id,
    requestIp: req.ctx.ip,
    userAgent: req.ctx.userAgent,
    requestId: req.ctx.requestId,
    meta: {
      route_id: assignment.route_id,
      vendor_id: assignment.vendor_id,
      assigned_date: assignment.assigned_date
    }
  });

  return created(res, assignment);
}

// VENDOR: route day
async function vendorRouteDay(req, res) {
  requireVendorParamMatch(req);

  const dateStr = req.query.date || todayYYYYMMDD();
  const data = await service.getRouteDay(req.auth.adminId, req.auth.vendorId, dateStr);

  if (!data) return ok(res, { date: dateStr, assignment: null, clients: [] });

  return ok(res, { date: dateStr, ...data });
}

// VENDOR: create visit
async function vendorVisit(req, res) {
  const adminId = req.auth.adminId;
  const vendorId = req.auth.vendorId;

  const visit = await service.createRouteVisit(adminId, vendorId, req.body);

  await auditLog({
    adminId,
    vendorId,
    actorRole: "vendor",
    actorId: vendorId,
    action: "ROUTE_VISIT_CREATE",
    entityType: "route_visit",
    entityId: visit.id,
    requestIp: req.ctx.ip,
    userAgent: req.ctx.userAgent,
    requestId: req.ctx.requestId,
    meta: {
      route_assignment_id: visit.route_assignment_id,
      client_id: visit.client_id,
      visited: visit.visited
    }
  });

  return created(res, visit);
}

module.exports = {
  adminList,
  adminCreate,
  adminUpdate,
  adminDelete,
  adminGetRouteClients,
  setClients,
  reorderClients,
  assign,
  vendorRouteDay,
  vendorVisit
};
