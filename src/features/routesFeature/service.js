const { pool, query } = require("../../db/pool");
const { AppError } = require("../../utils/appError");

async function assertRouteBelongsToAdmin(routeId, adminId) {
  const r = await query(
    `SELECT id, admin_id, deleted_at
     FROM routes
     WHERE id = $1
     LIMIT 1`,
    [routeId]
  );

  const row = r.rows[0];
  if (!row || row.deleted_at) throw new AppError(404, "NOT_FOUND", "Ruta no encontrada");
  if (row.admin_id !== adminId) throw new AppError(403, "FORBIDDEN", "Ruta no pertenece a tu admin");
  return row;
}

async function assertVendorBelongsToAdmin(vendorId, adminId) {
  const r = await query(
    `SELECT id, admin_id, status, deleted_at
     FROM vendors
     WHERE id = $1
     LIMIT 1`,
    [vendorId]
  );

  const row = r.rows[0];
  if (!row || row.deleted_at) throw new AppError(404, "NOT_FOUND", "Vendor no encontrado");
  if (row.admin_id !== adminId) throw new AppError(403, "FORBIDDEN", "Vendor no pertenece a tu admin");
  if (String(row.status || "").toLowerCase() !== "active") throw new AppError(403, "FORBIDDEN", "Vendor inactivo");
  return row;
}

async function getRouteClientsAdmin(adminId, routeId) {
  await assertRouteBelongsToAdmin(routeId, adminId);

  const r = await query(
    `SELECT
       c.id,
       c.admin_id,
       c.vendor_id,
       c.name,
       c.phone,
       c.address,
       c.status,
       rc.is_active,
       rc.created_at
     FROM route_clients rc
     JOIN clients c ON c.id = rc.client_id
     WHERE rc.route_id = $1
       AND rc.deleted_at IS NULL
       AND c.deleted_at IS NULL
     ORDER BY c.name ASC`,
    [routeId]
  );

  return r.rows;
}

async function listRoutes(adminId, { q, status, limit = 50, offset = 0 }) {
  const where = ["admin_id = $1", "deleted_at IS NULL"];
  const params = [adminId];
  let p = 1;

  if (status) {
    params.push(status);
    where.push(`status = $${++p}`);
  }

  if (q && q.trim() !== "") {
    params.push(`%${q.trim()}%`);
    where.push(`(name ILIKE $${++p} OR description ILIKE $${p})`);
  }

  // ⚠️ Importante:
  // Para evitar errores tipo "bind message supplies X parameters..."
  // NO mandamos limit/offset como parámetros $n.
  // En su lugar los incrustamos como enteros sanitizados.
  const limitN = Math.max(1, Math.min(200, Number(limit) || 50));
  const offsetN = Math.max(0, Number(offset) || 0);

  const itemsRes = await query(
    `SELECT
       id, admin_id, name, description, status, start_date, end_date, created_at, updated_at
     FROM routes
     WHERE ${where.join(" AND ")}
     ORDER BY created_at DESC
     LIMIT ${limitN} OFFSET ${offsetN}`,
    params
  );

  const totalRes = await query(
    `SELECT COUNT(*)::int AS total
     FROM routes
     WHERE ${where.join(" AND ")}`,
    params
  );

  return { items: itemsRes.rows, total: totalRes.rows[0]?.total || 0 };
}

async function createRoute(adminId, payload) {
  const r = await query(
    `INSERT INTO routes
      (admin_id, name, description, status, start_date, end_date)
     VALUES
      ($1,$2,$3,$4,$5,$6)
     RETURNING
      id, admin_id, name, description, status, start_date, end_date, created_at, updated_at`,
    [
      adminId,
      payload.name,
      payload.description || null,
      payload.status || "active",
      payload.start_date || null,
      payload.end_date || null
    ]
  );
  return r.rows[0];
}

async function updateRoute(adminId, routeId, payload) {
  await assertRouteBelongsToAdmin(routeId, adminId);

  const r = await query(
    `UPDATE routes
     SET name = COALESCE($3, name),
         description = COALESCE($4, description),
         status = COALESCE($5, status),
         start_date = COALESCE($6, start_date),
         end_date = COALESCE($7, end_date),
         updated_at = now()
     WHERE id = $1 AND admin_id = $2 AND deleted_at IS NULL
     RETURNING
      id, admin_id, name, description, status, start_date, end_date, created_at, updated_at`,
    [
      routeId,
      adminId,
      payload.name ?? null,
      payload.description ?? null,
      payload.status ?? null,
      payload.start_date ?? null,
      payload.end_date ?? null
    ]
  );

  const row = r.rows[0];
  if (!row) throw new AppError(404, "NOT_FOUND", "Ruta no encontrada");
  return row;
}

async function deleteRoute(adminId, routeId) {
  await assertRouteBelongsToAdmin(routeId, adminId);

  await query(
    `UPDATE routes
     SET deleted_at = now(),
         updated_at = now()
     WHERE id = $1 AND admin_id = $2 AND deleted_at IS NULL`,
    [routeId, adminId]
  );

  return { id: routeId };
}

