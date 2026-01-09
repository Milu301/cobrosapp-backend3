const { pool, query } = require("../../db/pool");
const { AppError } = require("../../utils/appError");

function toInt(v, def) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

async function assertRouteBelongsToAdmin(adminId, routeId) {
  const r = await query(
    `SELECT id, admin_id, deleted_at
     FROM routes
     WHERE id = $1`,
    [routeId]
  );
  const row = r.rows[0];
  if (!row || row.deleted_at) throw new AppError(404, "NOT_FOUND", "Ruta no encontrada");
  if (row.admin_id !== adminId) throw new AppError(403, "FORBIDDEN", "Ruta no pertenece a tu admin");
  return true;
}

async function listRoutes(adminId, { q, status, limit, offset }) {
  const lim = Math.min(Math.max(toInt(limit, 50), 1), 200);
  const off = Math.max(toInt(offset, 0), 0);

  const where = ["r.admin_id = $1", "r.deleted_at IS NULL"];
  const params = [adminId];
  let idx = 1;

  if (status) {
    params.push(status);
    where.push(`r.status = $${++idx}`);
  }

  if (q && q.trim() !== "") {
    params.push(`%${q.trim()}%`);
    where.push(`(r.name ILIKE $${++idx} OR COALESCE(r.description,'') ILIKE $${idx})`);
  }

  params.push(lim);
  params.push(off);

  const itemsRes = await query(
    `SELECT
        r.id, r.admin_id, r.name, r.description, r.status, r.created_at, r.updated_at,
        COALESCE(x.clients_count,0)::int AS clients_count
     FROM routes r
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS clients_count
       FROM route_clients rc
       WHERE rc.route_id = r.id
         AND rc.deleted_at IS NULL
         AND rc.is_active = true
     ) x ON true
     WHERE ${where.join(" AND ")}
     ORDER BY r.created_at DESC
     LIMIT $${idx + 1} OFFSET $${idx + 2}`,
    params
  );

  const totalRes = await query(
    `SELECT COUNT(*)::int AS total
     FROM routes r
     WHERE ${where.join(" AND ")}`,
    params.slice(0, idx)
  );

  return { items: itemsRes.rows, total: totalRes.rows[0]?.total || 0 };
}

async function createRoute(adminId, payload) {
  const r = await query(
    `INSERT INTO routes (admin_id, name, description, status)
     VALUES ($1,$2,$3, COALESCE($4,'active'))
     RETURNING id, admin_id, name, description, status, created_at, updated_at`,
    [adminId, payload.name, payload.description || null, payload.status || "active"]
  );
  return r.rows[0];
}

async function updateRoute(routeId, adminId, patch) {
  await assertRouteBelongsToAdmin(adminId, routeId);

  const allowed = ["name", "description", "status"];
  const sets = [];
  const params = [];
  let i = 0;

  for (const key of allowed) {
    if (patch[key] === undefined) continue;
    params.push(patch[key]);
    sets.push(`${key} = $${++i}`);
  }

  if (!sets.length) throw new AppError(400, "VALIDATION_ERROR", "Nada para actualizar");

  params.push(routeId);
  params.push(adminId);

  const r = await query(
    `UPDATE routes
     SET ${sets.join(", ")},
         updated_at = now()
     WHERE id = $${++i} AND admin_id = $${++i} AND deleted_at IS NULL
     RETURNING id, admin_id, name, description, status, created_at, updated_at`,
    params
  );

  return r.rows[0] || null;
}

async function softDeleteRoute(routeId, adminId) {
  await assertRouteBelongsToAdmin(adminId, routeId);

  const r = await query(
    `UPDATE routes
     SET deleted_at = now(),
         status = 'inactive',
         updated_at = now()
     WHERE id = $1 AND admin_id = $2 AND deleted_at IS NULL
     RETURNING id`,
    [routeId, adminId]
  );
  return r.rows[0] || null;
}

async function getRouteClientsAdmin(adminId, routeId) {
  await assertRouteBelongsToAdmin(adminId, routeId);

  const r = await query(
    `SELECT
        c.id, c.admin_id, c.vendor_id, c.name, c.phone, c.doc_id, c.address, c.notes, c.status,
        rc.visit_order
     FROM route_clients rc
     JOIN clients c ON c.id = rc.client_id
     WHERE rc.route_id = $1
       AND rc.deleted_at IS NULL
       AND rc.is_active = true
       AND c.admin_id = $2
       AND c.deleted_at IS NULL
     ORDER BY rc.visit_order ASC`,
    [routeId, adminId]
  );

  return r.rows;
}

