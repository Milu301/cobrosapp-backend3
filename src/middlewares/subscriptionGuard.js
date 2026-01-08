const { AppError } = require("../utils/appError");
const { auditLog } = require("../services/audit.service");
const { getAdminSubscription, getVendorSubscriptionContext } = require("../services/subscription.service");

function isExpired(expiresAt) {
  if (!expiresAt) return false;
  const d = new Date(expiresAt);
  if (!Number.isFinite(d.getTime())) return false;
  return new Date() > d;
}

async function subscriptionGuard(req, _res, next) {
  const role = req.auth?.role;
  if (!role) return next();

  try {
    if (role === "admin") {
      const adminId = req.auth.adminId;
      const row = await getAdminSubscription(adminId);

      if (!row) throw new AppError(401, "UNAUTHORIZED", "Admin no existe");

      if (isExpired(row.subscription_expires_at)) {
        await auditLog({
          adminId,
          actorRole: "admin",
          actorId: adminId,
          action: "subscription_expired",
          entityType: "admin",
          entityId: adminId,
          requestIp: req.ip,
          userAgent: req.get("user-agent"),
          requestId: req.ctx?.requestId,
          meta: { subscription_expires_at: row.subscription_expires_at },
        });

        throw new AppError(403, "SUBSCRIPTION_EXPIRED", "Tu suscripción está expirada");
      }

      return next();
    }

    if (role === "vendor") {
      const vendorId = req.auth.vendorId;
      const tv = Number(req.auth?.tokenVersion ?? 0);

      const row = await getVendorSubscriptionContext(vendorId);
      if (!row) throw new AppError(401, "UNAUTHORIZED", "Vendedor no existe");

      const currentTv = Number(row.token_version ?? 0);
      if (tv !== currentTv) {
        await auditLog({
          adminId: row.admin_id,
          vendorId,
          actorRole: "vendor",
          actorId: vendorId,
          action: "device_mismatch",
          entityType: "vendor",
          entityId: vendorId,
          requestIp: req.ip,
          userAgent: req.get("user-agent"),
          requestId: req.ctx?.requestId,
          meta: { tokenVersion: tv, currentTokenVersion: currentTv },
        });

        throw new AppError(403, "DEVICE_MISMATCH", "Este dispositivo ya no está autorizado");
      }

      if (row.deleted_at) throw new AppError(403, "VENDOR_DISABLED", "Vendedor deshabilitado");
      if (row.vendor_status !== "active") throw new AppError(403, "VENDOR_DISABLED", "Vendedor inactivo");
      if (row.admin_status !== "active") throw new AppError(403, "ADMIN_DISABLED", "Admin inactivo");

      if (isExpired(row.subscription_expires_at)) {
        await auditLog({
          adminId: row.admin_id,
          vendorId,
          actorRole: "vendor",
          actorId: vendorId,
          action: "subscription_expired",
          entityType: "admin",
          entityId: row.admin_id,
          requestIp: req.ip,
          userAgent: req.get("user-agent"),
          requestId: req.ctx?.requestId,
          meta: { subscription_expires_at: row.subscription_expires_at },
        });

        throw new AppError(403, "SUBSCRIPTION_EXPIRED", "Tu suscripción está expirada");
      }

      return next();
    }

    return next();
  } catch (e) {
    return next(e);
  }
}

module.exports = { subscriptionGuard };
