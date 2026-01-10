const { ok, created } = require("../../utils/response");
const { auditLog } = require("../../services/audit.service");
const service = require("./service");

// ✅ Helper: evita crash si req.params viene undefined
function getParam(req, key) {
  const p = req?.params ?? {};
  return p[key];
}

// ✅ Helper: para adminId siempre usar param si existe, si no el del token
function getAdminId(req) {
  return getParam(req, "adminId") || req?.auth?.adminId;
}

// ✅ Helper: vendorId param con fallback
function getVendorId(req) {
  return getParam(req, "vendorId") || req?.auth?.vendorId;
}

async function vendorCashList(req, res) {
  const vendorId = getVendorId(req);
  const { date, limit, offset } = req.query;

  const result = await service.listVendorCash(
    { adminId: req.auth.adminId, role: req.auth.role, vendorId: req.auth.vendorId },
    vendorId,
    { date, limit, offset }
  );

  return ok(res, result.items, { total: result.total, limit, offset, date });
}

async function vendorCashCreate(req, res) {
  const vendorId = getVendorId(req);

  const row = await service.createVendorCashMovement(
    { adminId: req.auth.adminId, role: req.auth.role, vendorId: req.auth.vendorId },
    vendorId,
    req.body
  );

  await auditLog({
    adminId: req.auth.adminId,
    vendorId: req.auth.vendorId,
    actorRole: "vendor",
    actorId: req.auth.vendorId,
    action: "VENDOR_CASH_CREATE",
    entityType: "vendor_cash_movement",
    entityId: row.id,
    requestIp: req.ctx.ip,
    userAgent: req.ctx.userAgent,
    requestId: req.ctx.requestId,
    meta: { vendor_id: vendorId, movement_type: row.movement_type, amount: row.amount }
  });

  return created(res, row);
}

async function vendorCashSummary(req, res) {
  const vendorId = getVendorId(req);
  const { date } = req.query;

  const data = await service.vendorCashSummary(
    { adminId: req.auth.adminId, role: req.auth.role, vendorId: req.auth.vendorId },
    vendorId,
    { date }
  );

  return ok(res, data);
}

async function adminCashList(req, res) {
  const adminId = getAdminId(req);
  const { date, limit, offset } = req.query;

  const result = await service.listAdminCash(
    { adminId: req.auth.adminId },
    adminId,
    { date, limit, offset }
  );

  return ok(res, result.items, { total: result.total, limit, offset, date });
}

async function adminCashCreate(req, res) {
  const adminId = getAdminId(req);

  const row = await service.createAdminCashMovement(
    { adminId: req.auth.adminId },
    adminId,
    req.body
  );

  await auditLog({
    adminId: req.auth.adminId,
    actorRole: "admin",
    actorId: req.auth.adminId,
    action: "ADMIN_CASH_CREATE",
    entityType: "admin_cash_movement",
    entityId: row.id,
    requestIp: req.ctx.ip,
    userAgent: req.ctx.userAgent,
    requestId: req.ctx.requestId,
    meta: { movement_type: row.movement_type, amount: row.amount }
  });

  return created(res, row);
}

async function adminCashSummary(req, res) {
  const adminId = getAdminId(req);
  const { date } = req.query;

  const data = await service.adminCashSummary(
    { adminId: req.auth.adminId },
    adminId,
    { date }
  );

  return ok(res, data);
}

// -------------------------------------------------
// ✅ Aliases para compat con src/features/cash/routes.js
// -------------------------------------------------

// /cash/summary (sin params) decide por rol
async function summary(req, res) {
  const { date } = req.query;

  if (req.auth?.role === "vendor") {
    const vendorId = req.auth.vendorId;
    const data = await service.vendorCashSummary(
      { adminId: req.auth.adminId, role: req.auth.role, vendorId: req.auth.vendorId },
      vendorId,
      { date }
    );
    return ok(res, data);
  }

  const adminId = req.auth.adminId;
  const data = await service.adminCashSummary(
    { adminId: req.auth.adminId },
    adminId,
    { date }
  );
  return ok(res, data);
}

const listAdminCash = adminCashList;
const listVendorCash = vendorCashList;
const createAdminCashMovement = adminCashCreate;
const createVendorCashMovement = vendorCashCreate;

module.exports = {
  vendorCashList,
  vendorCashCreate,
  vendorCashSummary,
  adminCashList,
  adminCashCreate,
  adminCashSummary,

  summary,
  listAdminCash,
  listVendorCash,
  createAdminCashMovement,
  createVendorCashMovement
};
