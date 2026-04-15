const { query } = require("../db/pool");
const { AppError } = require("./appError");

async function getVendorById(vendorId) {
  const r = await query(
    `SELECT id, admin_id, status, permissions, deleted_at FROM vendors WHERE id = $1`,
    [vendorId]
  );
  return r.rows[0] || null;
}

async function assertVendorBelongsToAdmin(vendorId, adminId) {
  const v = await getVendorById(vendorId);
  if (!v || v.deleted_at) throw new AppError(404, "NOT_FOUND", "Vendor no encontrado");
  if (v.admin_id !== adminId) throw new AppError(403, "FORBIDDEN", "Vendor no pertenece a tu admin");
  return v;
}

async function assertVendorActive(vendorId, adminId) {
  const v = await assertVendorBelongsToAdmin(vendorId, adminId);
  if (String(v.status || "").toLowerCase() !== "active") {
    throw new AppError(403, "FORBIDDEN", "Vendor inactivo");
  }
  return v;
}

module.exports = { getVendorById, assertVendorBelongsToAdmin, assertVendorActive };
