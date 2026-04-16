const { query } = require("../../db/pool");
const { AppError } = require("../../utils/appError");
const { permTrue } = require("../../utils/permissions");
const { getVendorById, assertVendorBelongsToAdmin, assertVendorActive } = require("../../utils/vendor");

async function vendorCanAccessClient(adminId, vendorId, clientId) {
  const direct = await query(
    `SELECT 1 FROM clients
     WHERE id=$1 AND admin_id=$2 AND vendor_id=$3 AND deleted_at IS NULL LIMIT 1`,
    [clientId, adminId, vendorId]
  );
  if (direct.rows[0]) return true;

  const inRoute = await query(
    `SELECT 1
     FROM route_assignments ra
     JOIN routes rt ON rt.id = ra.route_id
     JOIN route_clients rc ON rc.route_id = ra.route_id
     WHERE ra.admin_id=$1 AND ra.vendor_id=$2 AND ra.deleted_at IS NULL
       AND ra.status IN ('assigned','completed')
       AND rt.deleted_at IS NULL
       AND rc.deleted_at IS NULL AND rc.is_active=true
       AND rc.client_id=$3
     LIMIT 1`,
    [adminId, vendorId, clientId]
  );
  if (inRoute.rows[0]) return true;

  const hasCredit = await query(
    `SELECT 1 FROM credits
     WHERE admin_id=$1 AND client_id=$2 AND vendor_id=$3 AND deleted_at IS NULL LIMIT 1`,
    [adminId, clientId, vendorId]
  );
  return !!hasCredit.rows[0];
}

async function listAdminClients(adminId, { q, status, vendor_id, limit, offset }) {
  const lim = Math.min(Math.max(parseInt(limit || "50", 10), 1), 200);
  const off = Math.max(parseInt(offset || "0", 10), 0);

  const where = ["admin_id = $1", "deleted_at IS NULL"];
  const params = [adminId];
  let idx = 1;

  if (status) { params.push(status); where.push(`status = $${++idx}`); }
  if (vendor_id) { params.push(vendor_id); where.push(`vendor_id = $${++idx}`); }
  if (q && q.trim() !== "") {
    params.push(`%${q.trim()}%`);
    where.push(`(name ILIKE $${++idx} OR phone ILIKE $${idx} OR doc_id ILIKE $${idx} OR address ILIKE $${idx} OR notes ILIKE $${idx})`);
  }

  params.push(lim, off);

  const itemsRes = await query(
    `SELECT id, admin_id, vendor_id, name, phone, doc_id, address, notes, status, created_at, updated_at
     FROM clients
     WHERE ${where.join(" AND ")}
     ORDER BY created_at DESC
     LIMIT $${idx + 1} OFFSET $${idx + 2}`,
    params
  );

  const totalRes = await query(
    `SELECT COUNT(*)::int AS total FROM clients WHERE ${where.join(" AND ")}`,
    params.slice(0, idx)
  );

  return { items: itemsRes.rows, total: totalRes.rows[0]?.total || 0 };
}

async function listVendorClients(adminId, vendorId, { q, status, limit, offset }) {
  const lim = Math.min(Math.max(parseInt(limit || "50", 10), 1), 200);
  const off = Math.max(parseInt(offset || "0", 10), 0);

  const where = ["admin_id = $1", "vendor_id = $2", "deleted_at IS NULL"];
  const params = [adminId, vendorId];
  let idx = 2;

  if (status) { params.push(status); where.push(`status = $${++idx}`); }
  if (q && q.trim() !== "") {
    params.push(`%${q.trim()}%`);
    where.push(`(name ILIKE $${++idx} OR phone ILIKE $${idx} OR doc_id ILIKE $${idx} OR address ILIKE $${idx} OR notes ILIKE $${idx})`);
  }

  params.push(lim, off);

  const itemsRes = await query(
    `SELECT id, admin_id, vendor_id, name, phone, doc_id, address, notes, status, created_at, updated_at
     FROM clients
     WHERE ${where.join(" AND ")}
     ORDER BY created_at DESC
     LIMIT $${idx + 1} OFFSET $${idx + 2}`,
    params
  );

  const totalRes = await query(
    `SELECT COUNT(*)::int AS total FROM clients WHERE ${where.join(" AND ")}`,
    params.slice(0, idx)
  );

  return { items: itemsRes.rows, total: totalRes.rows[0]?.total || 0 };
}

