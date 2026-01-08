const { AppError } = require("../utils/appError");

function roleGuard(...roles) {
  return (req, _res, next) => {
    if (!req.auth?.role) return next(new AppError(401, "UNAUTHORIZED", "No autenticado"));
    if (!roles.includes(req.auth.role)) {
      return next(new AppError(403, "FORBIDDEN", "No tienes permisos para esta acción"));
    }
    return next();
  };
}

module.exports = { roleGuard };
