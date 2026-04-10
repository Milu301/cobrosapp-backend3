const { ok } = require("../../utils/response");
const { auditLog } = require("../../services/audit.service");
const service = require("./service");

function toCsv(rows) {
  if (!rows || rows.length === 0) return "empty\n";
  const headers = Object.keys(rows[0]);
  const esc = (v) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    if (s.includes('"') || s.includes(",") || s.includes("\n")) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [];
  lines.push(headers.join(","));
  for (const r of rows) lines.push(headers.map((h) => esc(r[h])).join(","));
  return lines.join("\n") + "\n";
}

async function collections(req, res) {
  const { adminId } = req.params;
  const data = await service.collectionsSummary({ adminId: req.auth.adminId }, adminId, req.query);

  await auditLog({
    adminId: req.auth.adminId,
    actorRole: "admin",
    actorId: req.auth.adminId,
    action: "REPORT_COLLECTIONS",
    entityType: "report",
    entityId: null,
    requestIp: req.ctx.ip,
    userAgent: req.ctx.userAgent,
    requestId: req.ctx.requestId,
    meta: { start_date: req.query.start_date, end_date: req.query.end_date, date: req.query.date }
  });

  return ok(res, data);
}

async function collectionsCsv(req, res) {
  const { adminId } = req.params;
  const rows = await service.collectionsSummary({ adminId: req.auth.adminId }, adminId, req.query);

  await auditLog({
    adminId: req.auth.adminId,
    actorRole: "admin",
    actorId: req.auth.adminId,
    action: "REPORT_COLLECTIONS_CSV",
    entityType: "report",
    entityId: null,
    requestIp: req.ctx.ip,
    userAgent: req.ctx.userAgent,
    requestId: req.ctx.requestId,
    meta: { start_date: req.query.start_date, end_date: req.query.end_date, date: req.query.date }
  });

  const csv = toCsv(Array.isArray(rows) ? rows : []);
  const today = new Date().toISOString().slice(0, 10);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="collections_${today}.csv"`);
  return res.status(200).send(csv);
}

async function lateClients(req, res) {
  const { adminId } = req.params;
  const result = await service.lateClients({ adminId: req.auth.adminId }, adminId, req.query);

  await auditLog({
    adminId: req.auth.adminId,
    actorRole: "admin",
    actorId: req.auth.adminId,
    action: "REPORT_LATE_CLIENTS",
    entityType: "report",
    entityId: null,
    requestIp: req.ctx.ip,
    userAgent: req.ctx.userAgent,
    requestId: req.ctx.requestId,
    meta: { date: req.query.date }
  });

  return ok(res, result.items, { total: result.total, ...req.query });
}

async function vendorPerformance(req, res) {
  const { adminId } = req.params;
  const data = await service.vendorPerformance({ adminId: req.auth.adminId }, adminId, req.query);

  await auditLog({
    adminId: req.auth.adminId,
    actorRole: "admin",
    actorId: req.auth.adminId,
    action: "REPORT_VENDOR_PERFORMANCE",
    entityType: "report",
    entityId: null,
    requestIp: req.ctx.ip,
    userAgent: req.ctx.userAgent,
    requestId: req.ctx.requestId,
    meta: { date: req.query.date }
  });

  return ok(res, data);
}

module.exports = { collections, collectionsCsv, lateClients, vendorPerformance };
