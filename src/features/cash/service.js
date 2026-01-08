const { query } = require("../../db/pool");
const { AppError } = require("../../utils/appError");

function dayRangeUTC(dateStr) {
  // YYYY-MM-DD -> [00:00:00Z, next day 00:00:00Z)
  const start = new Date(dateStr + "T00:00:00.000Z");
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

async function assertAdminOwnsAdmin(reqAdminId, adminIdParam) {
  if (reqAdminId !== adminIdParam) {
    throw new AppError(403, "FORBIDDEN", "No puedes acceder a otro admin");
  }
}

async function getVendor(vendorId) {
  const r = await query(
    `SELECT id, admin_id, status, deleted_at
     FROM vendors
     WHERE id = $1`,
    [vendorId]
  );
  return r.rows[0] || null;
}

async function assertAdminOwnsVendor(reqAdminId, vendorId) {
  const v = await getVendor(vendorId);
  if (!v || v.deleted_at) throw new AppError(404, "NOT_FOUND", "Vendor no encontrado");
  if (v.admin_id !== reqAdminId) throw new AppError(403, "FORBIDDEN", "Vendor no pertenece a tu admin");
  return v;
}

async function listVendorCash({ adminId, role, vendorId: authVendorId }, vendorIdParam, { date, limit, offset }) {
  if (role === "vendor") {
    if (authVendorId !== vendorIdParam) throw new AppError(403, "FORBIDDEN", "No puedes ver caja de otro vendor");
  } else {
    await assertAdminOwnsVendor(adminId, vendorIdParam);
  }

  const { start, end } = dayRangeUTC(date);

  const itemsRes = await query(
    `SELECT
       id, admin_id, vendor_id,
       movement_type, category,
       amount::float8 AS amount,
       occurred_at, reference_type, reference_id, note, created_at
     FROM vendor_cash_movements
     WHERE admin_id = $1
       AND vendor_id = $2
       AND occurred_at >= $3::timestamptz
       AND occurred_at <  $4::timestamptz
     ORDER BY occurred_at DESC, created_at DESC
     LIMIT $5 OFFSET $6`,
    [adminId, vendorIdParam, start, end, limit, offset]
  );

  const totalRes = await query(
    `SELECT COUNT(*)::int AS total
     FROM vendor_cash_movements
     WHERE admin_id = $1
       AND vendor_id = $2
       AND occurred_at >= $3::timestamptz
       AND occurred_at <  $4::timestamptz`,
    [adminId, vendorIdParam, start, end]
  );

  return { items: itemsRes.rows, total: totalRes.rows[0]?.total || 0 };
}

async function createVendorCashMovement({ adminId, role, vendorId: authVendorId }, vendorIdParam, payload) {
  if (role !== "vendor") throw new AppError(403, "FORBIDDEN", "Solo vendor puede crear su caja");
  if (authVendorId !== vendorIdParam) throw new AppError(403, "FORBIDDEN", "No puedes crear caja para otro vendor");

  const occurredAt = payload.occurred_at ? new Date(payload.occurred_at) : new Date();

  const r = await query(
    `INSERT INTO vendor_cash_movements
      (admin_id, vendor_id, movement_type, category, amount, occurred_at, reference_type, reference_id, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING
      id, admin_id, vendor_id,
      movement_type, category,
      amount::float8 AS amount,
      occurred_at, reference_type, reference_id, note, created_at`,
    [
      adminId,
      vendorIdParam,
      payload.movement_type,
      payload.category || null,
      payload.amount,
      occurredAt,
      payload.reference_type || null,
      payload.reference_id || null,
      payload.note || null
    ]
  );

  return r.rows[0];
}

async function vendorCashSummary({ adminId, role, vendorId: authVendorId }, vendorIdParam, { date }) {
  if (role === "vendor") {
    if (authVendorId !== vendorIdParam) throw new AppError(403, "FORBIDDEN", "No puedes ver caja de otro vendor");
  } else {
    await assertAdminOwnsVendor(adminId, vendorIdParam);
  }

  const { start, end } = dayRangeUTC(date);

  const r = await query(
    `SELECT
       COALESCE(SUM(CASE WHEN movement_type='income'  THEN amount ELSE 0 END),0)::float8 AS income,
       COALESCE(SUM(CASE WHEN movement_type='expense' THEN amount ELSE 0 END),0)::float8 AS expense,
       COUNT(*)::int AS count
     FROM vendor_cash_movements
     WHERE admin_id = $1
       AND vendor_id = $2
       AND occurred_at >= $3::timestamptz
       AND occurred_at <  $4::timestamptz`,
    [adminId, vendorIdParam, start, end]
  );

  const income = r.rows[0].income;
  const expense = r.rows[0].expense;
  return { date, income, expense, net: Number(income) - Number(expense), count: r.rows[0].count };
}

async function listAdminCash({ adminId }, adminIdParam, { date, limit, offset }) {
  await assertAdminOwnsAdmin(adminId, adminIdParam);
  const { start, end } = dayRangeUTC(date);

  const itemsRes = await query(
    `SELECT
       id, admin_id,
       movement_type, category,
       amount::float8 AS amount,
       occurred_at, reference_type, reference_id, note, created_at
     FROM admin_cash_movements
     WHERE admin_id = $1
       AND occurred_at >= $2::timestamptz
       AND occurred_at <  $3::timestamptz
     ORDER BY occurred_at DESC, created_at DESC
     LIMIT $4 OFFSET $5`,
    [adminIdParam, start, end, limit, offset]
  );

  const totalRes = await query(
    `SELECT COUNT(*)::int AS total
     FROM admin_cash_movements
     WHERE admin_id = $1
       AND occurred_at >= $2::timestamptz
       AND occurred_at <  $3::timestamptz`,
    [adminIdParam, start, end]
  );

  return { items: itemsRes.rows, total: totalRes.rows[0]?.total || 0 };
}

async function createAdminCashMovement({ adminId }, adminIdParam, payload) {
  await assertAdminOwnsAdmin(adminId, adminIdParam);

  const occurredAt = payload.occurred_at ? new Date(payload.occurred_at) : new Date();

  const r = await query(
    `INSERT INTO admin_cash_movements
      (admin_id, movement_type, category, amount, occurred_at, reference_type, reference_id, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING
      id, admin_id,
      movement_type, category,
      amount::float8 AS amount,
      occurred_at, reference_type, reference_id, note, created_at`,
    [
      adminIdParam,
      payload.movement_type,
      payload.category || null,
      payload.amount,
      occurredAt,
      payload.reference_type || null,
      payload.reference_id || null,
      payload.note || null
    ]
  );

  return r.rows[0];
}

async function adminCashSummary({ adminId }, adminIdParam, { date }) {
  await assertAdminOwnsAdmin(adminId, adminIdParam);
  const { start, end } = dayRangeUTC(date);

  const r = await query(
    `SELECT
       COALESCE(SUM(CASE WHEN movement_type='income'  THEN amount ELSE 0 END),0)::float8 AS income,
       COALESCE(SUM(CASE WHEN movement_type='expense' THEN amount ELSE 0 END),0)::float8 AS expense,
       COUNT(*)::int AS count
     FROM admin_cash_movements
     WHERE admin_id = $1
       AND occurred_at >= $2::timestamptz
       AND occurred_at <  $3::timestamptz`,
    [adminIdParam, start, end]
  );

  const income = r.rows[0].income;
  const expense = r.rows[0].expense;
  return { date, income, expense, net: Number(income) - Number(expense), count: r.rows[0].count };
}

module.exports = {
  listVendorCash,
  createVendorCashMovement,
  vendorCashSummary,
  listAdminCash,
  createAdminCashMovement,
  adminCashSummary
};
