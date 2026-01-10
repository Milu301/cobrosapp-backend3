const { query } = require("../../db/pool");
const { AppError } = require("../../utils/appError");
const { env } = require("../../config/env");

// ✅ Zona horaria usada para "caja del día" (por defecto Colombia)
const APP_TZ = env.APP_TIMEZONE || "America/Bogota";

function clampInt(n, { min, max, fallback }) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(v)));
}

function assertDateYYYYMMDD(dateStr) {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(String(dateStr || ""))) {
    throw new AppError(400, "VALIDATION_ERROR", "date debe ser YYYY-MM-DD");
  }
}

function dayWindowSql(column, dateParamIdx, tzParamIdx) {
  // Filtra por "día local" en APP_TZ, pero comparando con occurred_at (timestamptz)
  return `${column} >= ($${dateParamIdx}::date::timestamp AT TIME ZONE $${tzParamIdx})
      AND ${column} <  (($${dateParamIdx}::date + 1)::timestamp AT TIME ZONE $${tzParamIdx})`;
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

// ----------------------------------------------------
// ✅ Caja Vendor
// ----------------------------------------------------
async function listVendorCash(auth, vendorIdParam, { date, limit, offset }) {
  if (auth.role === "vendor") {
    if (auth.vendorId !== vendorIdParam) throw new AppError(403, "FORBIDDEN", "No puedes ver caja de otro vendor");
  } else {
    await assertAdminOwnsVendor(auth.adminId, vendorIdParam);
  }

  assertDateYYYYMMDD(date);

  const limitN = clampInt(limit, { min: 1, max: 200, fallback: 50 });
  const offsetN = clampInt(offset, { min: 0, max: 1_000_000, fallback: 0 });

  const itemsRes = await query(
    `SELECT
       id, admin_id, vendor_id,
       movement_type, category,
       amount::float8 AS amount,
       occurred_at, reference_type, reference_id, note, created_at
     FROM vendor_cash_movements
     WHERE admin_id = $1
       AND vendor_id = $2
       AND deleted_at IS NULL
       AND ${dayWindowSql("occurred_at", 3, 4)}
     ORDER BY occurred_at DESC, created_at DESC
     LIMIT $5 OFFSET $6`,
    [auth.adminId, vendorIdParam, date, APP_TZ, limitN, offsetN]
  );

  const totalRes = await query(
    `SELECT COUNT(*)::int AS total
     FROM vendor_cash_movements
     WHERE admin_id = $1
       AND vendor_id = $2
       AND deleted_at IS NULL
       AND ${dayWindowSql("occurred_at", 3, 4)}`,
    [auth.adminId, vendorIdParam, date, APP_TZ]
  );

  return { items: itemsRes.rows, total: totalRes.rows[0]?.total || 0 };
}

async function vendorCashSummary(auth, vendorIdParam, { date }) {
  if (auth.role === "vendor") {
    if (auth.vendorId !== vendorIdParam) throw new AppError(403, "FORBIDDEN", "No puedes ver caja de otro vendor");
  } else {
    await assertAdminOwnsVendor(auth.adminId, vendorIdParam);
  }

  assertDateYYYYMMDD(date);

  const r = await query(
    `SELECT
       COALESCE(SUM(CASE WHEN movement_type='income'  THEN amount ELSE 0 END),0)::float8 AS income,
       COALESCE(SUM(CASE WHEN movement_type='expense' THEN amount ELSE 0 END),0)::float8 AS expense
     FROM vendor_cash_movements
     WHERE admin_id = $1
       AND vendor_id = $2
       AND deleted_at IS NULL
       AND ${dayWindowSql("occurred_at", 3, 4)}`,
    [auth.adminId, vendorIdParam, date, APP_TZ]
  );

  const income = Number(r.rows[0]?.income || 0);
  const expense = Number(r.rows[0]?.expense || 0);

  return { income, expense, net: income - expense, tz: APP_TZ };
}

async function createVendorCashMovement(auth, vendorIdParam, payload) {
  if (auth.role === "vendor") {
    if (auth.vendorId !== vendorIdParam) throw new AppError(403, "FORBIDDEN", "No puedes crear caja de otro vendor");
  } else {
    await assertAdminOwnsVendor(auth.adminId, vendorIdParam);
  }

  const amount = Number(payload.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new AppError(400, "VALIDATION_ERROR", "Monto inválido");

  const occurredAt = payload.occurred_at ? new Date(payload.occurred_at) : new Date();

  const r = await query(
    `INSERT INTO vendor_cash_movements
      (admin_id, vendor_id, movement_type, category, amount, occurred_at, note)
     VALUES
      ($1,$2,$3,$4,$5,$6::timestamptz,$7)
     RETURNING
      id, admin_id, vendor_id, movement_type, category,
      amount::float8 AS amount, occurred_at, note, created_at`,
    [
      auth.adminId,
      vendorIdParam,
      payload.movement_type,
      payload.category || "manual",
      amount,
      occurredAt,
      payload.note || null
    ]
  );

  return r.rows[0];
}

// ----------------------------------------------------
// ✅ Caja Admin
// ----------------------------------------------------
async function listAdminCash(auth, adminIdParam, { date, limit, offset }) {
  await assertAdminOwnsAdmin(auth.adminId, adminIdParam);

  assertDateYYYYMMDD(date);

  const limitN = clampInt(limit, { min: 1, max: 200, fallback: 50 });
  const offsetN = clampInt(offset, { min: 0, max: 1_000_000, fallback: 0 });

  const itemsRes = await query(
    `SELECT
       id, admin_id,
       movement_type, category,
       amount::float8 AS amount,
       occurred_at, reference_type, reference_id, note, created_at
     FROM admin_cash_movements
     WHERE admin_id = $1
       AND deleted_at IS NULL
       AND ${dayWindowSql("occurred_at", 2, 3)}
     ORDER BY occurred_at DESC, created_at DESC
     LIMIT $4 OFFSET $5`,
    [adminIdParam, date, APP_TZ, limitN, offsetN]
  );

  const totalRes = await query(
    `SELECT COUNT(*)::int AS total
     FROM admin_cash_movements
     WHERE admin_id = $1
       AND deleted_at IS NULL
       AND ${dayWindowSql("occurred_at", 2, 3)}`,
    [adminIdParam, date, APP_TZ]
  );

  return { items: itemsRes.rows, total: totalRes.rows[0]?.total || 0 };
}

async function adminCashSummary(auth, adminIdParam, { date }) {
  await assertAdminOwnsAdmin(auth.adminId, adminIdParam);

  assertDateYYYYMMDD(date);

  const r = await query(
    `SELECT
       COALESCE(SUM(CASE WHEN movement_type='income'  THEN amount ELSE 0 END),0)::float8 AS income,
       COALESCE(SUM(CASE WHEN movement_type='expense' THEN amount ELSE 0 END),0)::float8 AS expense
     FROM admin_cash_movements
     WHERE admin_id = $1
       AND deleted_at IS NULL
       AND ${dayWindowSql("occurred_at", 2, 3)}`,
    [adminIdParam, date, APP_TZ]
  );

  const income = Number(r.rows[0]?.income || 0);
  const expense = Number(r.rows[0]?.expense || 0);

  return { income, expense, net: income - expense, tz: APP_TZ };
}

async function createAdminCashMovement(auth, adminIdParam, payload) {
  await assertAdminOwnsAdmin(auth.adminId, adminIdParam);

  const amount = Number(payload.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new AppError(400, "VALIDATION_ERROR", "Monto inválido");

  const occurredAt = payload.occurred_at ? new Date(payload.occurred_at) : new Date();

  const r = await query(
    `INSERT INTO admin_cash_movements
      (admin_id, movement_type, category, amount, occurred_at, note)
     VALUES
      ($1,$2,$3,$4,$5::timestamptz,$6)
     RETURNING
      id, admin_id, movement_type, category,
      amount::float8 AS amount, occurred_at, note, created_at`,
    [
      adminIdParam,
      payload.movement_type,
      payload.category || "manual",
      amount,
      occurredAt,
      payload.note || null
    ]
  );

  return r.rows[0];
}

module.exports = {
  listVendorCash,
  vendorCashSummary,
  createVendorCashMovement,
  listAdminCash,
  adminCashSummary,
  createAdminCashMovement
};
