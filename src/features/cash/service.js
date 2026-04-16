const { query } = require("../../db/pool");
const { AppError } = require("../../utils/appError");
const { env } = require("../../config/env");
const { clampInt } = require("../../utils/numeric");
const { assertDateYYYYMMDD, dayWindowSql } = require("../../utils/date");

const APP_TZ = env.APP_TIMEZONE || "America/Bogota";

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

function normalizeListArgs(optsOrDate, maybeQuery) {
  if (typeof optsOrDate === "string") {
    return {
      date: optsOrDate,
      limit: maybeQuery?.limit,
      offset: maybeQuery?.offset,
    };
  }
  return optsOrDate || {};
}

function normalizeSummaryArgs(optsOrDate) {
  if (typeof optsOrDate === "string") return { date: optsOrDate };
  return optsOrDate || {};
}

function inferRole(auth) {
  if (auth?.role) return auth.role;
  if (auth?.vendorId) return "vendor";
  return "admin";
}

async function listVendorCash(auth, vendorIdParam, optsOrDate, maybeQuery) {
  const role = inferRole(auth);

  if (role === "vendor") {
    if (auth.vendorId !== vendorIdParam) throw new AppError(403, "FORBIDDEN", "No puedes ver caja de otro vendor");
  } else {
    await assertAdminOwnsVendor(auth.adminId, vendorIdParam);
  }

  const { date, limit, offset } = normalizeListArgs(optsOrDate, maybeQuery);
  assertDateYYYYMMDD(date);

  const limitN = clampInt(limit, { min: 1, max: 100, fallback: 50 });
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

async function vendorCashSummary(auth, vendorIdParam, optsOrDate) {
  const role = inferRole(auth);

  if (role === "vendor") {
    if (auth.vendorId !== vendorIdParam) throw new AppError(403, "FORBIDDEN", "No puedes ver caja de otro vendor");
  } else {
    await assertAdminOwnsVendor(auth.adminId, vendorIdParam);
  }

  const { date } = normalizeSummaryArgs(optsOrDate);
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
  const role = inferRole(auth);

  if (role === "vendor") {
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

async function listAdminCash(auth, adminIdParam, optsOrDate, maybeQuery) {
  await assertAdminOwnsAdmin(auth.adminId, adminIdParam);

  const { date, limit, offset } = normalizeListArgs(optsOrDate, maybeQuery);
  assertDateYYYYMMDD(date);

  const limitN = clampInt(limit, { min: 1, max: 100, fallback: 50 });
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

async function adminCashSummary(auth, adminIdParam, optsOrDate) {
  await assertAdminOwnsAdmin(auth.adminId, adminIdParam);

  const { date } = normalizeSummaryArgs(optsOrDate);
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

async function listAllCash(auth, adminIdParam, optsOrDate, maybeQuery) {
  await assertAdminOwnsAdmin(auth.adminId, adminIdParam);

  const { date, limit, offset } = normalizeListArgs(optsOrDate, maybeQuery);
  assertDateYYYYMMDD(date);

  const limitN = clampInt(limit, { min: 1, max: 200, fallback: 100 });
  const offsetN = clampInt(offset, { min: 0, max: 1_000_000, fallback: 0 });

  const itemsRes = await query(
    `SELECT
       'admin' AS source,
       am.id,
       am.admin_id,
       NULL::text AS vendor_id,
       NULL AS vendor_name,
       am.movement_type,
       am.category,
       am.amount::float8 AS amount,
       am.occurred_at,
       am.reference_type,
       am.reference_id,
       am.note,
       am.created_at
     FROM admin_cash_movements am
     WHERE am.admin_id = $1
       AND am.deleted_at IS NULL
       AND ${dayWindowSql("am.occurred_at", 2, 3)}
     UNION ALL
     SELECT
       'vendor' AS source,
       vm.id,
       vm.admin_id,
       vm.vendor_id::text,
       v.name AS vendor_name,
       vm.movement_type,
       vm.category,
       vm.amount::float8 AS amount,
       vm.occurred_at,
       vm.reference_type,
       vm.reference_id,
       vm.note,
       vm.created_at
     FROM vendor_cash_movements vm
     JOIN vendors v ON v.id = vm.vendor_id
     WHERE vm.admin_id = $1
       AND vm.deleted_at IS NULL
       AND ${dayWindowSql("vm.occurred_at", 2, 3)}
     ORDER BY occurred_at DESC, created_at DESC
     LIMIT $4 OFFSET $5`,
    [adminIdParam, date, APP_TZ, limitN, offsetN]
  );

  const totalRes = await query(
    `SELECT (
       SELECT COUNT(*) FROM admin_cash_movements
       WHERE admin_id = $1 AND deleted_at IS NULL AND ${dayWindowSql("occurred_at", 2, 3)}
     ) + (
       SELECT COUNT(*) FROM vendor_cash_movements
       WHERE admin_id = $1 AND deleted_at IS NULL AND ${dayWindowSql("occurred_at", 2, 3)}
     ) AS total`,
    [adminIdParam, date, APP_TZ]
  );

  return { items: itemsRes.rows, total: parseInt(totalRes.rows[0]?.total) || 0 };
}

async function allCashSummary(auth, adminIdParam, optsOrDate) {
  await assertAdminOwnsAdmin(auth.adminId, adminIdParam);

  const { date } = normalizeSummaryArgs(optsOrDate);
  assertDateYYYYMMDD(date);

  const r = await query(
    `SELECT
       COALESCE(SUM(CASE WHEN movement_type='income'  THEN amount ELSE 0 END),0)::float8 AS income,
       COALESCE(SUM(CASE WHEN movement_type='expense' THEN amount ELSE 0 END),0)::float8 AS expense
     FROM (
       SELECT movement_type, amount
       FROM admin_cash_movements
       WHERE admin_id = $1 AND deleted_at IS NULL AND ${dayWindowSql("occurred_at", 2, 3)}
       UNION ALL
       SELECT movement_type, amount
       FROM vendor_cash_movements
       WHERE admin_id = $1 AND deleted_at IS NULL AND ${dayWindowSql("occurred_at", 2, 3)}
     ) AS combined`,
    [adminIdParam, date, APP_TZ]
  );

  const income = Number(r.rows[0]?.income || 0);
  const expense = Number(r.rows[0]?.expense || 0);

  return { income, expense, net: income - expense, tz: APP_TZ };
}

const vendorCashList = listVendorCash;
const adminCashList = listAdminCash;
const vendorCashCreate = createVendorCashMovement;
const adminCashCreate = createAdminCashMovement;

module.exports = {
  listVendorCash,
  vendorCashSummary,
  createVendorCashMovement,
  listAdminCash,
  adminCashSummary,
  createAdminCashMovement,
  listAllCash,
  allCashSummary,
  vendorCashList,
  adminCashList,
  vendorCashCreate,
  adminCashCreate
};
