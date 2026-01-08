const { AppError } = require("../utils/appError");
const { getAdminSubscription, getVendorSubscriptionContext } = require("../services/subscription.service");
const { auditLog } = require("../services/audit.service");

async function subscriptionGuard(req, _res, next) {
  try {
    const role = req.auth?.role;
    const now = new Date();

    if (role === "admin") {
      const adminId = req.auth.adminId;
      const row = await getAdminSubscription(adminId);
      if (!row) return next(new AppError(401, "UNAUTHORIZED", "Admin no existe"));

      if (row.status !== "active") return next(new AppError(403, "FORBIDDEN", "Cuenta deshabilitada"));

      if (now > new Date(row.subscription_expires_at)) {
        await auditLog({
          adminId,
          actorRole: "admin",
          actorId: adminId,
          action: "SUBSCRIPTION_EXPIRED_BLOCK",
          entityType: "admin",
          entityId: adminId,
          requestIp: req.ctx.ip,
          userAgent: req.ctx.userAgent,
          requestId: req.ctx.requestId,
          meta: { path: req.path, method: req.method }
        });
        return next(new AppError(403, "SUBSCRIPTION_EXPIRED", "La suscripción ha expirado"));
      }
      return next();
    }

    if (role === "vendor") {
      const vendorId = req.auth.vendorId;
      const tv = req.auth?.tokenVersion ?? 0;

      const row = await getVendorSubscriptionContext(vendorId);
      if (!row) return next(new AppError(401, "UNAUTHORIZED", "Vendor no existe"));

      const current = row.token_version ?? 0;
      if (tv !== current) return next(new AppError(401, "TOKEN_REVOKED", "Sesión caducada"));

      if (row.deleted_at) return next(new AppError(403, "FORBIDDEN", "Vendor eliminado"));
      if (row.vendor_status !== "active") return next(new AppError(403, "FORBIDDEN", "Vendor inactivo"));
      if (row.admin_status !== "active") return next(new AppError(403, "FORBIDDEN", "Admin deshabilitado"));

      if (now > new Date(row.subscription_expires_at)) {
        await auditLog({
          adminId: row.admin_id,
          vendorId,
          actorRole: "vendor",
          actorId: vendorId,
          action: "SUBSCRIPTION_EXPIRED_BLOCK",
          entityType: "vendor",
          entityId: vendorId,
          requestIp: req.ctx.ip,
          userAgent: req.ctx.userAgent,
          requestId: req.ctx.requestId,
          meta: { path: req.path, method: req.method }
        });
        return next(new AppError(403, "SUBSCRIPTION_EXPIRED", "La suscripción ha expirado"));
      }

      return next();
    }

    return next(new AppError(401, "UNAUTHORIZED", "No autenticado"));
  } catch (e) {
    return next(e);
  }
}

module.exports = { subscriptionGuard };
