const express = require("express");
const { ok } = require("../../utils/response");

const healthRoutes = express.Router();

healthRoutes.get("/health", (req, res) => {
  return ok(res, { status: "ok", time: new Date().toISOString(), requestId: req.ctx?.requestId || null });
});

module.exports = { healthRoutes };
