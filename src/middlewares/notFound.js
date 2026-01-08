const { fail } = require("../utils/response");

function notFound(req, res) {
  return fail(res, 404, "NOT_FOUND", `No existe: ${req.method} ${req.originalUrl}`);
}

module.exports = { notFound };
