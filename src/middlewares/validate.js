/**
 * Zod-based request validation middleware.
 *
 * It validates any of: req.body, req.query, req.params, req.headers
 * when a Zod schema is provided.
 *
 * On success it overwrites the corresponding req.* with the parsed output
 * (so coercions/defaults from Zod apply).
 *
 * On failure Zod throws a ZodError; the global errorHandler in this project
 * already formats a consistent 400 response for ZodError.
 */

function validate({ body, query, params, headers } = {}) {
  return function validateMiddleware(req, _res, next) {
    try {
      if (body) req.body = body.parse(req.body);
      if (query) req.query = query.parse(req.query);
      if (params) req.params = params.parse(req.params);
      if (headers) req.headers = headers.parse(req.headers);
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = { validate };