async function getClientById(clientId) {
  const r = await query(
    `SELECT id, admin_id, vendor_id, name, phone, doc_id, address, notes, status, deleted_at, created_at, updated_at
     FROM clients WHERE id = $1`,
    [clientId]
  );
  return r.rows[0] || null;
}

async function listClientCredits(clientId) {
  const r = await query(
    `SELECT
        c.id,
        c.admin_id,
        c.client_id,
        c.vendor_id,
        c.principal_amount::float8,
        c.interest_rate::float8,
        c.installments_count,
        c.start_date,
        c.status,
        c.total_amount::float8,
        c.balance::float8,
        c.balance_amount::float8,
        c.currency_code,
        c.notes,
        c.created_at,
        c.updated_at,
        COALESCE(p.payments, '[]'::json) AS payments,
        COALESCE(inst.installments, '[]'::json) AS installments
      FROM credits c
      LEFT JOIN LATERAL (
        SELECT json_agg(
          json_build_object(
            'amount', p.amount::float8,
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
      LEFT JOIN LATERAL (
        SELECT json_agg(
          json_build_object(
            'installment_number', i.installment_number,
            'due_date', i.due_date,
            'amount_due', i.amount_due::float8,
            'amount_paid', i.amount_paid::float8,
            'status', i.status,
            'paid_at', i.paid_at
          )
          ORDER BY i.installment_number ASC
        ) AS installments
        FROM installments i
        WHERE i.credit_id = c.id
      ) inst ON true
      WHERE c.client_id = $1
        AND c.deleted_at IS NULL
      ORDER BY c.created_at DESC`,
    [clientId]
  );

  return r.rows;
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

  if (!sets.length) throw new AppError(400, "VALIDATION_ERROR", "Nada para actualizar");

  params.push(clientId, adminId);

  const r = await query(
    `UPDATE clients
     SET ${sets.join(", ")}, updated_at=now()
     WHERE id=$${++i} AND admin_id=$${++i} AND deleted_at IS NULL
     RETURNING id, admin_id, vendor_id, name, phone, doc_id, address, notes, status, created_at, updated_at`,
    params
  );

  return r.rows[0] || null;
}

async function softDeleteClient(clientId, adminId) {
  const r = await query(
    `UPDATE clients
     SET deleted_at=now(), status='inactive', updated_at=now()
     WHERE id=$1 AND admin_id=$2 AND deleted_at IS NULL
     RETURNING id`,
    [clientId, adminId]
  );
  return r.rows[0] || null;
}

async function hardDeleteClient(clientId, adminId) {
  const { pool } = require("../../db/pool");
  const db = await pool.connect();
  try {
    await db.query("BEGIN");

    // Verify ownership
    const check = await db.query(
      `SELECT id FROM clients WHERE id=$1 AND admin_id=$2 LIMIT 1`,
      [clientId, adminId]
    );
    if (!check.rows[0]) throw new AppError(404, "NOT_FOUND", "Cliente no encontrado");

    // Delete dependent records in order
    await db.query(`DELETE FROM route_visits  WHERE client_id=$1`, [clientId]);
    await db.query(`DELETE FROM route_clients WHERE client_id=$1`, [clientId]);
    await db.query(
      `DELETE FROM payments WHERE credit_id IN (SELECT id FROM credits WHERE client_id=$1)`,
      [clientId]
    );
    await db.query(
      `DELETE FROM installments WHERE credit_id IN (SELECT id FROM credits WHERE client_id=$1)`,
      [clientId]
    );
    await db.query(
      `DELETE FROM vendor_cash_movements WHERE reference_type='payment' AND reference_id IN (
         SELECT p.id FROM payments p JOIN credits c ON c.id=p.credit_id WHERE c.client_id=$1
       )`,
      [clientId]
    );
    await db.query(`DELETE FROM credits WHERE client_id=$1`, [clientId]);
    await db.query(`DELETE FROM clients WHERE id=$1 AND admin_id=$2`, [clientId, adminId]);

    await db.query("COMMIT");
    return { id: clientId, deleted: true };
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  } finally {
    db.release();
  }
}

module.exports = {
  permTrue,
  getVendorById,
  assertVendorBelongsToAdmin,
  assertVendorActive,
  vendorCanAccessClient,
  listAdminClients,
  listVendorClients,
  getClientById,
  listClientCredits,
  createClient,
  updateClient,
  softDeleteClient,
  hardDeleteClient,
};
