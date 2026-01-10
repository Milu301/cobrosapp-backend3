const { query } = require("../../db/pool");
const { AppError } = require("../../utils/appError");

function toDateOnly(d) {
  if (!d) return null;
  if (typeof d === "string") return d.slice(0, 10);
  return new Date(d).toISOString().slice(0, 10);
}

async function getAdminDashboardSummary(adminId, { from, to }) {
  const fromDate = toDateOnly(from);
  const toDate = toDateOnly(to);

  const clientsRes = await query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE status = 'active')::int AS active,
       COUNT(*) FILTER (WHERE status = 'inactive')::int AS inactive
     FROM clients
     WHERE admin_id = $1 AND deleted_at IS NULL`,
    [adminId]
  );

  const creditsRes = await query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE status IN ('active','late'))::int AS open,
       COUNT(*) FILTER (WHERE status = 'paid')::int AS paid,
       COALESCE(SUM(balance_amount),0)::float8 AS total_balance
     FROM credits
     WHERE admin_id = $1 AND deleted_at IS NULL`,
    [adminId]
  );

  let paymentsSql = `
    SELECT COALESCE(SUM(amount),0)::float8 AS total_paid
    FROM payments
    WHERE admin_id = $1
  `;
  const payParams = [adminId];
  if (fromDate) {
    payParams.push(fromDate);
    paymentsSql += ` AND paid_at >= $${payParams.length}::timestamptz`;
  }
  if (toDate) {
    payParams.push(toDate);
    paymentsSql += ` AND paid_at < ($${payParams.length}::date + INTERVAL '1 day')`;
  }

  const paymentsRes = await query(paymentsSql, payParams);

  return {
    clients: clientsRes.rows[0],
    credits: creditsRes.rows[0],
    payments: paymentsRes.rows[0],
  };
}

async function getAdminDailyCollections(adminId, { date }) {
  const dateStr = toDateOnly(date) || new Date().toISOString().slice(0, 10);

  const paidRes = await query(
    `SELECT COALESCE(SUM(amount),0)::float8 AS collected_today
     FROM payments
     WHERE admin_id = $1
       AND paid_at >= $2::date
       AND paid_at < ($2::date + INTERVAL '1 day')`,
    [adminId, dateStr]
  );

  const dueRes = await query(
    `SELECT
       COALESCE(SUM(CASE WHEN i.due_date = $2::date THEN GREATEST(i.amount_due - i.amount_paid, 0) ELSE 0 END),0)::float8 AS due_today,
       COALESCE(SUM(CASE WHEN i.due_date < $2::date THEN GREATEST(i.amount_due - i.amount_paid, 0) ELSE 0 END),0)::float8 AS due_overdue
     FROM credits c
     JOIN installments i ON i.credit_id = c.id
     WHERE c.admin_id = $1
       AND c.deleted_at IS NULL
       AND c.status IN ('active','late')
       AND i.status IN ('pending','late')
       AND (i.amount_due - i.amount_paid) > 0`,
    [adminId, dateStr]
  );

  return {
    date: dateStr,
    collected_today: paidRes.rows[0]?.collected_today || 0,
    due_today: dueRes.rows[0]?.due_today || 0,
    due_overdue: dueRes.rows[0]?.due_overdue || 0,
  };
}

async function getAdminMonthlyTrends(adminId, { from, to }) {
  const fromDate = toDateOnly(from);
  const toDate = toDateOnly(to);

  let paymentsSql = `
    SELECT
      to_char(date_trunc('day', paid_at), 'YYYY-MM-DD') AS day,
      COALESCE(SUM(amount),0)::float8 AS collected
    FROM payments
    WHERE admin_id = $1
  `;
  const params = [adminId];

  if (fromDate) {
    params.push(fromDate);
    paymentsSql += ` AND paid_at >= $${params.length}::timestamptz`;
  }
  if (toDate) {
    params.push(toDate);
    paymentsSql += ` AND paid_at < ($${params.length}::date + INTERVAL '1 day')`;
  }

  paymentsSql += ` GROUP BY 1 ORDER BY 1 ASC`;

  const paymentsRes = await query(paymentsSql, params);

  return {
    payments_by_day: paymentsRes.rows,
  };
}

// =====================================================
// ✅ Compat con controller
// =====================================================
function assertAdminScope(auth, adminIdParam) {
  if (!auth?.adminId) throw new AppError(401, "UNAUTHORIZED", "No autenticado");
  if (auth.adminId !== adminIdParam) throw new AppError(403, "FORBIDDEN", "No pertenece a tu admin");
}

