const { pool, query } = require("../../db/pool");
const { AppError } = require("../../utils/appError");
const { toInt } = require("../../utils/numeric");
const { assertVendorActive } = require("../../utils/vendor");

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

async function getRouteById(routeId) {
  const r = await query(
    `SELECT id, admin_id, name, description, status, created_at, updated_at, deleted_at
     FROM routes
     WHERE id = $1`,
    [routeId]
  );
  return r.rows[0] || null;
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

async function listRouteClients(adminId, routeId) {
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

async function getRouteClientsAdmin(adminId, routeId) {
  await assertRouteBelongsToAdmin(adminId, routeId);
  return listRouteClients(adminId, routeId);
}

async function setRouteClients(adminId, routeId, clients) {
  await assertRouteBelongsToAdmin(adminId, routeId);

  if (!Array.isArray(clients)) throw new AppError(400, "VALIDATION_ERROR", "clients inválido");

  const validItems = clients
    .map(item => ({
      clientId: item.client_id || item.id,
      visitOrder: Number.isFinite(item.visit_order) ? item.visit_order : 999999,
    }))
    .filter(item => !!item.clientId);

  const db = await pool.connect();
  try {
    await db.query("BEGIN");

    await db.query(`DELETE FROM route_clients WHERE route_id = $1`, [routeId]);

    if (validItems.length > 0) {
      // Validate all client IDs in a single query instead of one per item
      const validRes = await db.query(
        `SELECT id FROM clients WHERE id = ANY($1::uuid[]) AND admin_id = $2 AND deleted_at IS NULL`,
        [validItems.map(i => i.clientId), adminId]
      );
      const validSet = new Set(validRes.rows.map(r => r.id));
      const toInsert = validItems.filter(i => validSet.has(i.clientId));

      if (toInsert.length > 0) {
        await db.query(
          `INSERT INTO route_clients (route_id, client_id, visit_order, is_active)
           SELECT $1, c, v, true
           FROM unnest($2::uuid[], $3::int[]) AS t(c, v)`,
          [routeId, toInsert.map(i => i.clientId), toInsert.map(i => i.visitOrder)]
        );
      }
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
  const assignedDate = payload.assigned_date;

  if (!vendorId) throw new AppError(400, "VALIDATION_ERROR", "vendor_id requerido");
  if (!assignedDate) throw new AppError(400, "VALIDATION_ERROR", "assigned_date requerido");

  await assertVendorActive(vendorId, adminId);

  const db = await pool.connect();
  try {
    await db.query("BEGIN");

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
        ra.created_at,
        ra.updated_at,
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

  const assignment = assignmentRes.rows[0] || null;
  // No lanzar 404: si no hay ruta manual, mostrar cobros automáticos del día

  let routeClients = [];

  if (assignment) {
    // Clientes de la ruta asignada manualmente
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

         COALESCE(SUM(CASE WHEN i.due_date = $4::date THEN GREATEST(i.amount_due - i.amount_paid, 0) ELSE 0 END),0)::float8 AS due_today,
         COALESCE(SUM(CASE WHEN i.due_date < $4::date THEN GREATEST(i.amount_due - i.amount_paid, 0) ELSE 0 END),0)::float8 AS due_overdue,
         COALESCE(SUM(CASE WHEN i.due_date <= $4::date THEN GREATEST(i.amount_due - i.amount_paid, 0) ELSE 0 END),0)::float8 AS due_total,
         BOOL_OR(cr.payment_frequency = 'weekly') AS has_weekly_credits

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
         c.id, c.name, c.phone, c.address,
         rc.visit_order, lv.visited, lv.note, lv.visited_at

       HAVING COALESCE(SUM(CASE WHEN i.due_date <= $4::date THEN GREATEST(i.amount_due - i.amount_paid, 0) ELSE 0 END), 0) > 0

       ORDER BY rc.visit_order ASC
      `,
      [assignment.assignment_id, assignment.route_id, adminId, d]
    );

    routeClients = clientsRes.rows.map((row) => ({
      ...row,
      visited_at: row.visited_at ? new Date(row.visited_at).toISOString() : null,
      deferred: false,
      auto: false,
    }));
  }

  // ── Cobros automáticos: todos los clientes del vendor con cuotas vencidas o de hoy ──
  const autoRes = await query(
    `SELECT
       c.id, c.name, c.phone, c.address,
       9999 AS visit_order,
       false AS visited,
       NULL AS visit_note,
       NULL AS visited_at,
       COALESCE(SUM(CASE WHEN i.due_date = $3::date THEN GREATEST(i.amount_due - i.amount_paid, 0) ELSE 0 END),0)::float8 AS due_today,
       COALESCE(SUM(CASE WHEN i.due_date < $3::date  THEN GREATEST(i.amount_due - i.amount_paid, 0) ELSE 0 END),0)::float8 AS due_overdue,
       COALESCE(SUM(CASE WHEN i.due_date <= $3::date THEN GREATEST(i.amount_due - i.amount_paid, 0) ELSE 0 END),0)::float8 AS due_total,
       BOOL_OR(cr.payment_frequency = 'weekly') AS has_weekly_credits
     FROM credits cr
     JOIN clients c ON c.id = cr.client_id
       AND c.admin_id = $1 AND c.deleted_at IS NULL
     JOIN installments i ON i.credit_id = cr.id
       AND i.status IN ('pending','late')
       AND (i.amount_due - i.amount_paid) > 0
       AND i.due_date <= $3::date
     WHERE (cr.vendor_id = $2 OR c.vendor_id = $2)
       AND cr.admin_id = $1
       AND cr.deleted_at IS NULL
       AND cr.status IN ('active','late')
       AND cr.balance_amount > 0
     GROUP BY c.id, c.name, c.phone, c.address
     ORDER BY
       MAX(CASE WHEN i.due_date < $3::date THEN 1 ELSE 0 END) DESC,
       c.name ASC`,
    [adminId, vendorId, d]
  );

  // Mezclar: los de ruta manual tienen prioridad (mantienen estado de visita)
  const routeIds = new Set(routeClients.map((c) => c.id));
  const autoClients = autoRes.rows
    .filter((c) => !routeIds.has(c.id))
    .map((row) => ({
      ...row,
      visited_at: null,
      deferred: false,
      auto: true,
    }));

  let allClients = [...routeClients, ...autoClients];

  // Clientes diferidos
  const deferredRes = await query(
    `SELECT
       c.id, c.name, c.phone, c.address,
       999999 AS visit_order,
       false AS visited, NULL AS visit_note, NULL AS visited_at,
       COALESCE(SUM(CASE WHEN i.due_date = $3::date THEN GREATEST(i.amount_due - i.amount_paid, 0) ELSE 0 END),0)::float8 AS due_today,
       COALESCE(SUM(CASE WHEN i.due_date < $3::date  THEN GREATEST(i.amount_due - i.amount_paid, 0) ELSE 0 END),0)::float8 AS due_overdue,
       COALESCE(SUM(CASE WHEN i.due_date <= $3::date THEN GREATEST(i.amount_due - i.amount_paid, 0) ELSE 0 END),0)::float8 AS due_total,
       BOOL_OR(cr.payment_frequency = 'weekly') AS has_weekly_credits,
       true AS deferred
     FROM vendor_deferred_clients vdc
     JOIN clients c ON c.id = vdc.client_id AND c.admin_id = $2 AND c.deleted_at IS NULL
     LEFT JOIN credits cr
       ON cr.client_id = c.id AND cr.admin_id = $2 AND cr.deleted_at IS NULL
       AND cr.status IN ('active','late') AND cr.balance_amount > 0
     LEFT JOIN installments i
       ON i.credit_id = cr.id AND i.status IN ('pending','late')
       AND (i.amount_due - i.amount_paid) > 0
     WHERE vdc.vendor_id = $1 AND vdc.admin_id = $2
       AND vdc.for_date = $3::date AND vdc.deleted_at IS NULL
     GROUP BY c.id, c.name, c.phone, c.address`,
    [vendorId, adminId, d]
  );

  const allIds = new Set(allClients.map((c) => c.id));
  const deferred = deferredRes.rows
    .filter((c) => !allIds.has(c.id))
    .map((row) => ({ ...row, visited_at: null, auto: false }));

  allClients = [...allClients, ...deferred];

  const baseTotals = allClients.reduce(
    (acc, c) => {
      acc.due_today   += Number(c.due_today   || 0);
      acc.due_overdue += Number(c.due_overdue || 0);
      acc.due_total   += Number(c.due_total   || 0);
      return acc;
    },
    { due_today: 0, due_overdue: 0, due_total: 0 }
  );

  // ── Extra stats: payments, cash movements, per-client credit enrichment ──
  const allClientIds = allClients.map((c) => c.id);

  const [payStats, cashStats, creditRows, portfolioRow] = await Promise.all([
    // Payment totals for today
    query(
      `SELECT
         COALESCE(SUM(p.amount), 0)::float8 AS paid_today,
         COUNT(p.id)::int AS paid_count,
         COALESCE(SUM(CASE WHEN p.method = 'cash' THEN p.amount ELSE 0 END), 0)::float8 AS cash_collected,
         COALESCE(SUM(CASE WHEN p.method IS DISTINCT FROM 'cash' AND p.method IS NOT NULL THEN p.amount ELSE 0 END), 0)::float8 AS transfer_collected
       FROM payments p
       WHERE p.admin_id = $1 AND p.vendor_id = $2
         AND p.paid_at >= ($3::date)::timestamp
         AND p.paid_at <  (($3::date + 1)::timestamp)`,
      [adminId, vendorId, d]
    ),
    // Cash movements income / expenses
    query(
      `SELECT
         COALESCE(SUM(CASE WHEN movement_type='income'  THEN amount ELSE 0 END), 0)::float8 AS income,
         COALESCE(SUM(CASE WHEN movement_type='expense' THEN amount ELSE 0 END), 0)::float8 AS expenses
       FROM vendor_cash_movements
       WHERE admin_id = $1 AND vendor_id = $2
         AND occurred_at::date = $3::date
         AND deleted_at IS NULL`,
      [adminId, vendorId, d]
    ),
    // Per-client: most relevant active credit + today's payment
    allClientIds.length > 0
      ? query(
          `SELECT DISTINCT ON (cr.client_id)
             cr.client_id,
             cr.id AS credit_id,
             cr.payment_frequency AS frequency,
             cr.balance_amount::float8 AS credit_balance,
             COALESCE(cr.total_amount, cr.principal_amount, 0)::float8 AS credit_total,
             (
               SELECT COUNT(*)::int FROM installments i2
               WHERE i2.credit_id = cr.id AND i2.status IN ('pending','late')
             ) AS remaining_installments,
             pay.amount::float8 AS amount_paid,
             pay.method AS payment_method,
             pay.paid_at,
             (pay.id IS NULL) AS no_payment
           FROM credits cr
           LEFT JOIN LATERAL (
             SELECT id, amount, method, paid_at
             FROM payments pp
             WHERE pp.credit_id = cr.id
               AND pp.paid_at >= ($3::date)::timestamp
               AND pp.paid_at <  (($3::date + 1)::timestamp)
             ORDER BY pp.paid_at DESC LIMIT 1
           ) pay ON true
           WHERE cr.admin_id = $1
             AND cr.client_id = ANY($2::uuid[])
             AND cr.deleted_at IS NULL
             AND cr.status IN ('active','late')
           ORDER BY cr.client_id, pay.paid_at DESC NULLS LAST, cr.created_at DESC`,
          [adminId, allClientIds, d]
        )
      : Promise.resolve({ rows: [] }),
    // Vendor portfolio total (initial portfolio)
    query(
      `SELECT COALESCE(SUM(cr.balance_amount), 0)::float8 AS initial_portfolio
       FROM credits cr
       JOIN clients c ON c.id = cr.client_id
       WHERE cr.admin_id = $1
         AND (cr.vendor_id = $2 OR c.vendor_id = $2)
         AND cr.deleted_at IS NULL
         AND cr.status IN ('active','late')`,
      [adminId, vendorId]
    ),
  ]);

  // Build lookup map: client_id → credit+payment info
  const creditMap = {};
  for (const row of creditRows.rows) {
    creditMap[row.client_id] = row;
  }

  // Enrich each client with credit and payment data
  const enrichedClients = allClients.map((c) => {
    const cr = creditMap[c.id] || {};
    return {
      ...c,
      credit_id:              cr.credit_id              || null,
      consecutivo:            cr.credit_id              || c.id,
      frequency:              cr.frequency              || null,
      credit_balance:         cr.credit_balance         ?? null,
      credit_total:           cr.credit_total           ?? null,
      remaining_installments: cr.remaining_installments ?? null,
      amount_paid:            cr.amount_paid            ?? null,
      payment_method:         cr.payment_method         || null,
      paid_at:                cr.paid_at ? new Date(cr.paid_at).toISOString() : null,
      no_payment:             !cr.credit_id ? true : !!cr.no_payment,
    };
  });

  const ps = payStats.rows[0]    || {};
  const cs = cashStats.rows[0]   || {};
  const pr = portfolioRow.rows[0] || {};

  const paidCount   = parseInt(ps.paid_count) || 0;
  const noPaidCount = Math.max(0, allClients.length - paidCount);

  const enrichedTotals = {
    ...baseTotals,
    paid_today:        Number(ps.paid_today)        || 0,
    paid_count:        paidCount,
    no_paid_count:     noPaidCount,
    cash_collected:    Number(ps.cash_collected)    || 0,
    transfer_collected:Number(ps.transfer_collected)|| 0,
  };

  const startTime = assignment?.created_at ? new Date(assignment.created_at).toISOString() : null;
  const closeTime = assignment?.status === 'completed' && assignment?.updated_at
    ? new Date(assignment.updated_at).toISOString()
    : null;

  const initialPortfolio = Number(pr.initial_portfolio) || 0;

  return {
    assignment,
    totals:   enrichedTotals,
    clients:  enrichedClients,
    // LiqDiaria root fields
    start_time:        startTime,
    close_time:        closeTime,
    total_clients:     allClients.length,
    initial_clients:   allClients.length,
    synced_clients:    allClients.length,
    initial_portfolio: initialPortfolio,
    income:            Number(cs.income)   || 0,
    expenses:          Number(cs.expenses) || 0,
    withdrawals:       0,
    // Placeholder fields (require additional schema tracking)
    new_clients:       0,
    renewed_clients:   0,
    deferred_next_day: 0,
    cancelled_clients: 0,
    initial_cash:      0,
    final_cash:        0,
    final_portfolio:   initialPortfolio,
    sales:             0,
    sales_interest:    0,
    penalty:           0,
  };
}

async function createRouteVisit(adminId, vendorId, payload) {
  const { route_assignment_id, client_id, visited, note } = payload;

  if (route_assignment_id) {
    // Visita de ruta manual — validar asignación y persistir
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
       ON CONFLICT (route_assignment_id, client_id)
       DO UPDATE SET visited=$4, note=$5, visited_at=now()
       RETURNING id, route_assignment_id, client_id, visited, note, visited_at`,
      [adminId, route_assignment_id, client_id, visited === true, note || null]
    );
    return ins.rows[0];
  }

  // Visita automática (sin ruta asignada) — solo confirmar, no persiste en route_visits
  return { route_assignment_id: null, client_id, visited: visited === true, note: note || null, visited_at: new Date().toISOString() };
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
  getRouteById,
};
