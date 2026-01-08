const { query } = require("../../db/pool");
const { AppError } = require("../../utils/appError");

async function listAdminClients(adminId, { q, status, vendor_id, limit, offset }) {
  const where = ["admin_id = $1", "deleted_at IS NULL"];
  const params = [adminId];
  let idx = 1;

  if (status) {
    params.push(status);
    where.push(`status = $${++idx}`);
  }

  if (vendor_id) {
    params.push(vendor_id);
    where.push(`vendor_id = $${++idx}`);
  }

  if (q && q.trim() !== "") {
    params.push(`%${q.trim()}%`);
    where.push(
      `(name ILIKE $${++idx} OR phone ILIKE $${idx} OR doc_id ILIKE $${idx} OR address ILIKE $${idx} OR notes ILIKE $${idx})`
    );
  }

  params.push(limit);
  params.push(offset);

  const itemsRes = await query(
    `SELECT id, admin_id, vendor_id, name, phone, doc_id, address, notes, status, created_at, updated_at
     FROM clients
     WHERE ${where.join(" AND ")}
     ORDER BY created_at DESC
     LIMIT $${idx + 1} OFFSET $${idx + 2}`,
    params
  );

  const totalRes = await query(
    `SELECT COUNT(*)::int AS total
     FROM clients
     WHERE ${where.join(" AND ")}`,
    params.slice(0, idx)
  );

  return { items: itemsRes.rows, total: totalRes.rows[0]?.total || 0 };
}

async function listVendorClients(adminId, vendorId, { q, status, limit, offset }) {
  const where = ["admin_id = $1", "vendor_id = $2", "deleted_at IS NULL"];
  const params = [adminId, vendorId];
  let idx = 2;

  if (status) {
    params.push(status);
    where.push(`status = $${++idx}`);
  }

  if (q && q.trim() !== "") {
    params.push(`%${q.trim()}%`);
    where.push(
      `(name ILIKE $${++idx} OR phone ILIKE $${idx} OR doc_id ILIKE $${idx} OR address ILIKE $${idx} OR notes ILIKE $${idx})`
    );
  }

  params.push(limit);
  params.push(offset);

  const itemsRes = await query(
    `SELECT id, admin_id, vendor_id, name, phone, doc_id, address, notes, status, created_at, updated_at
     FROM clients
     WHERE ${where.join(" AND ")}
     ORDER BY created_at DESC
     LIMIT $${idx + 1} OFFSET $${idx + 2}`,
    params
  );

  const totalRes = await query(
    `SELECT COUNT(*)::int AS total
     FROM clients
     WHERE ${where.join(" AND ")}`,
    params.slice(0, idx)
  );

  return { items: itemsRes.rows, total: totalRes.rows[0]?.total || 0 };
}

async function getClientById(clientId) {
  const r = await query(
    `SELECT id, admin_id, vendor_id, name, phone, doc_id, address, notes, status, deleted_at, created_at, updated_at
     FROM clients
     WHERE id = $1`,
    [clientId]
  );
  return r.rows[0] || null;
}

/**
 * ✅ Vendor puede ver un cliente si:
 * - client.vendor_id == vendorId
 * - O el cliente está dentro de CUALQUIER ruta asignada a ese vendor (assigned/completed)
 * - O el vendor tiene al menos 1 crédito de ese cliente (para que no se bloquee después)
 */
async function vendorCanAccessClient(adminId, vendorId, clientId) {
  const r = await query(
    `
    SELECT 1
    WHERE
      EXISTS (
        SELECT 1
        FROM clients c
        WHERE c.id = $3
          AND c.admin_id = $1
          AND c.deleted_at IS NULL
          AND c.vendor_id = $2
      )
      OR EXISTS (
        SELECT 1
        FROM route_assignments ra
        JOIN routes rt ON rt.id = ra.route_id
        JOIN route_clients rc ON rc.route_id = ra.route_id
        WHERE ra.admin_id = $1
          AND ra.vendor_id = $2
          AND ra.deleted_at IS NULL
          AND ra.status IN ('assigned','completed')
          AND rt.deleted_at IS NULL
          AND rc.deleted_at IS NULL
          AND rc.is_active = true
          AND rc.client_id = $3
      )
      OR EXISTS (
        SELECT 1
        FROM credits cr
        WHERE cr.admin_id = $1
          AND cr.vendor_id = $2
          AND cr.client_id = $3
          AND cr.deleted_at IS NULL
      )
    LIMIT 1
    `,
    [adminId, vendorId, clientId]
  );

  return !!r.rows[0];
}

