const express = require("express");
const { asyncHandler } = require("../../utils/asyncHandler");
const { roleGuard } = require("../../middlewares/roleGuard");
const { getAdminStats, getVendorStats } = require("./service");
const { AppError } = require("../../utils/appError");

const statsRoutes = express.Router();

statsRoutes.get(
  "/admins/:adminId/stats",
  roleGuard("admin"),
  asyncHandler(async (req, res) => {
    const { adminId } = req.params;
    if (req.auth.adminId !== adminId) {
      throw new AppError(403, "FORBIDDEN", "No puedes ver stats de otro admin");
    }
    const data = await getAdminStats(adminId);
    return res.json({ ok: true, data });
  })
);

statsRoutes.get(
  "/vendors/:vendorId/stats",
  roleGuard("admin", "vendor"),
  asyncHandler(async (req, res) => {
    const { vendorId } = req.params;
    if (req.auth.role === "vendor" && req.auth.vendorId !== vendorId) {
      throw new AppError(403, "FORBIDDEN", "No puedes ver stats de otro vendor");
    }
    const data = await getVendorStats(req.auth.adminId, vendorId);
    return res.json({ ok: true, data });
  })
);

module.exports = { statsRoutes };
