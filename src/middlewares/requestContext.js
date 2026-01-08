const crypto = require("crypto");

function requestContext(req, res, next) {
  req.ctx = {
    requestId: crypto.randomUUID(),
    startedAt: Date.now(),
    ip: req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() || req.socket.remoteAddress,
    userAgent: req.headers["user-agent"] || null
  };
  res.setHeader("x-request-id", req.ctx.requestId);
  next();
}

module.exports = { requestContext };
