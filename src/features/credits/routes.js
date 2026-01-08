const express = require("express");
const { asyncHandler } = require("../../utils/asyncHandler");
const { roleGuard } = require("../../middlewares/roleGuard");
const { createCreditSchema, createPaymentSchema } = require("./schema");
const controller = require("./controller");

const creditRoutes = express.Router();

/**
 * POST /clients/:clientId/credits
 * POST /credits/:creditId/payments
 */
creditRoutes.post(
  "/clients/:clientId/credits",
  roleGuard("admin", "vendor"),
  asyncHandler(async (req, res) => {
    req.body = createCreditSchema.parse(req.body);
    return controller.createCredit(req, res);
  })
);

creditRoutes.post(
  "/credits/:creditId/payments",
  roleGuard("admin", "vendor"),
  asyncHandler(async (req, res) => {
    req.body = createPaymentSchema.parse(req.body);
    return controller.createPayment(req, res);
  })
);

module.exports = { creditRoutes };