async function setRouteClients(adminId, routeId, clients) {
  await assertRouteBelongsToAdmin(adminId, routeId);

  if (!Array.isArray(clients)) throw new AppError(400, "VALIDATION_ERROR", "clients inválido");

  const db = await pool.connect();
  try {
    await db.query("BEGIN");

    // borramos el “set” anterior para evitar duplicados
    await db.query(`DELETE FROM route_clients WHERE route_id = $1`, [routeId]);

    // insert nuevo set
    for (const item of clients) {
      const clientId = item.client_id || item.id;
      const visitOrder = Number.isFinite(item.visit_order) ? item.visit_order : null;

      if (!clientId) continue;

      // validar cliente pertenece al admin
      const c = await db.query(
        `SELECT id FROM clients WHERE id = $1 AND admin_id = $2 AND deleted_at IS NULL`,
        [clientId, adminId]
      );
      if (!c.rows[0]) continue;

      await db.query(
        `INSERT INTO route_clients (route_id, client_id, visit_order, is_active)
         VALUES ($1,$2, COALESCE($3, 999999), true)`,
        [routeId, clientId, visitOrder]
      );
    }

    await db.query("COMMIT");
    return true;
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    db.release();
  }
}

async function reorderRouteClients(adminId, routeId, items) {
  await assertRouteBelongsToAdmin(adminId, routeId);
  if (!Array.isArray(items)) throw new AppError(400, "VALIDATION_ERROR", "items inválido");

  const db = await pool.connect();
  try {
    await db.query("BEGIN");

    for (const it of items) {
      const clientId = it.client_id || it.id;
      const visitOrder = toInt(it.visit_order, null);
      if (!clientId || visitOrder === null) continue;

      await db.query(
        `UPDATE route_clients
         SET visit_order = $3,
             updated_at = now()
         WHERE route_id = $1
           AND client_id = $2`,
        [routeId, clientId, visitOrder]
      );
    }

    await db.query("COMMIT");
    return true;
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    db.release();
  }
}

async function assignRouteToVendor(adminId, routeId, payload) {
  await assertRouteBelongsToAdmin(adminId, routeId);

  const vendorId = payload.vendor_id;
  const assignedDate = payload.assigned_date; // YYYY-MM-DD

  if (!vendorId) throw new AppError(400, "VALIDATION_ERROR", "vendor_id requerido");
  if (!assignedDate) throw new AppError(400, "VALIDATION_ERROR", "assigned_date requerido");

  // validar vendor
  const v = await query(
    `SELECT id, admin_id, status, deleted_at
     FROM vendors
     WHERE id = $1`,
    [vendorId]
  );
  const vendor = v.rows[0];
  if (!vendor || vendor.deleted_at) throw new AppError(400, "VALIDATION_ERROR", "vendor_id inválido");
  if (vendor.admin_id !== adminId) throw new AppError(403, "FORBIDDEN", "Vendor no pertenece a tu admin");
  if (String(vendor.status || "").toLowerCase() !== "active")
    throw new AppError(403, "FORBIDDEN", "Vendor inactivo");

  const db = await pool.connect();
  try {
    await db.query("BEGIN");

    // “cancelar” asignaciones anteriores en ese día para esa ruta (evita duplicados raros)
    await db.query(
      `UPDATE route_assignments
       SET deleted_at = now(),
           updated_at = now()
       WHERE admin_id = $1
         AND route_id = $2
         AND assigned_date = $3::date
         AND deleted_at IS NULL`,
      [adminId, routeId, assignedDate]
    );

    const ins = await db.query(
      `INSERT INTO route_assignments (admin_id, route_id, vendor_id, assigned_date, status, notes)
       VALUES ($1,$2,$3,$4::date,'assigned',$5)
       RETURNING id, admin_id, route_id, vendor_id, assigned_date, status, notes, created_at`,
      [adminId, routeId, vendorId, assignedDate, payload.notes || null]
    );

    await db.query("COMMIT");
    return ins.rows[0];
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    db.release();
  }
}

