const service = require("./service");
const { ok } = require("../../utils/response");
const { AppError } = require("../../utils/appError");

function requireAdminParamMatch(req) {
  if (req.params.adminId !== req.auth.adminId) throw new AppError(403, "FORBIDDEN", "adminId mismatch");
}

async function adminList(req, res) {
  requireAdminParamMatch(req);
  const { q, status, vendor_id, limit, offset } = req.query;
  const result = await service.listAdminClients(req.auth.adminId, { q, status, vendor_id, limit, offset });
  return ok(res, result.items, { total: result.total, limit, offset });
}

async function vendorList(req, res) {
  if (req.params.vendorId !== req.auth.vendorId) throw new AppError(403, "FORBIDDEN", "vendorId mismatch");
  const { q, status, limit, offset } = req.query;
  const result = await service.listVendorClients(req.auth.adminId, req.auth.vendorId, { q, status, limit, offset });
  return ok(res, result.items, { total: result.total, limit, offset });
}

async function getOne(req, res) {
  const clientId = req.params.clientId;
  const client = await service.getClientById(clientId);
  if (!client || client.deleted_at) throw new AppError(404, "NOT_FOUND", "Cliente no encontrado");

  if (client.admin_id !== req.auth.adminId) throw new AppError(403, "FORBIDDEN", "Cliente no pertenece a tu admin");

  if (req.auth.role === "vendor") {
    const can = await service.vendorCanAccessClient(req.auth.adminId, req.auth.vendorId, clientId);
    if (!can) throw new AppError(403, "FORBIDDEN", "No asignado a este vendor");
  }

  const credits = await service.listClientCredits(clientId);
  return ok(res, { client, credits });
}

async function adminCreate(req, res) {
  requireAdminParamMatch(req);
  const { vendor_id, name, phone, doc_id, address, notes, status } = req.body;
  if (vendor_id) await service.assertVendorBelongsToAdmin(vendor_id, req.auth.adminId);

  const created = await service.createClient({
    adminId: req.auth.adminId,
    vendorId: vendor_id || null,
    name, phone, doc_id, address, notes, status
  });
  return ok(res, created);
}

async function vendorCreate(req, res) {
  if (req.params.vendorId !== req.auth.vendorId) {
    throw new AppError(403, "FORBIDDEN", "vendorId mismatch");
  }
  await service.assertVendorBelongsToAdmin(req.auth.vendorId, req.auth.adminId);

  const { name, phone, doc_id, address, notes, status } = req.body;
  const created = await service.createClient({
    adminId: req.auth.adminId,
    vendorId: req.auth.vendorId,
    name, phone, doc_id, address, notes, status
  });
  return ok(res, created);
}

async function update(req, res) {
  const clientId = req.params.clientId;
  const client = await service.getClientById(clientId);
  if (!client || client.deleted_at) throw new AppError(404, "NOT_FOUND", "Cliente no encontrado");
  if (client.admin_id !== req.auth.adminId) throw new AppError(403, "FORBIDDEN", "Cliente no pertenece a tu admin");

  if (req.auth.role === "vendor") {
    if (client.vendor_id !== req.auth.vendorId) throw new AppError(403, "FORBIDDEN", "No asignado a este vendor");
    // Vendors can only edit clients they created within the last 24 hours
    const createdAt = new Date(client.created_at).getTime();
    const hoursSinceCreation = (Date.now() - createdAt) / (1000 * 60 * 60);
    if (hoursSinceCreation > 24) {
      throw new AppError(403, "FORBIDDEN", "Solo el administrador puede editar clientes con más de 24h de creación");
    }
  }

  if (req.body.vendor_id) await service.assertVendorBelongsToAdmin(req.body.vendor_id, req.auth.adminId);

  const updated = await service.updateClient(clientId, req.auth.adminId, req.body);
  if (!updated) throw new AppError(404, "NOT_FOUND", "Cliente no encontrado");
  return ok(res, updated);
}

async function remove(req, res) {
  const clientId = req.params.clientId;
  const client = await service.getClientById(clientId);
  if (!client || client.deleted_at) throw new AppError(404, "NOT_FOUND", "Cliente no encontrado");
  if (client.admin_id !== req.auth.adminId) throw new AppError(403, "FORBIDDEN", "Cliente no pertenece a tu admin");

  if (req.auth.role === "vendor") {
    if (client.vendor_id !== req.auth.vendorId) throw new AppError(403, "FORBIDDEN", "No asignado a este vendor");
  }

  const deleted = await service.softDeleteClient(clientId, req.auth.adminId);
  return ok(res, deleted);
}

async function hardRemove(req, res) {
  if (req.auth.role !== "admin") throw new AppError(403, "FORBIDDEN", "Solo admins pueden borrar permanentemente");
  const clientId = req.params.clientId;
  const client = await service.getClientById(clientId);
  if (client && client.admin_id !== req.auth.adminId) throw new AppError(403, "FORBIDDEN", "Cliente no pertenece a tu admin");

  const result = await service.hardDeleteClient(clientId, req.auth.adminId);
  return ok(res, result);
}

module.exports = { adminList, vendorList, getOne, adminCreate, vendorCreate, update, remove, hardRemove };
