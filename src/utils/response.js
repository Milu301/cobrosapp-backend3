function ok(res, data, meta) {
  const payload = { ok: true, data };
  if (meta !== undefined) payload.meta = meta;
  return res.status(200).json(payload);
}

function created(res, data, meta) {
  const payload = { ok: true, data };
  if (meta !== undefined) payload.meta = meta;
  return res.status(201).json(payload);
}

function fail(res, status, code, message, details) {
  const payload = { ok: false, error: { code, message } };
  if (details !== undefined) payload.error.details = details;
  return res.status(status).json(payload);
}

// ✅ helpers que tu auth/controller usa
function badRequest(res, message = "Solicitud inválida", details) {
  return fail(res, 400, "BAD_REQUEST", message, details);
}

function unauthorized(res, message = "No autorizado", details) {
  return fail(res, 401, "UNAUTHORIZED", message, details);
}

function forbidden(res, message = "Prohibido", details) {
  return fail(res, 403, "FORBIDDEN", message, details);
}

function notFound(res, message = "No encontrado", details) {
  return fail(res, 404, "NOT_FOUND", message, details);
}

function internalError(res, message = "Error interno", details) {
  return fail(res, 500, "INTERNAL_ERROR", message, details);
}

module.exports = {
  ok,
  created,
  fail,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  internalError
};
