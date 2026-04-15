const bcrypt = require("bcrypt");
const { query } = require("../../db/pool");
const { created, badRequest, forbidden, unauthorized } = require("../../utils/response");
const { auditLog } = require("../../services/audit.service");
const {
  getAdminSubscription,
  getVendorSubscriptionContext
} = require("../../services/subscription.service");
const { signAccessToken } = require("../../utils/jwt");
const { logger } = require("../../utils/logger");

function nowUtc() {
  return new Date();
}

function isExpired(date) {
  if (!date) return false;
  const d = new Date(date);
  return !Number.isNaN(d.getTime()) && d.getTime() < nowUtc().getTime();
}

async function adminLogin(req, res) {
  const { email, password } = req.body || {};
  if (!email || !password) return badRequest(res, "Faltan credenciales");

  try {
    const r = await query(
      `SELECT id, email, password_hash, status, subscription_expires_at, COALESCE(token_version,0) AS token_version
       FROM admins
       WHERE LOWER(email) = LOWER($1)
       LIMIT 1`,
      [email.trim().toLowerCase()]
    );

    const admin = r.rows[0];
    if (!admin) return unauthorized(res, "Credenciales inválidas");

    const okPass = await bcrypt.compare(password, admin.password_hash);
    if (!okPass) return unauthorized(res, "Credenciales inválidas");

    if (admin.status !== "active") return forbidden(res, "Cuenta inactiva");

    const sub = await getAdminSubscription(admin.id);
    if (sub && sub.subscription_expires_at && isExpired(sub.subscription_expires_at)) {
      return forbidden(res, "Suscripción expirada", "SUBSCRIPTION_EXPIRED");
    }

    const token = signAccessToken({
      sub: admin.id,
      role: "admin",
      adminId: admin.id,
      tokenVersion: admin.token_version
    });

    try {
      await auditLog({
        adminId: admin.id,
        actorRole: "admin",
        actorId: admin.id,
        action: "ADMIN_LOGIN",
        requestIp: req.ctx?.ip,
        userAgent: req.ctx?.userAgent,
        requestId: req.ctx?.requestId,
        meta: { email: admin.email, success: true }
      });
    } catch (auditErr) {
      logger.warn("auditLog failed (adminLogin)", { message: auditErr?.message });
    }

    return created(res, {
      token,
      admin: {
        adminId: admin.id,
        id: admin.id,
        email: admin.email,
        status: admin.status,
        subscription_expires_at: admin.subscription_expires_at
      },
      session: { role: "admin", adminId: admin.id, email: admin.email }
    });
  } catch (e) {
    logger.error("adminLogin error", { message: e?.message });
    return forbidden(res, "Error interno", "INTERNAL_ERROR");
  }
}

async function vendorLogin(req, res) {
  const { email, password, deviceId } = req.body || {};
  if (!email || !password || !deviceId) return badRequest(res, "Faltan credenciales");

  try {
    const r = await query(
      `SELECT v.id, v.admin_id, v.email, v.name, v.password_hash,
              v.status, v.deleted_at,
              COALESCE(v.device_id_hash,'') AS device_id_hash,
              COALESCE(v.token_version,0) AS token_version,
              a.status AS admin_status, a.subscription_expires_at
       FROM vendors v
       JOIN admins a ON a.id = v.admin_id
       WHERE LOWER(v.email) = LOWER($1)
       LIMIT 1`,
      [email.trim().toLowerCase()]
    );

    const v = r.rows[0];
    if (!v) return unauthorized(res, "Credenciales inválidas");

    const okPass = await bcrypt.compare(password, v.password_hash);
    if (!okPass) return unauthorized(res, "Credenciales inválidas");

    if (v.deleted_at) return forbidden(res, "Cuenta eliminada");
    if (v.status !== "active") return forbidden(res, "Cuenta inactiva");
    if (v.admin_status !== "active") return forbidden(res, "Cuenta del administrador inactiva");

    const ctx = await getVendorSubscriptionContext(v.id);
    if (ctx && ctx.subscription_expires_at && isExpired(ctx.subscription_expires_at)) {
      return forbidden(res, "Suscripción expirada", "SUBSCRIPTION_EXPIRED");
    }

    const token = signAccessToken({
      sub: v.id,
      role: "vendor",
      adminId: v.admin_id,
      vendorId: v.id,
      tokenVersion: v.token_version
    });

    try {
      await auditLog({
        adminId: v.admin_id,
        vendorId: v.id,
        actorRole: "vendor",
        actorId: v.id,
        action: "VENDOR_LOGIN",
        requestIp: req.ctx?.ip,
        userAgent: req.ctx?.userAgent,
        requestId: req.ctx?.requestId,
        meta: { email: v.email, success: true }
      });
    } catch (auditErr) {
      logger.warn("auditLog failed (vendorLogin)", { message: auditErr?.message });
    }

    return created(res, {
      token,
      vendor: {
        admin_id: v.admin_id,
        email: v.email,
        name: v.name,
        status: v.status
      },
      session: { role: "vendor", adminId: v.admin_id, vendorId: v.id, email: v.email, name: v.name }
    });
  } catch (e) {
    logger.error("vendorLogin error", { message: e?.message });
    return forbidden(res, "Error interno", "INTERNAL_ERROR");
  }
}

module.exports = { adminLogin, vendorLogin };
