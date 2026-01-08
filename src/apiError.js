const { AppError } = require("./utils/appError");

/**
 * ApiError es un alias compatible para el proyecto.
 * Se comporta como AppError para que el middleware errorHandler lo capture
 * y responda con el status/código correcto (no 500).
 *
 * Uso actual en routesFeature:
 *   throw new ApiError("VALIDATION_ERROR", "date is required")
 */
class ApiError extends AppError {
  constructor(code, message, details, status = 400) {
    super(status, code, message, details);
    this.name = "ApiError";
  }
}

module.exports = { ApiError };
