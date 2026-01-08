const { pool, query } = require("../../db/pool");
const { AppError } = require("../../utils/appError");

// ------------------------------
// Helpers
// ------------------------------
async function withTx(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function assertRouteBelongsToAdmin(adminId, routeId) {
  const r = await query(
    `SELECT id, admin_id, status, deleted_at
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

async function assertVendorBelongsToAdmin(adminId, vendorId) {
  const r = await query(
    `SELECT id, admin_id, status, deleted_at
     FROM vendors
     WHERE id = $1
     LIMIT 1`,
    [vendorId]
  );
  const v = r.rows[0];
  if (!v || v.deleted_at) throw new AppError(404, "NOT_FOUND", "Vendor no encontrado");
  if (v.admin_id !== adminId) throw new AppError(403, "FORBIDDEN", "Vendor no pertenece a tu admin");
  if (String(v.status || "").toLowerCase() !== "active") throw new AppError(403, "FORBIDDEN", "Vendor inactivo");
  return v;
}

// =====================================================
// ROUTES (ADMIN)
// =====================================================

async function listRoutes(adminId, { q, status, limit = 50, offset = 0 }) {
  const where = [`r.admin_id = $1`, `r.deleted_at IS NULL`];
  const params = [adminId];
  let idx = 1;

  if (q && q.trim()) {
    params.push(`%${q.trim()}%`);
    where.push(`(r.name ILIKE $${++idx} OR r.description ILIKE $${idx})`);
  }

  if (status && String(status).trim()) {
    params.push(String(status).trim());
    where.push(`r.status = $${++idx}`);
  }

  // items
  params.push(Number(limit));
  params.push(Number(offset));

  const itemsRes = await query(
    `
    SELECT r.id, r.name, r.description, r.status, r.created_at, r.updated_at
    FROM routes r
    WHERE ${where.join(" AND ")}
    ORDER BY r.created_at DESC
    LIMIT $${idx + 1} OFFSET $${idx + 2}
    `,
    params
  );

  // total
  const totalRes = await query(
    `
    SELECT COUNT(*)::int AS total
    FROM routes r
    WHERE ${where.join(" AND ")}
    `,
    params.slice(0, idx + 1)
  );

  return { items: itemsRes.rows, total: totalRes.rows[0]?.total || 0, limit, offset };
}

async function createRoute(adminId, payload) {
  const res = await query(
    `
    INSERT INTO routes (admin_id, name, description, status)
    VALUES ($1, $2, $3, $4)
    RETURNING id, admin_id, name, description, status, created_at, updated_at
    `,
    [adminId, payload.name, payload.description ?? null, payload.status ?? "active"]
  );
  return res.rows[0];
}

async function updateRoute(routeId, adminId, patch) {
  await assertRouteBelongsToAdmin(adminId, routeId);

  const allowed = ["name", "description", "status"];
  const sets = [];
  const params = [];
  let i = 0;

  for (const k of allowed) {
    if (patch[k] === undefined) continue;
    params.push(patch[k]);
    sets.push(`${k} = $${++i}`);
  }

  if (sets.length === 0) throw new AppError(400, "VALIDATION_ERROR", "Nada para actualizar");

  params.push(routeId);
  params.push(adminId);

  const r = await query(
    `
    UPDATE routes
    SET ${sets.join(", ")}, updated_at = NOW()
    WHERE id = $${++i} AND admin_id = $${++i} AND deleted_at IS NULL
    RETURNING id, admin_id, name, description, status, created_at, updated_at
    `,
    params
  );

  return r.rows[0] || null;
}

async function softDeleteRoute(routeId, adminId) {
  await assertRouteBelongsToAdmin(adminId, routeId);

  const r = await query(
    `
    UPDATE routes
    SET deleted_at = NOW(), status = 'inactive', updated_at = NOW()
    WHERE id = $1 AND admin_id = $2 AND deleted_at IS NULL
    RETURNING id
    `,
    [routeId, adminId]
  );

  return r.rows[0] || null;
}

// ✅ ADMIN: GET /routes/:routeId/clients
async function getRouteClientsAdmin(adminId, routeId) {
  await assertRouteBelongsToAdmin(adminId, routeId);

  const res = await query(
    `
    SELECT
      rc.id AS route_client_id,
      rc.route_id,
      rc.client_id,
      rc.visit_order,
      rc.is_active,
      c.name,
      c.phone,
      c.doc_id,
      c.address,
      c.notes,
      c.status AS client_status,
      c.vendor_id
    FROM route_clients rc
    JOIN clients c ON c.id = rc.client_id
    WHERE rc.route_id = $1
      AND rc.deleted_at IS NULL
      AND c.deleted_at IS NULL
      AND c.admin_id = $2
    ORDER BY rc.visit_order ASC
    `,
    [routeId, adminId]
  );

  return res.rows;
}

// ADMIN: SET clients
async function setRouteClients(adminId, routeId, clients) {
  await assertRouteBelongsToAdmin(adminId, routeId);

  return withTx(async (t) => {
    // desactivar todos (sin borrar)
    await t.query(
      `
      UPDATE route_clients
      SET is_active = false, updated_at = NOW()
      WHERE route_id = $1 AND deleted_at IS NULL
      `,
      [routeId]
    );

    for (let i = 0; i < clients.length; i++) {
      const c = clients[i];
      const order = Number(c.visit_order ?? (i + 1));

      // ✅ OJO: usamos WHERE deleted_at IS NULL para que Postgres use el índice unique parcial
      await t.query(
        `
        INSERT INTO route_clients (route_id, client_id, visit_order, is_active)
        VALUES ($1, $2, $3, true)
        ON CONFLICT (route_id, client_id)
        WHERE deleted_at IS NULL
        DO UPDATE SET
          visit_order = EXCLUDED.visit_order,
          is_active = true,
          updated_at = NOW()
        `,
        [routeId, c.client_id, order]
      );
    }

    return true;
  });
}

// ADMIN: REORDER
async function reorderRouteClients(adminId, routeId, items) {
  await assertRouteBelongsToAdmin(adminId, routeId);

  return withTx(async (t) => {
    for (const it of items) {
      await t.query(
        `
        UPDATE route_clients
        SET visit_order = $2, updated_at = NOW()
        WHERE route_id = $1
          AND client_id = $3
          AND deleted_at IS NULL
        `,
        [routeId, Number(it.visit_order), it.client_id]
      );
    }
    return true;
  });
}

// ADMIN: ASSIGN route to vendor
async function assignRouteToVendor(adminId, routeId, payload) {
  await assertRouteBelongsToAdmin(adminId, routeId);
  await assertVendorBelongsToAdmin(adminId, payload.vendor_id);

  // schema manda assigned_date, pero por si acaso soportamos date
  const dateStr = payload.assigned_date || payload.date;
  if (!dateStr) throw new AppError(400, "VALIDATION_ERROR", "assigned_date es requerido");

  // schema usa "canceled" y DB usa "cancelled"
  let st = payload.status || "assigned";
  if (st === "canceled") st = "cancelled";

  const res = await query(
    `
    INSERT INTO route_assignments (admin_id, route_id, vendor_id, assigned_date, status, notes)
    VALUES ($1, $2, $3, $4::date, $5, $6)
    RETURNING id, admin_id, route_id, vendor_id, assigned_date, status, notes, created_at
    `,
    [adminId, routeId, payload.vendor_id, dateStr, st, payload.notes ?? null]
  );

  return res.rows[0];
}

// =====================================================
// VENDOR: ROUTE DAY + VISITS
// =====================================================

async function getRouteDay(adminId, vendorId, dateStr) {
  // 1) buscar asignación explícita para el día
  let a = await query(
    `SELECT
        ra.id AS assignment_id,
        ra.assigned_date,
        ra.status AS assignment_status,
        ra.notes AS assignment_notes,
        r.id AS route_id,
        r.name AS route_name,
        r.description AS route_description
     FROM route_assignments ra
     JOIN routes r ON r.id = ra.route_id
     WHERE ra.admin_id = $1
       AND ra.vendor_id = $2
       AND ra.assigned_date = $3::date
       AND ra.deleted_at IS NULL
       AND r.deleted_at IS NULL
     LIMIT 1`,
    [adminId, vendorId, dateStr]
  );

  // 2) si no existe, auto-crear desde la última asignación del vendedor
  if (!a.rows[0]) {
    a = await query(
      `WITH latest AS (
          SELECT route_id
          FROM route_assignments
          WHERE admin_id = $1
            AND vendor_id = $2
            AND deleted_at IS NULL
          ORDER BY assigned_date DESC
          LIMIT 1
        ),
        ins AS (
          INSERT INTO route_assignments (admin_id, route_id, vendor_id, assigned_date, status, notes)
          SELECT $1, route_id, $2, $3::date, 'assigned', 'Auto asignada'
          FROM latest
          WHERE route_id IS NOT NULL
          RETURNING id
        )
        SELECT
          ra.id AS assignment_id,
          ra.assigned_date,
          ra.status AS assignment_status,
          ra.notes AS assignment_notes,
          r.id AS route_id,
          r.name AS route_name,
          r.description AS route_description
        FROM route_assignments ra
        JOIN routes r ON r.id = ra.route_id
        WHERE ra.id = (SELECT id FROM ins)
        LIMIT 1`,
      [adminId, vendorId, dateStr]
    );
  }

  const assignment = a.rows[0];
  if (!assignment) return null;

  // 3) clientes cobrables del día (hoy o vencidas)
  const clientsRes = await query(
    `SELECT
        c.id,
        c.name,
        c.phone,
        c.doc_id,
        c.address,
        c.notes,
        c.status,
        rc.visit_order,

        lv.visited,
        lv.note AS last_note,
        lv.visited_at AS last_visited_at,

        COALESCE(SUM(CASE
          WHEN i.due_date = $4::date THEN GREATEST(i.amount_due - i.amount_paid, 0)
          ELSE 0
        END), 0)::float8 AS due_today,

        COALESCE(SUM(CASE
          WHEN i.due_date < $4::date THEN GREATEST(i.amount_due - i.amount_paid, 0)
          ELSE 0
        END), 0)::float8 AS due_overdue,

        COALESCE(SUM(CASE
          WHEN i.due_date <= $4::date THEN GREATEST(i.amount_due - i.amount_paid, 0)
          ELSE 0
        END), 0)::float8 AS due_total,

        MIN(i.due_date) FILTER (WHERE i.id IS NOT NULL) AS next_due_date,

        COALESCE(
          json_agg(
            json_build_object(
              'credit_id', cr.id,
              'currency_code', cr.currency_code,
              'interest_rate', cr.interest_rate::float8,
              'credit_status', cr.status,
              'credit_balance', cr.balance_amount::float8,

              'installment_id', i.id,
              'installment_no', COALESCE(i.installment_number, i.installment_no),
              'due_date', to_char(i.due_date, 'YYYY-MM-DD'),
              'amount_due', i.amount_due::float8,
              'amount_paid', i.amount_paid::float8,
              'amount_remaining', GREATEST(i.amount_due - i.amount_paid, 0)::float8,
              'status', i.status,

              'kind', CASE WHEN i.due_date = $4::date THEN 'today' ELSE 'overdue' END
            )
            ORDER BY i.due_date ASC, COALESCE(i.installment_number, i.installment_no) ASC
          ) FILTER (WHERE i.id IS NOT NULL),
          '[]'::json
        ) AS due_items

     FROM route_clients rc
     JOIN clients c ON c.id = rc.client_id

     LEFT JOIN LATERAL (
        SELECT visited, note, visited_at
        FROM route_visits rv
        WHERE rv.route_assignment_id = $1 AND rv.client_id = c.id
        ORDER BY rv.visited_at DESC
        LIMIT 1
     ) lv ON true

     LEFT JOIN credits cr
       ON cr.client_id = c.id
      AND cr.admin_id = $3
      AND cr.deleted_at IS NULL
      AND cr.status IN ('active','late')
      AND cr.balance_amount > 0

     LEFT JOIN installments i
       ON i.credit_id = cr.id
      AND (i.deleted_at IS NULL OR i.deleted_at IS NULL)
      AND i.status IN ('pending','late')
      AND (i.amount_due - i.amount_paid) > 0
      AND i.due_date <= $4::date

     WHERE rc.route_id = $2
       AND rc.deleted_at IS NULL
       AND rc.is_active = true
       AND c.admin_id = $3
       AND c.deleted_at IS NULL

     GROUP BY
       c.id,
       rc.visit_order,
       lv.visited,
       lv.note,
       lv.visited_at

     HAVING COALESCE(SUM(CASE
       WHEN i.due_date <= $4::date THEN GREATEST(i.amount_due - i.amount_paid, 0)
       ELSE 0
     END), 0) > 0

     ORDER BY rc.visit_order ASC`,
    [assignment.assignment_id, assignment.route_id, adminId, dateStr]
  );

  const clients = clientsRes.rows.map((row) => ({
    ...row,
    next_due_date: row.next_due_date ? row.next_due_date.toISOString().slice(0, 10) : null
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

// VENDOR: create visit
async function createRouteVisit(adminId, vendorId, payload) {
  // validar assignment pertenece a ese vendor y admin
  const a = await query(
    `
    SELECT id, admin_id, vendor_id
    FROM route_assignments
    WHERE id = $1 AND deleted_at IS NULL
    LIMIT 1
    `,
    [payload.route_assignment_id]
  );
  const asg = a.rows[0];
  if (!asg) throw new AppError(404, "NOT_FOUND", "Asignación no encontrada");
  if (asg.admin_id !== adminId) throw new AppError(403, "FORBIDDEN", "Asignación no pertenece a tu admin");
  if (asg.vendor_id !== vendorId) throw new AppError(403, "FORBIDDEN", "Asignación no pertenece a este vendor");

  const visitedAt = payload.visited_at ? new Date(payload.visited_at) : null;

  const res = await query(
    `
    INSERT INTO route_visits (admin_id, route_assignment_id, client_id, vendor_id, visited, note, visited_at)
    VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, now()))
    RETURNING id, route_assignment_id, client_id, vendor_id, visited, note, visited_at, created_at
    `,
    [
      adminId,
      payload.route_assignment_id,
      payload.client_id,
      vendorId,
      payload.visited === true,
      payload.note ?? null,
      visitedAt
    ]
  );

  return res.rows[0];
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
  createRouteVisit
};
