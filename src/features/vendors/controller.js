const crypto = require("crypto");
const bcrypt = require("bcrypt");
const { AppError } = require("../../utils/appError");
const { ok, created } = require("../../utils/response");
const { auditLog } = require("../../services/audit.service");
const {
  listVendors, getVendorById, createVendor, updateVendor, softDeleteVendor,
  resetVendorDevice, forceLogoutVendor, resetVendorPassword
} = require("./service");

function requireAdminParamMatch(req) {
  if (req.params.adminId !== req.auth.adminId) {
    throw new AppError(403, "FORBIDDEN", "adminId no coincide con tu sesión");
  }
}

async function list(req, res) {
  requireAdminParamMatch(req);

  const { q, status, limit, offset } = req.query;
  const result = await listVendors(req.params.adminId, { q, status, limit, offset });

  return ok(res, result.items, { total: result.total, limit, offset });
}

async function create(req, res) {
  requireAdminParamMatch(req);

  const adminId = req.params.adminId;
  const { email, password, name, phone, status, permissions } = req.body;

  const passwordHash = await bcrypt.hash(password, 12);

  const vendor = await createVendor({
    adminId,
    email,
    passwordHash,
    name,
    phone,
    status,
    permissions
  });

  await auditLog({
    adminId,
    actorRole: "admin",
    actorId: adminId,
    action: "VENDOR_CREATE",
    entityType: "vendor",
    entityId: vendor.id,
    requestIp: req.ctx.ip,
    userAgent: req.ctx.userAgent,
    requestId: req.ctx.requestId,
    meta: { email }
  });

  return created(res, vendor);
}

async function getOne(req, res) {
  const vendorId = req.params.vendorId;

  const vendor = await getVendorById(vendorId);
  if (!vendor || vendor.deleted_at) throw new AppError(404, "NOT_FOUND", "Vendor no encontrado");

  // Admin: solo su vendor. Vendor: solo él mismo.
  if (req.auth.role === "admin") {
    if (vendor.admin_id !== req.auth.adminId) throw new AppError(403, "FORBIDDEN", "No pertenece a tu admin");
  } else {
    if (vendor.id !== req.auth.vendorId) throw new AppError(403, "FORBIDDEN", "No puedes ver otro vendor");
  }

  return ok(res, vendor);
}

async function update(req, res) {
  const vendorId = req.params.vendorId;
  const adminId = req.auth.adminId;

  const patch = {};
  if (req.body.email !== undefined) patch.email = req.body.email;
  if (req.body.name !== undefined) patch.name = req.body.name;
  if (req.body.phone !== undefined) patch.phone = req.body.phone;
  if (req.body.status !== undefined) patch.status = req.body.status;
  if (req.body.permissions !== undefined) patch.permissions = req.body.permissions;
  if (req.body.password !== undefined) patch.password_hash = await bcrypt.hash(req.body.password, 12);

  const updated = await updateVendor(vendorId, adminId, patch);
  if (!updated) throw new AppError(404, "NOT_FOUND", "Vendor no encontrado");

  await auditLog({
    adminId,
    actorRole: "admin",
    actorId: adminId,
    action: "VENDOR_UPDATE",
    entityType: "vendor",
    entityId: vendorId,
    requestIp: req.ctx.ip,
    userAgent: req.ctx.userAgent,
    requestId: req.ctx.requestId,
    meta: { fields: Object.keys(patch) }
  });

  return ok(res, updated);
}

async function remove(req, res) {
  const vendorId = req.params.vendorId;
  const adminId = req.auth.adminId;

  const deleted = await softDeleteVendor(vendorId, adminId);
  if (!deleted) throw new AppError(404, "NOT_FOUND", "Vendor no encontrado");

  await auditLog({
    adminId,
    actorRole: "admin",
    actorId: adminId,
    action: "VENDOR_DELETE",
    entityType: "vendor",
    entityId: vendorId,
    requestIp: req.ctx.ip,
    userAgent: req.ctx.userAgent,
    requestId: req.ctx.requestId,
    meta: {}
  });

  return ok(res, { id: vendorId, deleted: true });
}
async function resetDevice(req, res) {
  const vendorId = req.params.vendorId;

  const row = await resetVendorDevice(vendorId, req.auth.adminId);
  if (!row) throw new AppError(404, "NOT_FOUND", "Vendedor no existe");

  await auditLog({
    action: "VENDOR_RESET_DEVICE",
    success: true,
    adminId: req.auth.adminId,
    vendorId
  });

  return ok(res, { data: row });
}

async function forceLogout(req, res) {
  const vendorId = req.params.vendorId;

  const row = await forceLogoutVendor(vendorId, req.auth.adminId);
  if (!row) throw new AppError(404, "NOT_FOUND", "Vendedor no existe");

  await auditLog({
    action: "VENDOR_FORCE_LOGOUT",
    success: true,
    adminId: req.auth.adminId,
    vendorId,
    metadata: { token_version: row.token_version }
  });

  return ok(res, { data: row });
}

function generateTempPassword() {
  return crypto.randomBytes(9).toString("hex"); // 18 chars hex
}

async function resetPassword(req, res) {
  const vendorId = req.params.vendorId;

  const desired = req.body?.password && String(req.body.password).trim().length >= 6
    ? String(req.body.password).trim()
    : generateTempPassword();

  const passwordHash = await bcrypt.hash(desired, 12);

  const row = await resetVendorPassword(vendorId, req.auth.adminId, passwordHash);
  if (!row) throw new AppError(404, "NOT_FOUND", "Vendedor no existe");

  await auditLog({
    action: "VENDOR_RESET_PASSWORD",
    success: true,
    adminId: req.auth.adminId,
    vendorId
  });

  return ok(res, { data: { vendor: row, tempPassword: desired } });
}

module.exports = {
  list,
  getOne,
  create,
  update,
  remove,
  resetDevice,
  forceLogout,
  resetPassword
};

