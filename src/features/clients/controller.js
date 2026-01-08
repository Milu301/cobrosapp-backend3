const { AppError } = require("../../utils/appError");
const { ok, created } = require("../../utils/response");
const { auditLog } = require("../../services/audit.service");
const { getVendorById } = require("../vendors/service");
const {
  listAdminClients,
  listVendorClients,
  getClientById,
  listClientCredits,
  assertVendorBelongsToAdmin,
  createClient,
  updateClient,
  softDeleteClient
} = require("./service");

function requireAdminParamMatch(req) {
  if (req.params.adminId !== req.auth.adminId) {
    throw new AppError(403, "FORBIDDEN", "adminId no coincide con tu sesión");
  }
}

function permTrue(permissions, key) {
  if (!permissions) return false;
  const v = permissions[key];
  return v === true || v === "true" || v === 1 || v === "1";
}

function requireVendorParamMatch(req) {
  if (req.params.vendorId !== req.auth.vendorId) {
    throw new AppError(403, "FORBIDDEN", "vendorId no coincide con tu sesión");
  }
}

async function adminList(req, res) {
  requireAdminParamMatch(req);
  const { q, status, vendor_id, limit, offset } = req.query;
  const result = await listAdminClients(req.auth.adminId, { q, status, vendor_id, limit, offset });
  return ok(res, result.items, { total: result.total, limit, offset });
}

async function adminCreate(req, res) {
  requireAdminParamMatch(req);

  const adminId = req.auth.adminId;
  const { name, phone, doc_id, address, notes, status, vendor_id } = req.body;

  if (vendor_id) await assertVendorBelongsToAdmin(vendor_id, adminId);

  const client = await createClient({
    adminId,
    vendorId: vendor_id,
    name,
    phone,
    doc_id,
    address,
    notes,
    status
  });

  await auditLog({
    adminId,
    vendorId: null,
    actorRole: "admin",
    actorId: adminId,
    action: "CLIENT_CREATE",
    entityType: "client",
    entityId: client.id,
    requestIp: req.ctx.ip,
    userAgent: req.ctx.userAgent,
    requestId: req.ctx.requestId,
    meta: { vendor_id: vendor_id || null }
  });

  return created(res, client);
}

async function vendorList(req, res) {
  requireVendorParamMatch(req);
  const { q, status, limit, offset } = req.query;
  const result = await listVendorClients(req.auth.adminId, req.auth.vendorId, { q, status, limit, offset });
  return ok(res, result.items, { total: result.total, limit, offset });
}

async function vendorCreate(req, res) {
  requireVendorParamMatch(req);

  const adminId = req.auth.adminId;
  const vendorId = req.auth.vendorId;

  // validar vendor y permisos
  const v = await getVendorById(vendorId);
  if (!v || v.deleted_at) throw new AppError(404, "NOT_FOUND", "Vendor no encontrado");
  if (v.admin_id !== adminId) throw new AppError(403, "FORBIDDEN", "Vendor no pertenece a tu admin");
  if (String(v.status || "").toLowerCase() !== "active") throw new AppError(403, "FORBIDDEN", "Vendor inactivo");
  if (!permTrue(v.permissions, "canCreateClients")) {
    throw new AppError(403, "FORBIDDEN", "No tienes permiso para crear clientes");
  }

  const { name, phone, doc_id, address, notes, status } = req.body;

  const client = await createClient({
    adminId,
    vendorId,
    name,
    phone,
    doc_id,
    address,
    notes,
    status
  });

  await auditLog({
    adminId,
    vendorId,
    actorRole: "vendor",
    actorId: vendorId,
    action: "CLIENT_CREATE",
    entityType: "client",
    entityId: client.id,
    requestIp: req.ctx.ip,
    userAgent: req.ctx.userAgent,
    requestId: req.ctx.requestId,
    meta: { vendor_id: vendorId }
  });

  return created(res, client);
}

