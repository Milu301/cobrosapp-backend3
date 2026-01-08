const { query, tx } = require("../../db");
const { ApiError } = require("../../apiError");

// =====================================================
// ROUTES
// =====================================================

async function listRoutes(adminId, { q, status, limit = 50, offset = 0 }) {
  const where = [`r.admin_id = $1`, `r.deleted_at IS NULL`];
  const params = [adminId];

  if (q && q.trim()) {
    params.push(`%${q.trim()}%`);
    where.push(`(r.name ILIKE $${params.length} OR r.description ILIKE $${params.length})`);
  }

  if (status && status.trim()) {
    params.push(status.trim());
    where.push(`r.status = $${params.length}`);
  }

  params.push(limit);
  params.push(offset);

  const sql = `
    SELECT
      r.id,
      r.name,
      r.description,
      r.status,
      r.created_at,
      r.updated_at
    FROM routes r
    WHERE ${where.join(" AND ")}
    ORDER BY r.created_at DESC
    LIMIT $${params.length - 1} OFFSET $${params.length}
  `;

  const res = await query(sql, params);
  return { items: res.rows, limit, offset };
}

async function createRoute(adminId, payload) {
  const sql = `
    INSERT INTO routes (admin_id, name, description, status)
    VALUES ($1, $2, $3, $4)
    RETURNING id, name, description, status, created_at, updated_at
  `;
  const res = await query(sql, [
    adminId,
    payload.name,
    payload.description || null,
    payload.status || "active",
  ]);
  return res.rows[0];
}

async function updateRoute(routeId, payload) {
  const sql = `
    UPDATE routes
    SET
      name = COALESCE($2, name),
      description = COALESCE($3, description),
      status = COALESCE($4, status),
      updated_at = NOW()
    WHERE id = $1 AND deleted_at IS NULL
    RETURNING id, name, description, status, created_at, updated_at
  `;
  const res = await query(sql, [
    routeId,
    payload.name ?? null,
    payload.description ?? null,
    payload.status ?? null,
  ]);
  return res.rows[0] || null;
}

async function deleteRoute(routeId) {
  const sql = `
    UPDATE routes
    SET deleted_at = NOW(), updated_at = NOW()
    WHERE id = $1 AND deleted_at IS NULL
    RETURNING id
  `;
  const res = await query(sql, [routeId]);
  return res.rows[0] || null;
}

async function listRouteClients(routeId) {
  const sql = `
    SELECT
      rc.id AS route_client_id,
      rc.client_id,
      rc.visit_order,
      rc.is_active,
      c.name,
      c.phone,
      c.doc_id,
      c.address,
      c.status
    FROM route_clients rc
    JOIN clients c ON c.id = rc.client_id
    WHERE rc.route_id = $1
      AND rc.deleted_at IS NULL
      AND c.deleted_at IS NULL
    ORDER BY rc.visit_order ASC
  `;
  const res = await query(sql, [routeId]);
  return res.rows;
}

async function setRouteClients(routeId, clients) {
  return tx(async (t) => {
    // desactiva todos
    await t.query(
      `UPDATE route_clients
       SET is_active = false, updated_at = NOW()
       WHERE route_id = $1 AND deleted_at IS NULL`,
      [routeId]
    );

    // upsert de los que vienen
    for (let i = 0; i < clients.length; i++) {
      const c = clients[i];
      const order = Number(c.visit_order ?? (i + 1));
      await t.query(
        `INSERT INTO route_clients (route_id, client_id, visit_order, is_active)
         VALUES ($1, $2, $3, true)
         ON CONFLICT (route_id, client_id)
         DO UPDATE SET visit_order = EXCLUDED.visit_order, is_active = true, updated_at = NOW()`,
        [routeId, c.client_id, order]
      );
    }

    const list = await t.query(
      `SELECT rc.client_id, rc.visit_order, rc.is_active
       FROM route_clients rc
       WHERE rc.route_id = $1 AND rc.deleted_at IS NULL
       ORDER BY rc.visit_order ASC`,
      [routeId]
    );

    return { items: list.rows };
  });
}

async function reorderRouteClients(routeId, items) {
  return tx(async (t) => {
    for (const it of items) {
      await t.query(
        `UPDATE route_clients
         SET visit_order = $2, updated_at = NOW()
         WHERE route_id = $1 AND client_id = $3 AND deleted_at IS NULL`,
        [routeId, Number(it.visit_order), it.client_id]
      );
    }
    const list = await t.query(
      `SELECT rc.client_id, rc.visit_order
       FROM route_clients rc
       WHERE rc.route_id = $1 AND rc.deleted_at IS NULL
       ORDER BY rc.visit_order ASC`,
      [routeId]
    );
    return { items: list.rows };
  });
}

async function assignRouteToVendor(adminId, routeId, payload) {
  const dateStr = payload.date;
  if (!dateStr) throw new ApiError("VALIDATION_ERROR", "date is required");

  const sql = `
    INSERT INTO route_assignments (admin_id, route_id, vendor_id, assigned_date, status, notes)
    VALUES ($1, $2, $3, $4::date, $5, $6)
    RETURNING id, admin_id, route_id, vendor_id, assigned_date, status, notes
  `;
  const res = await query(sql, [
    adminId,
    routeId,
    payload.vendor_id,
    dateStr,
    payload.status || "assigned",
    payload.notes || null,
  ]);
  return res.rows[0];
}

// =====================================================
// ✅ ROUTE DAY (AUTO) + COBROS DEL DÍA (POR DUE_DATE)
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

  // 3) clientes de la ruta, filtrados por cuotas "cobrables" (hoy o vencidas)
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
              'installment_no', i.installment_no,
              'due_date', to_char(i.due_date, 'YYYY-MM-DD'),
              'amount_due', i.amount_due::float8,
              'amount_paid', i.amount_paid::float8,
              'amount_remaining', GREATEST(i.amount_due - i.amount_paid, 0)::float8,
              'status', i.status,

              'remaining_installments', rem.remaining_installments,
              'kind', CASE WHEN i.due_date = $4::date THEN 'today' ELSE 'overdue' END
            )
            ORDER BY i.due_date ASC, i.installment_no ASC
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
      AND i.status IN ('pending','late')
      AND (i.amount_due - i.amount_paid) > 0
      AND i.due_date <= $4::date

     LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS remaining_installments
        FROM installments ii
        WHERE ii.credit_id = cr.id
          AND ii.status != 'paid'
     ) rem ON true

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

// ---- VISITS

async function createRouteVisit(adminId, payload) {
  const sql = `
    INSERT INTO route_visits (admin_id, route_assignment_id, client_id, visited, note)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id, route_assignment_id, client_id, visited, note, visited_at
  `;
  const res = await query(sql, [
    adminId,
    payload.route_assignment_id,
    payload.client_id,
    payload.visited === true,
    payload.note || null,
  ]);
  return res.rows[0];
}

module.exports = {
  listRoutes,
  createRoute,
  updateRoute,
  deleteRoute,
  listRouteClients,
  setRouteClients,
  reorderRouteClients,
  assignRouteToVendor,
  getRouteDay,
  createRouteVisit,
};
