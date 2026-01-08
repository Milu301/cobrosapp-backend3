const jwt = require("jsonwebtoken");
const { env } = require("../config/env");
const { AppError } = require("../utils/appError");

function auth(req, _res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return next(new AppError(401, "UNAUTHORIZED", "Token requerido"));
  }

  const token = header.slice("Bearer ".length);
  try {
    const payload = jwt.verify(token, env.JWT_SECRET);
    req.auth = {
      role: payload.role,
      adminId: payload.role === "admin" ? payload.sub : payload.adminId,
      vendorId: payload.role === "vendor" ? payload.sub : null,
      tokenVersion: payload.tv ?? 0
    };
    return next();
  } catch {
    return next(new AppError(401, "UNAUTHORIZED", "Token inválido o expirado"));
  }
}

module.exports = { auth };
