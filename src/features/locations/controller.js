const { ok, created } = require("../../utils/response");
const service = require("./service");

async function postLocation(req, res) {
  const { vendorId } = req.params;

  const row = await service.postVendorLocation(
    { adminId: req.auth.adminId, role: req.auth.role, vendorId: req.auth.vendorId },
    vendorId,
    req.body
  );

  return created(res, row);
}

async function latest(req, res) {
  const { adminId, vendorId } = req.params;

  const row = await service.getLatestLocation(
    { adminId: req.auth.adminId },
    adminId,
    vendorId
  );

  return ok(res, row); // puede ser null si aún no hay puntos
}

async function history(req, res) {
  const { adminId, vendorId } = req.params;
  const { date, limit, offset } = req.query;

  const result = await service.getLocationHistory(
    { adminId: req.auth.adminId },
    adminId,
    vendorId,
    { date, limit, offset }
  );

  return ok(res, result.items, { total: result.total, date, limit, offset });
}

async function allLatest(req, res) {
  const { adminId } = req.params;
  const rows = await service.getAllVendorsLatestLocations(
    { adminId: req.auth.adminId },
    adminId
  );
  return ok(res, rows);
}

module.exports = { postLocation, latest, allLatest, history };
