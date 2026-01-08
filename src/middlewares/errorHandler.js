const { ZodError } = require("zod");
const { AppError } = require("../utils/appError");
const { fail } = require("../utils/response");
const { logger } = require("../utils/logger");

function errorHandler(err, req, res, _next) {
  // JSON inválido (Express body parser)
  // Express suele poner: err.type === 'entity.parse.failed'
  if (err instanceof SyntaxError && err.message && err.message.toLowerCase().includes("json")) {
    return fail(res, 400, "VALIDATION_ERROR", "JSON inválido", [
      { path: "body", message: "El body debe ser JSON válido" }
    ]);
  }

  // Zod
  if (err instanceof ZodError) {
    const details = err.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message
    }));
    return fail(res, 400, "VALIDATION_ERROR", "Datos inválidos", details);
  }

  // AppError
  if (err instanceof AppError) {
    return fail(res, err.status, err.code, err.message, err.details);
  }

  // Postgres common errors
  if (err && typeof err.code === "string") {
    if (err.code === "23505") {
      return fail(res, 409, "CONFLICT", "Conflicto: valor duplicado", { constraint: err.constraint });
    }
    if (err.code === "23503") {
      return fail(res, 400, "VALIDATION_ERROR", "Referencia inválida (FK)", { detail: err.detail });
    }
    if (err.code === "23514") {
      return fail(res, 400, "VALIDATION_ERROR", "Restricción CHECK fallida", { detail: err.detail });
    }
  }

  logger.error("Unhandled error", {
    requestId: req.ctx?.requestId,
    message: err?.message
  });

  return fail(res, 500, "INTERNAL_ERROR", "Error interno");
}

module.exports = { errorHandler };
