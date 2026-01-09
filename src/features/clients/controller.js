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

  // Siempre validar admin
  if (client.admin_id !== req.auth.adminId) throw new AppError(403, "FORBIDDEN", "Cliente no pertenece a tu admin");

  if (req.auth.role === "vendor") {
    // ✅ vendor puede acceder si:
    // - client.vendor_id == vendor
    // - o está en ruta asignada a él
    // - o tiene créditos del vendor
    const can = await service.vendorCanAccessClient(req.auth.adminId, req.auth.vendorId, clientId);
    if (!can) throw new AppError(403, "FORBIDDEN", "No asignado a este vendor");
  }

  // ✅ Enviar créditos + pagos para que Flutter los pinte
  const credits = await service.listClientCredits(clientId);

  return ok(res, { client, credits });
}

async function adminCreate(req, res) {
  requireAdminParamMatch(req);

  const { vendor_id, name, phone, doc_id, address, notes, status } = req.body;

  if (!name || String(name).trim() === "") throw new AppError(400, "VALIDATION_ERROR", "name requerido");

  if (vendor_id) await service.assertVendorBelongsToAdmin(vendor_id, req.auth.adminId);

  const created = await service.createClient({
    adminId: req.auth.adminId,
    vendorId: vendor_id || null,
    name,
    phone,
    doc_id,
    address,
    notes,
    status
  });

  return ok(res, created);
}

async function update(req, res) {
  const clientId = req.params.clientId;
  const client = await service.getClientById(clientId);
  if (!client || client.deleted_at) throw new AppError(404, "NOT_FOUND", "Cliente no encontrado");
  if (client.admin_id !== req.auth.adminId) throw new AppError(403, "FORBIDDEN", "Cliente no pertenece a tu admin");

  if (req.auth.role === "vendor") {
    // Mantengo esto estricto: vendor solo edita si está asignado directo por vendor_id
    if (client.vendor_id !== req.auth.vendorId) throw new AppError(403, "FORBIDDEN", "No asignado a este vendor");
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

module.exports = {
  adminList,
  vendorList,
  getOne,
  adminCreate,
  update,
  remove
};
