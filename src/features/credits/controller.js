const { created, ok } = require("../../utils/response");
const { auditLog } = require("../../services/audit.service");
const service = require("./service");

async function createCredit(req, res) {
  const { clientId } = req.params;

  const credit = await service.createCredit(
    { role: req.auth.role, adminId: req.auth.adminId, vendorId: req.auth.vendorId },
    clientId,
    req.body
  );

  await auditLog({
    adminId: req.auth.adminId,
    vendorId: req.auth.role === "vendor" ? req.auth.vendorId : null,
    actorRole: req.auth.role,
    actorId: req.auth.role === "vendor" ? req.auth.vendorId : req.auth.adminId,
    action: "CREDIT_CREATE",
    entityType: "credit",
    entityId: credit.id,
    requestIp: req.ctx.ip,
    userAgent: req.ctx.userAgent,
    requestId: req.ctx.requestId,
    meta: { client_id: clientId, total_amount: credit.total_amount }
  });

  return created(res, credit);
}

async function createPayment(req, res) {
  const { creditId } = req.params;

  const result = await service.createPayment(
    { role: req.auth.role, adminId: req.auth.adminId, vendorId: req.auth.vendorId },
    creditId,
    req.body
  );

  await auditLog({
    adminId: req.auth.adminId,
    vendorId: req.auth.role === "vendor" ? req.auth.vendorId : null,
    actorRole: req.auth.role,
    actorId: req.auth.role === "vendor" ? req.auth.vendorId : req.auth.adminId,
    action: "PAYMENT_CREATE",
    entityType: "payment",
    entityId: result.payment.id,
    requestIp: req.ctx.ip,
    userAgent: req.ctx.userAgent,
    requestId: req.ctx.requestId,
    meta: { credit_id: creditId, amount: result.payment.amount }
  });

  return created(res, result);
}

async function getCredits(req, res) {
  const { clientId } = req.params;
  const credits = await service.listClientCredits(
    { role: req.auth.role, adminId: req.auth.adminId, vendorId: req.auth.vendorId },
    clientId
  );
  return ok(res, credits);
}

module.exports = { createCredit, createPayment, getCredits };