async function getOne(req, res) {
  const clientId = req.params.clientId;
  const client = await getClientById(clientId);
  if (!client || client.deleted_at) throw new AppError(404, "NOT_FOUND", "Cliente no encontrado");

  if (req.auth.role === "admin") {
    if (client.admin_id !== req.auth.adminId) throw new AppError(403, "FORBIDDEN", "No pertenece a tu admin");
  } else {
    if (client.admin_id !== req.auth.adminId) throw new AppError(403, "FORBIDDEN", "No pertenece a tu admin");
    if (client.vendor_id !== req.auth.vendorId) throw new AppError(403, "FORBIDDEN", "No asignado a este vendor");
  }

  // ✅ incluir créditos + pagos para la pantalla detalle
  // Mantiene compatibilidad: devuelve el cliente como antes y agrega "credits".
  const credits = await listClientCredits(clientId);

  return ok(res, { ...client, credits });
}

async function update(req, res) {
  const clientId = req.params.clientId;
  const existing = await getClientById(clientId);
  if (!existing || existing.deleted_at) throw new AppError(404, "NOT_FOUND", "Cliente no encontrado");

  const adminId = req.auth.adminId;

  if (req.auth.role === "admin") {
    if (existing.admin_id !== adminId) throw new AppError(403, "FORBIDDEN", "No pertenece a tu admin");

    // si cambia vendor_id, validar
    if (req.body.vendor_id) await assertVendorBelongsToAdmin(req.body.vendor_id, adminId);
  } else {
    // vendor solo puede editar sus clientes
    if (existing.admin_id !== adminId) throw new AppError(403, "FORBIDDEN", "No pertenece a tu admin");
    if (existing.vendor_id !== req.auth.vendorId) throw new AppError(403, "FORBIDDEN", "No asignado a este vendor");

    // vendor NO puede reasignar vendor_id
    if (req.body.vendor_id && req.body.vendor_id !== existing.vendor_id) {
      throw new AppError(403, "FORBIDDEN", "No puedes reasignar el cliente a otro vendor");
    }
  }

  const updated = await updateClient(clientId, adminId, req.body);

  await auditLog({
    adminId,
    vendorId: req.auth.role === "vendor" ? req.auth.vendorId : null,
    actorRole: req.auth.role,
    actorId: req.auth.role === "admin" ? adminId : req.auth.vendorId,
    action: "CLIENT_UPDATE",
    entityType: "client",
    entityId: clientId,
    requestIp: req.ctx.ip,
    userAgent: req.ctx.userAgent,
    requestId: req.ctx.requestId,
    meta: { patch: req.body }
  });

  return ok(res, updated);
}

async function remove(req, res) {
  const clientId = req.params.clientId;
  const existing = await getClientById(clientId);
  if (!existing || existing.deleted_at) throw new AppError(404, "NOT_FOUND", "Cliente no encontrado");

  const adminId = req.auth.adminId;

  if (req.auth.role === "admin") {
    if (existing.admin_id !== adminId) throw new AppError(403, "FORBIDDEN", "No pertenece a tu admin");
  } else {
    if (existing.admin_id !== adminId) throw new AppError(403, "FORBIDDEN", "No pertenece a tu admin");
    if (existing.vendor_id !== req.auth.vendorId) throw new AppError(403, "FORBIDDEN", "No asignado a este vendor");
  }

  const deleted = await softDeleteClient(clientId, adminId);
  if (!deleted) throw new AppError(404, "NOT_FOUND", "Cliente no encontrado");

  await auditLog({
    adminId,
    vendorId: req.auth.role === "vendor" ? req.auth.vendorId : null,
    actorRole: req.auth.role,
    actorId: req.auth.role === "admin" ? adminId : req.auth.vendorId,
    action: "CLIENT_DELETE",
    entityType: "client",
    entityId: clientId,
    requestIp: req.ctx.ip,
    userAgent: req.ctx.userAgent,
    requestId: req.ctx.requestId,
    meta: {}
  });

  return ok(res, { id: clientId, deleted: true });
}

module.exports = { adminList, adminCreate, vendorList, vendorCreate, getOne, update, remove };
