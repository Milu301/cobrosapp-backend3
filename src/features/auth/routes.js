const express = require("express");
const { asyncHandler } = require("../../utils/asyncHandler");
const { authLimiter } = require("../../middlewares/rateLimit");
const { adminLogin, vendorLogin } = require("./controller");
const { loginAdminSchema, loginVendorSchema } = require("./schema");

const authRoutes = express.Router();

authRoutes.post("/admin/login", authLimiter, asyncHandler(async (req, res) => {
  req.body = loginAdminSchema.parse(req.body);
  return adminLogin(req, res);
}));

authRoutes.post("/vendor/login", authLimiter, asyncHandler(async (req, res) => {
  req.body = loginVendorSchema.parse(req.body);
  return vendorLogin(req, res);
}));

module.exports = { authRoutes };
