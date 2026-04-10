const express = require("express");
const { asyncHandler } = require("../../utils/asyncHandler");
const { roleGuard } = require("../../middlewares/roleGuard");
const {
  routeCreateSchema,
  routeUpdateSchema,
  routeListQuerySchema,
  routeClientsSetSchema,
  routeClientsReorderSchema,
  routeAssignSchema,
  routeDayQuerySchema,
  routeVisitCreateSchema
} = require("./schema");
const controller = require("./controller");
const routeService = require("./service");

const routesFeatureRoutes = express.Router();

// ADMIN CRUD routes
routesFeatureRoutes.get(
  "/admins/:adminId/routes",
  roleGuard("admin"),
  asyncHandler(async (req, res) => {
    req.query = routeListQuerySchema.parse(req.query);
    return controller.adminList(req, res);
  })
);

routesFeatureRoutes.post(
  "/admins/:adminId/routes",
  roleGuard("admin"),
  asyncHandler(async (req, res) => {
    req.body = routeCreateSchema.parse(req.body);
    return controller.adminCreate(req, res);
  })
);

routesFeatureRoutes.put(
  "/routes/:routeId",
  roleGuard("admin"),
  asyncHandler(async (req, res) => {
    req.body = routeUpdateSchema.parse(req.body);
    return controller.adminUpdate(req, res);
  })
);

routesFeatureRoutes.delete(
  "/routes/:routeId",
  roleGuard("admin"),
  asyncHandler(controller.adminDelete)
);

// ✅ ADMIN: get route clients (NECESARIO para UI reorder)
routesFeatureRoutes.get(
  "/routes/:routeId/clients",
  roleGuard("admin", "vendor"),
  asyncHandler(async (req, res) => {
    // vendor usa route-day internamente
    if (req.auth.role === "vendor") {
      // ✅ usa la ruta actual del día
      const dateStr = req.query.date || new Date().toISOString().slice(0, 10);
      const data = await require("./service").getRouteDay(req.auth.adminId, req.auth.vendorId, dateStr);
      return res.json({ ok: true, data });
    }

    // admin lista para reorder
    return controller.adminGetRouteClients(req, res);
  })
);

// ADMIN: set clients + reorder
routesFeatureRoutes.post(
  "/routes/:routeId/clients",
  roleGuard("admin"),
  asyncHandler(async (req, res) => {
    req.body = routeClientsSetSchema.parse(req.body);
    return controller.setClients(req, res);
  })
);

routesFeatureRoutes.put(
  "/routes/:routeId/clients/reorder",
  roleGuard("admin"),
  asyncHandler(async (req, res) => {
    req.body = routeClientsReorderSchema.parse(req.body);
    return controller.reorderClients(req, res);
  })
);

// ADMIN: assign route to vendor by date
routesFeatureRoutes.post(
  "/routes/:routeId/assign",
  roleGuard("admin"),
  asyncHandler(async (req, res) => {
    req.body = routeAssignSchema.parse(req.body);
    return controller.assign(req, res);
  })
);

// ADMIN: get vendor route-day (for LiqDiaria page)
routesFeatureRoutes.get(
  "/admins/:adminId/vendors/:vendorId/route-day",
  roleGuard("admin"),
  asyncHandler(async (req, res) => {
    if (req.params.adminId !== req.auth.adminId) {
      return res.status(403).json({ ok: false, error: { code: "FORBIDDEN", message: "adminId no coincide" } });
    }
    const dateStr = req.query.date || new Date().toISOString().slice(0, 10);
    const data = await routeService.getRouteDay(req.auth.adminId, req.params.vendorId, dateStr);
    if (!data) return res.json({ ok: true, data: { date: dateStr, assignment: null, clients: [] } });
    return res.json({ ok: true, data: { date: dateStr, ...data } });
  })
);

// VENDOR: route-day
routesFeatureRoutes.get(
  "/vendors/:vendorId/route-day",
  roleGuard("vendor"),
  asyncHandler(async (req, res) => {
    req.query = routeDayQuerySchema.parse(req.query);
    return controller.vendorRouteDay(req, res);
  })
);

// VENDOR: visits
routesFeatureRoutes.post(
  "/route-visits",
  roleGuard("vendor"),
  asyncHandler(async (req, res) => {
    req.body = routeVisitCreateSchema.parse(req.body);
    return controller.vendorVisit(req, res);
  })
);