async function addClientToRoute(adminId, routeId, clientId) {
  await assertRouteBelongsToAdmin(routeId, adminId);

  const c = await query(
    `SELECT id, admin_id, deleted_at
     FROM clients
     WHERE id = $1
     LIMIT 1`,
    [clientId]
  );
  const client = c.rows[0];
  if (!client || client.deleted_at) throw new AppError(404, "NOT_FOUND", "Cliente no encontrado");
  if (client.admin_id !== adminId) throw new AppError(403, "FORBIDDEN", "Cliente no pertenece a tu admin");

  await query(
    `INSERT INTO route_clients
      (admin_id, route_id, client_id, is_active)
     VALUES
      ($1,$2,$3,true)
     ON CONFLICT (route_id, client_id)
     DO UPDATE SET
       is_active = true,
       deleted_at = NULL,
       updated_at = now()`,
    [adminId, routeId, clientId]
  );

  return { route_id: routeId, client_id: clientId };
}

async function removeClientFromRoute(adminId, routeId, clientId) {
  await assertRouteBelongsToAdmin(routeId, adminId);

  await query(
    `UPDATE route_clients
     SET is_active = false,
         deleted_at = now(),
         updated_at = now()
     WHERE admin_id = $1
       AND route_id = $2
       AND client_id = $3
       AND deleted_at IS NULL`,
    [adminId, routeId, clientId]
  );

  return { route_id: routeId, client_id: clientId };
}

async function assignRouteToVendor(adminId, routeId, vendorId, payload) {
  await assertRouteBelongsToAdmin(routeId, adminId);
  await assertVendorBelongsToAdmin(vendorId, adminId);

  const assignedDate = payload.assigned_date;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // cerrar asignación anterior activa
    await client.query(
      `UPDATE route_assignments
       SET status = 'completed',
           completed_at = now(),
           updated_at = now()
       WHERE admin_id = $1
         AND route_id = $2
         AND deleted_at IS NULL
         AND status = 'assigned'`,
      [adminId, routeId]
    );

    // crear nueva asignación
    const r = await client.query(
      `INSERT INTO route_assignments
        (admin_id, route_id, vendor_id, assigned_date, status)
       VALUES
        ($1,$2,$3,$4,'assigned')
       RETURNING
        id, admin_id, route_id, vendor_id, assigned_date, status, created_at, updated_at`,
      [adminId, routeId, vendorId, assignedDate]
    );

    await client.query("COMMIT");
    return r.rows[0];
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function getVendorActiveAssignment(adminId, vendorId) {
  const r = await query(
    `SELECT ra.id, ra.route_id, ra.vendor_id, ra.status, ra.assigned_date, ra.created_at
     FROM route_assignments ra
     JOIN routes rt ON rt.id = ra.route_id
     WHERE ra.admin_id = $1
       AND ra.vendor_id = $2
       AND ra.deleted_at IS NULL
       AND rt.deleted_at IS NULL
       AND ra.status IN ('assigned','completed')
     ORDER BY ra.assigned_date DESC, ra.created_at DESC
     LIMIT 1`,
    [adminId, vendorId]
  );

  return r.rows[0] || null;
}

async function getRouteDay(auth, routeId) {
  // vendor ve solo su asignación actual/reciente
  const route = await query(
    `SELECT id, admin_id, deleted_at
     FROM routes
     WHERE id = $1
     LIMIT 1`,
    [routeId]
  );
  const rt = route.rows[0];
  if (!rt || rt.deleted_at) throw new AppError(404, "NOT_FOUND", "Ruta no encontrada");
  if (rt.admin_id !== auth.adminId) throw new AppError(403, "FORBIDDEN", "Ruta no pertenece a tu admin");

  if (auth.role === "vendor") {
    const assign = await getVendorActiveAssignment(auth.adminId, auth.vendorId);
    if (!assign || assign.route_id !== routeId) {
      throw new AppError(403, "FORBIDDEN", "Ruta no asignada a este vendor");
    }
  }

  const r = await query(
    `SELECT
       c.id,
       c.name,
       c.phone,
       c.address,
       c.vendor_id,
       rc.is_active
     FROM route_clients rc
     JOIN clients c ON c.id = rc.client_id
     WHERE rc.route_id = $1
       AND rc.deleted_at IS NULL
       AND rc.is_active = true
       AND c.deleted_at IS NULL
     ORDER BY c.name ASC`,
    [routeId]
  );

  return r.rows;
}

async function createRouteVisit(auth, routeId, payload) {
  const rt = await assertRouteBelongsToAdmin(routeId, auth.adminId);

  if (auth.role === "vendor") {
    const assign = await getVendorActiveAssignment(auth.adminId, auth.vendorId);
    if (!assign || assign.route_id !== routeId) {
      throw new AppError(403, "FORBIDDEN", "Ruta no asignada a este vendor");
    }
  }

  const r = await query(
    `INSERT INTO route_visits
      (admin_id, route_id, vendor_id, client_id, visited_at, lat, lng, note)
     VALUES
      ($1,$2,$3,$4,COALESCE($5, now()),$6,$7,$8)
     RETURNING
      id, admin_id, route_id, vendor_id, client_id, visited_at, lat, lng, note, created_at`,
    [
      auth.adminId,
      rt.id,
      auth.role === "vendor" ? auth.vendorId : (payload.vendor_id || null),
      payload.client_id,
      payload.visited_at || null,
      payload.lat || null,
      payload.lng || null,
      payload.note || null
    ]
  );

  return r.rows[0];
}

module.exports = {
  listRoutes,
  createRoute,
  updateRoute,
  deleteRoute,
  addClientToRoute,
  removeClientFromRoute,
  assignRouteToVendor,
  getRouteClientsAdmin,
  getRouteDay,
  createRouteVisit
};
