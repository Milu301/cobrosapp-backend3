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
  const error = { code, message };
  if (details !== undefined) error.details = details;
  return res.status(status).json({ ok: false, error });
}

module.exports = { ok, created, fail };
