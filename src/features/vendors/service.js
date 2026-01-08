const { query } = require("../../db/pool");
const { AppError } = require("../../utils/appError");

async function listVendors(adminId, { q, status, limit, offset }) {
  const where = ["admin_id = $1", "deleted_at IS NULL"];
  const params = [adminId];
  let idx = 1;

  if (status) {
    params.push(status);
    where.push(`status = $${++idx}`);
  }

  if (q && q.trim() !== "") {
    params.push(`%${q.trim()}%`);
    where.push(`(name ILIKE $${++idx} OR email ILIKE $${idx} OR phone ILIKE $${idx})`);
  }

  params.push(limit);
  params.push(offset);

  const items = await query(
    `SELECT id, admin_id, email, name, phone, status, permissions, last_login_at, created_at, updated_at
     FROM vendors
     WHERE ${where.join(" AND ")}
     ORDER BY created_at DESC
     LIMIT $${++idx} OFFSET $${++idx}`,
    params
  );

  const total = await query(
    `SELECT COUNT(*)::int AS total
     FROM vendors
     WHERE ${where.join(" AND ")}`,
    params.slice(0, idx - 2)
  );

  return { items: items.rows, total: total.rows[0]?.total || 0 };
}

async function getVendorById(vendorId) {
  const r = await query(
    `SELECT id, admin_id, email, name, phone, status, permissions, deleted_at, created_at, updated_at
     FROM vendors
     WHERE id = $1`,
    [vendorId]
  );
  return r.rows[0] || null;
}

async function createVendor({ adminId, email, passwordHash, name, phone, status, permissions }) {
  // defaults: los vendors pueden crear clientes y créditos (admin puede ponerlos en false si quiere)
  const defaultPermissions = { canCreateClients: true, canCreateCredits: true };
  const mergedPermissions = { ...defaultPermissions, ...(permissions || {}) };

  const r = await query(
    `INSERT INTO vendors (admin_id, email, password_hash, name, phone, status, permissions)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
     RETURNING id, admin_id, email, name, phone, status, permissions, created_at, updated_at`,
    [adminId, email, passwordHash, name, phone || null, status, JSON.stringify(mergedPermissions)]
  );
  return r.rows[0];
}

async function updateVendor(vendorId, adminId, patch) {
  const allowed = ["email", "password_hash", "name", "phone", "status", "permissions"];
  const sets = [];
  const params = [];
  let i = 0;

  for (const key of Object.keys(patch || {})) {
    if (!allowed.includes(key)) continue;
    i += 1;

    if (key === "permissions") {
      sets.push(`${key} = $${i}::jsonb`);
      params.push(JSON.stringify(patch[key] || {}));
    } else {
      sets.push(`${key} = $${i}`);
      params.push(patch[key]);
    }
  }

  if (sets.length === 0) return null;

  params.push(vendorId);
  params.push(adminId);

  const r = await query(
    `UPDATE vendors
     SET ${sets.join(", ")}, updated_at = now()
     WHERE id = $${++i} AND admin_id = $${++i} AND deleted_at IS NULL
     RETURNING id, admin_id, email, name, phone, status, permissions, created_at, updated_at`,
    params
  );

  return r.rows[0] || null;
}

async function softDeleteVendor(vendorId, adminId) {
  const r = await query(
    `UPDATE vendors
     SET deleted_at = now(), updated_at = now()
     WHERE id = $1 AND admin_id = $2 AND deleted_at IS NULL
     RETURNING id`,
    [vendorId, adminId]
  );
  return r.rows[0] || null;
}

async function assertVendorBelongsToAdmin(vendorId, adminId) {
  const v = await getVendorById(vendorId);
  if (!v || v.deleted_at) throw new AppError(404, "NOT_FOUND", "Vendor no encontrado");
  if (v.admin_id !== adminId) throw new AppError(403, "FORBIDDEN", "Vendor no pertenece a tu admin");
  return true;
}

async function resetVendorDevice(vendorId, adminId) {
  // solo si tu DB tiene device_id_hash / token_version (ya lo tienes por tus cambios previos)
  const r = await query(
    `UPDATE vendors
     SET device_id_hash = NULL,
         token_version = COALESCE(token_version,0) + 1,
         updated_at = now()
     WHERE id = $1 AND admin_id = $2 AND deleted_at IS NULL
     RETURNING id, token_version`,
    [vendorId, adminId]
  );
  return r.rows[0] || null;
}

async function forceLogoutVendor(vendorId, adminId) {
  const r = await query(
    `UPDATE vendors
     SET token_version = COALESCE(token_version,0) + 1,
         updated_at = now()
     WHERE id = $1 AND admin_id = $2 AND deleted_at IS NULL
     RETURNING id, token_version`,
    [vendorId, adminId]
  );
  return r.rows[0] || null;
}

async function resetVendorPassword(vendorId, adminId, passwordHash) {
  const r = await query(
    `UPDATE vendors
     SET password_hash = $3,
         token_version = COALESCE(token_version,0) + 1,
         updated_at = now()
     WHERE id = $1 AND admin_id = $2 AND deleted_at IS NULL
     RETURNING id`,
    [vendorId, adminId, passwordHash]
  );
  return r.rows[0] || null;
}

module.exports = {
  listVendors,
  getVendorById,
  createVendor,
  updateVendor,
  softDeleteVendor,
  assertVendorBelongsToAdmin,
  resetVendorDevice,
  forceLogoutVendor,
  resetVendorPassword
};
