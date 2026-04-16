const { query } = require("../../db/pool");
const { AppError } = require("../../utils/appError");
const { assertVendorActive, assertVendorBelongsToAdmin } = require("../../utils/vendor");
const { dayRangeUTC } = require("../../utils/date");

async function postVendorLocation({ adminId, role, vendorId: authVendorId }, vendorIdParam, payload) {
  if (role !== "vendor") throw new AppError(403, "FORBIDDEN", "Solo vendor puede enviar ubicación");
  if (authVendorId !== vendorIdParam) throw new AppError(403, "FORBIDDEN", "No puedes enviar ubicación de otro vendor");

  await assertVendorActive(vendorIdParam, adminId);

  const recordedAt = payload.recorded_at ? new Date(payload.recorded_at) : new Date();

  const r = await query(
    `INSERT INTO vendor_locations
      (admin_id, vendor_id, lat, lng, accuracy_m, speed_mps, heading_deg, altitude_m, battery_level, is_mock, source, recorded_at)
     VALUES
      ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING
      id, admin_id, vendor_id, lat, lng,
      accuracy_m, speed_mps, heading_deg, altitude_m,
      battery_level, is_mock, source,
      recorded_at, created_at`,
    [
      adminId,
      vendorIdParam,
      payload.lat,
      payload.lng,
      payload.accuracy_m ?? null,
      payload.speed_mps ?? null,
      payload.heading_deg ?? null,
      payload.altitude_m ?? null,
      payload.battery_level ?? null,
      payload.is_mock === true,
      payload.source || "foreground",
      recordedAt
    ]
  );

  return r.rows[0];
}

async function getLatestLocation({ adminId }, adminIdParam, vendorIdParam) {
  if (adminId !== adminIdParam) throw new AppError(403, "FORBIDDEN", "No puedes acceder a otro admin");
  await assertVendorBelongsToAdmin(vendorIdParam, adminId);

  const r = await query(
    `SELECT
       id, admin_id, vendor_id, lat, lng,
       accuracy_m, speed_mps, heading_deg, altitude_m,
       battery_level, is_mock, source,
       recorded_at, created_at
     FROM vendor_locations
     WHERE admin_id = $1 AND vendor_id = $2
     ORDER BY recorded_at DESC, created_at DESC
     LIMIT 1`,
    [adminId, vendorIdParam]
  );

  return r.rows[0] || null;
}

async function getLocationHistory({ adminId }, adminIdParam, vendorIdParam, { date, limit, offset }) {
  if (adminId !== adminIdParam) throw new AppError(403, "FORBIDDEN", "No puedes acceder a otro admin");
  await assertVendorBelongsToAdmin(vendorIdParam, adminId);

  const { start, end } = dayRangeUTC(date);

  const itemsRes = await query(
    `SELECT
       id, admin_id, vendor_id, lat, lng,
       accuracy_m, speed_mps, heading_deg, altitude_m,
       battery_level, is_mock, source,
       recorded_at, created_at
     FROM vendor_locations
     WHERE admin_id = $1
       AND vendor_id = $2
       AND recorded_at >= $3::timestamptz
       AND recorded_at <  $4::timestamptz
     ORDER BY recorded_at DESC, created_at DESC
     LIMIT $5 OFFSET $6`,
    [adminId, vendorIdParam, start, end, limit, offset]
  );

  const totalRes = await query(
    `SELECT COUNT(*)::int AS total
     FROM vendor_locations
     WHERE admin_id = $1
       AND vendor_id = $2
       AND recorded_at >= $3::timestamptz
       AND recorded_at <  $4::timestamptz`,
    [adminId, vendorIdParam, start, end]
  );

  return { items: itemsRes.rows, total: totalRes.rows[0]?.total || 0 };
}

async function getAllVendorsLatestLocations({ adminId }, adminIdParam) {
  if (adminId !== adminIdParam) throw new AppError(403, "FORBIDDEN", "No puedes acceder a otro admin");

  const r = await query(
    `SELECT DISTINCT ON (vl.vendor_id)
       vl.id, vl.admin_id, vl.vendor_id,
       vl.lat, vl.lng,
       vl.accuracy_m, vl.battery_level, vl.is_mock, vl.source,
       vl.recorded_at, vl.created_at,
       v.name AS vendor_name,
       v.status AS vendor_status
     FROM vendor_locations vl
     JOIN vendors v ON v.id = vl.vendor_id AND v.deleted_at IS NULL
     WHERE vl.admin_id = $1
     ORDER BY vl.vendor_id, vl.recorded_at DESC, vl.created_at DESC`,
    [adminId]
  );

  return r.rows;
}

module.exports = {
  postVendorLocation,
  getLatestLocation,
  getLocationHistory,
  getAllVendorsLatestLocations
};
