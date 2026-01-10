const cashService = require("./service");
const { AppError } = require("../../utils/appError");

function ok(res, data) {
  return res.json({ ok: true, data });
}

// ✅ Helpers: nunca asumas que req.params existe (a veces lo pisan middlewares)
function getParam(req, key) {
  return (req && req.params && req.params[key]) ? req.params[key] : undefined;
}

// =====================
// VENDOR
// =====================
async function vendorCashList(req, res) {
  const adminId = req?.auth?.adminId;
  const vendorIdParam = getParam(req, "vendorId") || req?.auth?.vendorId;
  const dateStr = req?.query?.date;

  if (!adminId) throw new AppError(401, "UNAUTHORIZED", "No autenticado");
  if (!vendorIdParam) throw new AppError(400, "VALIDATION_ERROR", "vendorId requerido");
  if (!dateStr) throw new AppError(400, "VALIDATION_ERROR", "date requerido");

  const result = await cashService.vendorCashList(
    { adminId, vendorId: req.auth.vendorId },
    vendorIdParam,
    dateStr,
    req.query
  );
  return ok(res, result);
}

async function vendorCashCreate(req, res) {
  const adminId = req?.auth?.adminId;
  const vendorIdParam = getParam(req, "vendorId") || req?.auth?.vendorId;

  if (!adminId) throw new AppError(401, "UNAUTHORIZED", "No autenticado");
  if (!vendorIdParam) throw new AppError(400, "VALIDATION_ERROR", "vendorId requerido");

  const result = await cashService.vendorCashCreate(
    { adminId, vendorId: req.auth.vendorId },
    vendorIdParam,
    req.body
  );
  return ok(res, result);
}

async function vendorCashSummary(req, res) {
  const adminId = req?.auth?.adminId;
  const vendorIdParam = getParam(req, "vendorId") || req?.auth?.vendorId;
  const dateStr = req?.query?.date;

  if (!adminId) throw new AppError(401, "UNAUTHORIZED", "No autenticado");
  if (!vendorIdParam) throw new AppError(400, "VALIDATION_ERROR", "vendorId requerido");
  if (!dateStr) throw new AppError(400, "VALIDATION_ERROR", "date requerido");

  const result = await cashService.vendorCashSummary(
    { adminId, vendorId: req.auth.vendorId },
    vendorIdParam,
    dateStr,
    req.query
  );
  return ok(res, result);
}

// =====================
// ADMIN
// =====================
async function adminCashList(req, res) {
  const adminIdParam = getParam(req, "adminId") || req?.auth?.adminId;
  const dateStr = req?.query?.date;

  if (!adminIdParam) throw new AppError(400, "VALIDATION_ERROR", "adminId requerido");
  if (!dateStr) throw new AppError(400, "VALIDATION_ERROR", "date requerido");

  const result = await cashService.adminCashList(
    { adminId: req?.auth?.adminId, vendorId: req?.auth?.vendorId },
    adminIdParam,
    dateStr,
    req.query
  );
  return ok(res, result);
}

async function adminCashCreate(req, res) {
  const adminIdParam = getParam(req, "adminId") || req?.auth?.adminId;

  if (!adminIdParam) throw new AppError(400, "VALIDATION_ERROR", "adminId requerido");

  const result = await cashService.adminCashCreate(
    { adminId: req?.auth?.adminId, vendorId: req?.auth?.vendorId },
    adminIdParam,
    req.body
  );
  return ok(res, result);
}

async function adminCashSummary(req, res) {
  const adminIdParam = getParam(req, "adminId") || req?.auth?.adminId;
  const dateStr = req?.query?.date;

  if (!adminIdParam) throw new AppError(400, "VALIDATION_ERROR", "adminId requerido");
  if (!dateStr) throw new AppError(400, "VALIDATION_ERROR", "date requerido");

  const result = await cashService.adminCashSummary(
    { adminId: req?.auth?.adminId, vendorId: req?.auth?.vendorId },
    adminIdParam,
    dateStr,
    req.query
  );
  return ok(res, result);
}

// =====================================================
// ✅ Endpoint unificado: GET /cash/summary?date=YYYY-MM-DD
// Decide por rol usando el token (req.auth.role)
// =====================================================
async function summary(req, res) {
  const role = req?.auth?.role;
  const dateStr = req?.query?.date;

  if (!dateStr) throw new AppError(400, "VALIDATION_ERROR", "date requerido");
  if (!role) throw new AppError(401, "UNAUTHORIZED", "No autenticado");

  if (role === "vendor") {
    req.params = req.params || {};
    req.params.vendorId = req.params.vendorId || req.auth.vendorId;
    return vendorCashSummary(req, res);
  }

  if (role === "admin") {
    req.params = req.params || {};
    req.params.adminId = req.params.adminId || req.auth.adminId;
    return adminCashSummary(req, res);
  }

  throw new AppError(403, "FORBIDDEN", "Rol no permitido");
}

// =====================================================
// ✅ Aliases para compat con rutas (no rompen nada)
// =====================================================
const listVendorCash = vendorCashList;
const createVendorCashMovement = vendorCashCreate;

const listAdminCash = adminCashList;
const createAdminCashMovement = adminCashCreate;

module.exports = {
  vendorCashList,
  vendorCashCreate,
  vendorCashSummary,

  adminCashList,
  adminCashCreate,
  adminCashSummary,

  summary,

  listVendorCash,
  createVendorCashMovement,
  listAdminCash,
  createAdminCashMovement,
};