// VENDOR: defer client to next day (weekly clients only)
routesFeatureRoutes.post(
  "/vendors/:vendorId/defer-client",
  roleGuard("vendor"),
  asyncHandler(async (req, res) => {
    if (req.params.vendorId !== req.auth.vendorId) {
      return res.status(403).json({ ok: false, error: { code: "FORBIDDEN", message: "No autorizado" } });
    }
    const { client_id, for_date, reason } = req.body || {};
    if (!client_id || !for_date) {
      return res.status(400).json({ ok: false, error: { code: "VALIDATION_ERROR", message: "client_id y for_date son requeridos" } });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(for_date))) {
      return res.status(400).json({ ok: false, error: { code: "VALIDATION_ERROR", message: "for_date debe ser YYYY-MM-DD" } });
    }

    const { query: dbQuery } = require("../../db/pool");

    // Only allow if client has weekly credits
    const check = await dbQuery(
      `SELECT 1 FROM credits
       WHERE client_id = $1 AND admin_id = $2
         AND payment_frequency = 'weekly'
         AND status IN ('active','late') AND deleted_at IS NULL LIMIT 1`,
      [client_id, req.auth.adminId]
    );
    if (!check.rows[0]) {
      return res.status(400).json({ ok: false, error: { code: "VALIDATION_ERROR", message: "Solo se pueden diferir clientes con créditos semanales" } });
    }

    const today = new Date().toISOString().slice(0, 10);
    const r = await dbQuery(
      `INSERT INTO vendor_deferred_clients (admin_id, vendor_id, client_id, from_date, for_date, reason)
       VALUES ($1,$2,$3,$4::date,$5::date,$6)
       RETURNING id, from_date, for_date`,
      [req.auth.adminId, req.auth.vendorId, client_id, today, for_date, reason || null]
    );
    return res.json({ ok: true, data: r.rows[0] || { deferred: true } });
  })
);

// VENDOR: close day (mark route assignment as completed + auto no-pago for unvisited)
routesFeatureRoutes.post(
  "/vendors/:vendorId/route-day/close",
  roleGuard("vendor"),
  asyncHandler(async (req, res) => {
    if (req.params.vendorId !== req.auth.vendorId) {
      return res.status(403).json({ ok: false, error: { code: "FORBIDDEN", message: "No autorizado" } });
    }
    const dateStr = req.body?.date || new Date().toISOString().slice(0, 10);
    const { pool } = require("../../db/pool");

    // Find active assignment
    const db = await pool.connect();
    try {
      await db.query("BEGIN");

      const assignRes = await db.query(
        `SELECT id, route_id FROM route_assignments
         WHERE vendor_id = $1 AND admin_id = $2
           AND assigned_date = $3::date
           AND status = 'assigned'
           AND deleted_at IS NULL
         LIMIT 1`,
        [req.auth.vendorId, req.auth.adminId, dateStr]
      );

      const assignment = assignRes.rows[0];
      if (!assignment) {
        await db.query("COMMIT");
        return res.json({ ok: true, data: { already_closed: true, date: dateStr } });
      }

      // Auto no-pago: insert route_visits for all unvisited clients in the route
      await db.query(
        `INSERT INTO route_visits (admin_id, route_assignment_id, client_id, visited, note)
         SELECT $1, $2, rc.client_id, false, 'Sin pago — cierre de día'
         FROM route_clients rc
         WHERE rc.route_id = $3
           AND rc.is_active = true
           AND rc.deleted_at IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM route_visits rv
             WHERE rv.route_assignment_id = $2
               AND rv.client_id = rc.client_id
           )
         ON CONFLICT (route_assignment_id, client_id) DO NOTHING`,
        [req.auth.adminId, assignment.id, assignment.route_id]
      );

      // Mark assignment completed
      const r = await db.query(
        `UPDATE route_assignments
         SET status = 'completed', updated_at = now()
         WHERE id = $1
         RETURNING id, status, assigned_date`,
        [assignment.id]
      );

      await db.query("COMMIT");
      return res.json({ ok: true, data: r.rows[0] });
    } catch (e) {
      await db.query("ROLLBACK");
      throw e;
    } finally {
      db.release();
    }
  })
);

module.exports = { routesFeatureRoutes };