// ===== Vendor: ver ruta del día =====
async function getRouteDay(adminId, vendorId, dateStr) {
  const d = dateStr || new Date().toISOString().slice(0, 10);

  const assignmentRes = await query(
    `SELECT
        ra.id AS assignment_id,
        ra.admin_id,
        ra.route_id,
        ra.vendor_id,
        ra.assigned_date,
        ra.status,
        rt.name AS route_name
     FROM route_assignments ra
     JOIN routes rt ON rt.id = ra.route_id
     WHERE ra.admin_id = $1
       AND ra.vendor_id = $2
       AND ra.assigned_date = $3::date
       AND ra.deleted_at IS NULL
       AND rt.deleted_at IS NULL
       AND ra.status IN ('assigned','completed')
     ORDER BY ra.created_at DESC
     LIMIT 1`,
    [adminId, vendorId, d]
  );

  const assignment = assignmentRes.rows[0];
  if (!assignment) throw new AppError(404, "NOT_FOUND", "Ruta no encontrada");

  const clientsRes = await query(
    `
     WITH last_visit AS (
       SELECT DISTINCT ON (rv.client_id)
         rv.client_id, rv.visited, rv.note, rv.visited_at
       FROM route_visits rv
       WHERE rv.route_assignment_id = $1
       ORDER BY rv.client_id, rv.visited_at DESC
     )
     SELECT
       c.id,
       c.name,
       c.phone,
       c.address,
       rc.visit_order,
       COALESCE(lv.visited,false) AS visited,
       lv.note AS visit_note,
       lv.visited_at,

       -- totales por cobrar
       COALESCE(SUM(CASE WHEN i.due_date = $4::date THEN GREATEST(i.amount_due - i.amount_paid, 0) ELSE 0 END),0)::float8 AS due_today,
       COALESCE(SUM(CASE WHEN i.due_date < $4::date THEN GREATEST(i.amount_due - i.amount_paid, 0) ELSE 0 END),0)::float8 AS due_overdue,
       COALESCE(SUM(CASE WHEN i.due_date <= $4::date THEN GREATEST(i.amount_due - i.amount_paid, 0) ELSE 0 END),0)::float8 AS due_total

     FROM route_clients rc
     JOIN clients c ON c.id = rc.client_id
     LEFT JOIN last_visit lv ON lv.client_id = c.id

     LEFT JOIN credits cr
       ON cr.client_id = c.id
      AND cr.admin_id = $3
      AND cr.deleted_at IS NULL
      AND cr.status IN ('active','late')
      AND cr.balance_amount > 0

     LEFT JOIN installments i
       ON i.credit_id = cr.id
      AND i.status IN ('pending','late')
      AND (i.amount_due - i.amount_paid) > 0

     WHERE rc.route_id = $2
       AND rc.deleted_at IS NULL
       AND rc.is_active = true
       AND c.admin_id = $3
       AND c.deleted_at IS NULL

     GROUP BY
       c.id,
       c.name,
       c.phone,
       c.address,
       rc.visit_order,
       lv.visited,
       lv.note,
       lv.visited_at

     ORDER BY rc.visit_order ASC
    `,
    [assignment.assignment_id, assignment.route_id, adminId, d]
  );

  const clients = clientsRes.rows.map((row) => ({
    ...row,
    visited_at: row.visited_at ? new Date(row.visited_at).toISOString() : null,
  }));

  const totals = clients.reduce(
    (acc, c) => {
      acc.due_today += Number(c.due_today || 0);
      acc.due_overdue += Number(c.due_overdue || 0);
      acc.due_total += Number(c.due_total || 0);
      return acc;
    },
    { due_today: 0, due_overdue: 0, due_total: 0 }
  );

  return { assignment, totals, clients };
}

// ===== Vendor: marcar visita =====
async function createRouteVisit(adminId, vendorId, payload) {
  const { route_assignment_id, client_id, visited, note } = payload;

  // validar assignment pertenece a vendor
  const ra = await query(
    `SELECT id, admin_id, vendor_id, deleted_at
     FROM route_assignments
     WHERE id = $1`,
    [route_assignment_id]
  );
  const row = ra.rows[0];
  if (!row || row.deleted_at) throw new AppError(404, "NOT_FOUND", "Ruta no encontrada");
  if (row.admin_id !== adminId) throw new AppError(403, "FORBIDDEN", "Ruta no pertenece a tu admin");
  if (row.vendor_id !== vendorId) throw new AppError(403, "FORBIDDEN", "No asignado a este vendor");

  const ins = await query(
    `INSERT INTO route_visits (admin_id, route_assignment_id, client_id, visited, note)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING id, route_assignment_id, client_id, visited, note, visited_at`,
    [adminId, route_assignment_id, client_id, visited === true, note || null]
  );

  return ins.rows[0];
}
async function getRouteClientsAdmin(adminId, routeId) {
  const route = await getRouteById(routeId);
  if (!route || route.deleted_at) return null;
  if (route.admin_id !== adminId) return null;
  return listRouteClients(routeId);
}

module.exports = {
  listRoutes,
  createRoute,
  updateRoute,
  softDeleteRoute,
  getRouteClientsAdmin,
  setRouteClients,
  reorderRouteClients,
  assignRouteToVendor,
  getRouteDay,
  createRouteVisit,
};