async function collectionsSummary(auth, adminIdParam, { date }) {
  assertAdminScope(auth, adminIdParam);
  const d = toDateOnly(date) || new Date().toISOString().slice(0, 10);

  const rowsRes = await query(
    `SELECT
       p.vendor_id,
       COALESCE(v.name, 'Sin vendedor') AS vendor_name,
       COUNT(*)::int AS payments_count,
       COALESCE(SUM(p.amount),0)::float8 AS total_amount
     FROM payments p
     LEFT JOIN vendors v ON v.id = p.vendor_id
     WHERE p.admin_id = $1
       AND p.paid_at >= $2::date
       AND p.paid_at < ($2::date + INTERVAL '1 day')
     GROUP BY p.vendor_id, v.name
     ORDER BY total_amount DESC, payments_count DESC`,
    [adminIdParam, d]
  );

  const totals = rowsRes.rows.reduce(
    (acc, r) => {
      acc.total_amount += Number(r.total_amount || 0);
      acc.payments_count += Number(r.payments_count || 0);
      return acc;
    },
    { total_amount: 0, payments_count: 0 }
  );

  return {
    date: d,
    total_amount: totals.total_amount,
    payments_count: totals.payments_count,
    by_vendor: rowsRes.rows,
  };
}

async function lateClients(auth, adminIdParam, { date, limit, offset }) {
  assertAdminScope(auth, adminIdParam);
  const d = toDateOnly(date) || new Date().toISOString().slice(0, 10);
  const lim = Math.min(Math.max(Number(limit || 50), 1), 200);
  const off = Math.max(Number(offset || 0), 0);

  const itemsRes = await query(
    `SELECT
       c.id AS client_id,
       c.name AS client_name,
       c.phone,
       c.address,
       c.vendor_id,
       COALESCE(v.name, 'Sin vendedor') AS vendor_name,
       COALESCE(SUM(GREATEST(i.amount_due - i.amount_paid, 0)),0)::float8 AS overdue_amount,
       COUNT(*)::int AS overdue_installments
     FROM clients c
     JOIN credits cr ON cr.client_id = c.id
     JOIN installments i ON i.credit_id = cr.id
     LEFT JOIN vendors v ON v.id = c.vendor_id
     WHERE c.admin_id = $1
       AND c.deleted_at IS NULL
       AND cr.admin_id = $1
       AND cr.deleted_at IS NULL
       AND cr.status IN ('active','late')
       AND i.status IN ('pending','late')
       AND i.due_date < $2::date
       AND (i.amount_due - i.amount_paid) > 0
     GROUP BY c.id, v.name
     ORDER BY overdue_amount DESC
     LIMIT $3 OFFSET $4`,
    [adminIdParam, d, lim, off]
  );

  const totalRes = await query(
    `SELECT COUNT(*)::int AS total
     FROM (
       SELECT c.id
       FROM clients c
       JOIN credits cr ON cr.client_id = c.id
       JOIN installments i ON i.credit_id = cr.id
       WHERE c.admin_id = $1
         AND c.deleted_at IS NULL
         AND cr.admin_id = $1
         AND cr.deleted_at IS NULL
         AND cr.status IN ('active','late')
         AND i.status IN ('pending','late')
         AND i.due_date < $2::date
         AND (i.amount_due - i.amount_paid) > 0
       GROUP BY c.id
     ) x`,
    [adminIdParam, d]
  );

  return { items: itemsRes.rows, total: totalRes.rows[0]?.total || 0 };
}

async function vendorPerformance(auth, adminIdParam, { date }) {
  assertAdminScope(auth, adminIdParam);
  const d = toDateOnly(date) || new Date().toISOString().slice(0, 10);

  const res = await query(
    `SELECT
       v.id AS vendor_id,
       v.name AS vendor_name,

       COALESCE(p.payments_count,0)::int AS payments_count,
       COALESCE(p.total_amount,0)::float8 AS total_amount,

       COALESCE(rv.visits_count,0)::int AS visits_count,
       COALESCE(rv.visited_true,0)::int AS visited_true,
       COALESCE(rv.visited_false,0)::int AS visited_false
     FROM vendors v
     LEFT JOIN LATERAL (
       SELECT
         COUNT(*)::int AS payments_count,
         COALESCE(SUM(p.amount),0)::float8 AS total_amount
       FROM payments p
       WHERE p.admin_id = $1
         AND p.vendor_id = v.id
         AND p.paid_at >= $2::date
         AND p.paid_at < ($2::date + INTERVAL '1 day')
     ) p ON true
     LEFT JOIN LATERAL (
       SELECT
         COUNT(*)::int AS visits_count,
         COUNT(*) FILTER (WHERE visited = true)::int AS visited_true,
         COUNT(*) FILTER (WHERE visited = false)::int AS visited_false
       FROM route_visits rv
       WHERE rv.admin_id = $1
         AND rv.vendor_id = v.id
         AND rv.visited_at >= $2::date
         AND rv.visited_at < ($2::date + INTERVAL '1 day')
     ) rv ON true
     WHERE v.admin_id = $1
       AND v.deleted_at IS NULL
     ORDER BY total_amount DESC, payments_count DESC`,
    [adminIdParam, d]
  );

  return { date: d, by_vendor: res.rows };
}

module.exports = {
  getAdminDashboardSummary,
  getAdminDailyCollections,
  getAdminMonthlyTrends,

  // ✅ exports esperados por controller
  collectionsSummary,
  lateClients,
  vendorPerformance,
};