// -------------------------------------------------
// 💳 Créditos del cliente (para pantalla detalle)
// -------------------------------------------------
async function listClientCredits(clientId) {
  const r = await query(
    `SELECT
        c.id,
        c.admin_id,
        c.client_id,
        c.vendor_id,
        c.principal_amount::float8 AS principal_amount,
        c.interest_rate::float8 AS interest_rate,
        c.installments_count,
        c.start_date,
        c.status,
        c.total_amount::float8 AS total_amount,
        c.balance::float8 AS balance,
        c.balance_amount::float8 AS balance_amount,
        c.currency_code,
        c.notes,
        c.created_at,
        c.updated_at,
        COALESCE(p.payments, '[]'::json) AS payments
      FROM credits c
      LEFT JOIN LATERAL (
        SELECT json_agg(
          json_build_object(
            'id', p.id,
            'admin_id', p.admin_id,
            'credit_id', p.credit_id,
            'vendor_id', p.vendor_id,
            'amount', (p.amount::float8),
            'method', p.method,
            'note', p.note,
            'paid_at', p.paid_at,
            'created_at', p.created_at
          )
          ORDER BY p.created_at DESC
        ) AS payments
        FROM payments p
        WHERE p.credit_id = c.id
      ) p ON true
      WHERE c.client_id = $1
        AND c.deleted_at IS NULL
      ORDER BY c.created_at DESC`,
    [clientId]
  );

  return r.rows;
}

async function assertVendorBelongsToAdmin(vendorId, adminId) {
  const r = await query(
    `SELECT id, admin_id, deleted_at
     FROM vendors
     WHERE id = $1`,
    [vendorId]
  );
  const v = r.rows[0];
  if (!v || v.deleted_at) throw new AppError(400, "VALIDATION_ERROR", "vendor_id inválido");
  if (v.admin_id !== adminId) throw new AppError(403, "FORBIDDEN", "Vendor no pertenece a tu admin");
  return true;
}

async function createClient({ adminId, vendorId, name, phone, doc_id, address, notes, status }) {
  const r = await query(
    `INSERT INTO clients (admin_id, vendor_id, name, phone, doc_id, address, notes, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id, admin_id, vendor_id, name, phone, doc_id, address, notes, status, created_at, updated_at`,
    [adminId, vendorId || null, name, phone || null, doc_id || null, address || null, notes || null, status]
  );
  return r.rows[0];
}

async function updateClient(clientId, adminId, patch) {
  const allowed = ["vendor_id", "name", "phone", "doc_id", "address", "notes", "status"];
  const sets = [];
  const params = [];
  let i = 0;

  for (const key of allowed) {
    if (patch[key] === undefined) continue;
    params.push(patch[key]);
    sets.push(`${key} = $${++i}`);
  }

  if (sets.length === 0) throw new AppError(400, "VALIDATION_ERROR", "Nada para actualizar");

  params.push(clientId);
  params.push(adminId);

  const r = await query(
    `UPDATE clients
     SET ${sets.join(", ")}
     WHERE id = $${++i} AND admin_id = $${++i} AND deleted_at IS NULL
     RETURNING id, admin_id, vendor_id, name, phone, doc_id, address, notes, status, created_at, updated_at`,
    params
  );

  return r.rows[0] || null;
}

async function softDeleteClient(clientId, adminId) {
  const r = await query(
    `UPDATE clients
     SET deleted_at = now(), status = 'inactive'
     WHERE id = $1 AND admin_id = $2 AND deleted_at IS NULL
     RETURNING id`,
    [clientId, adminId]
  );
  return r.rows[0] || null;
}

module.exports = {
  listAdminClients,
  listVendorClients,
  getClientById,
  vendorCanAccessClient,
  listClientCredits,
  assertVendorBelongsToAdmin,
  createClient,
  updateClient,
  softDeleteClient
};
