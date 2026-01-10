const service = require("./service");
const { ok } = require("../../utils/responses");
const { AppError } = require("../../utils/appError");

function requireAdminParamMatch(req) {
  if (req.params.adminId !== req.auth.adminId) throw new AppError(403, "FORBIDDEN", "adminId mismatch");
}

async function adminList(req, res) {
  requireAdminParamMatch(req);
  const data = await service.listClients(req.auth.adminId, req.query);
  return ok(res, data);
}

async function adminCreate(req, res) {
  requireAdminParamMatch(req);

  const created = await service.createClient({
    adminId: req.auth.adminId,
    ...req.body,
  });

  return ok(res, created);
}

// ✅ NUEVO: Vendor puede crear clientes
// POST /vendors/:vendorId/clients
async function vendorCreate(req, res) {
  // Seguridad: el vendorId del token debe coincidir con el param
  if (req.params.vendorId !== req.auth.vendorId) throw new AppError(403, "FORBIDDEN", "vendorId mismatch");

  // Validar vendor activo + permisos
  const vendor = await service.assertVendorActive(req.auth.vendorId, req.auth.adminId);

  // Si manejas permisos por flags:
  const canCreate = service.permTrue(vendor.permissions, "canCreateClients");
  if (!canCreate) throw new AppError(403, "FORBIDDEN", "No tienes permiso para crear clientes");

  const created = await service.createClient({
    adminId: req.auth.adminId,
    vendorId: req.auth.vendorId,
    ...req.body,
  });

  return ok(res, created);
}

async function adminGet(req, res) {
  requireAdminParamMatch(req);
  const row = await service.getClient(req.auth.adminId, req.params.clientId);
  return ok(res, row);
}

async function adminUpdate(req, res) {
  requireAdminParamMatch(req);
  const row = await service.updateClient(req.auth.adminId, req.params.clientId, req.body);
  return ok(res, row);
}

async function adminDelete(req, res) {
  requireAdminParamMatch(req);
  await service.deleteClient(req.auth.adminId, req.params.clientId);
  return ok(res, true);
}

module.exports = {
  adminList,
  adminCreate,
  adminGet,
  adminUpdate,
  adminDelete,

  // ✅ EXPORT NUEVO
  vendorCreate,
};
