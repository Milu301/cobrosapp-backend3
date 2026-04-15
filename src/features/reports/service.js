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

async function collectionsSummary(auth, adminIdParam, { date, start_date, end_date }) {
  assertAdminScope(auth, adminIdParam);
  const today = new Date().toISOString().slice(0, 10);
  const startD = toDateOnly(start_date) || toDateOnly(date) || today;
  const endD   = toDateOnly(end_date)   || toDateOnly(date) || today;

  const rowsRes = await query(
    `SELECT
       p.id,
       p.paid_at AS date,
       COALESCE(v.name, 'Sin vendedor') AS vendor,
       COALESCE(cl.name, 'Sin cliente') AS client,
       p.amount,
       COALESCE(p.method, 'cash') AS payment_method,
       COALESCE(i.status, 'paid') AS status,
       i.installment_number AS installment
     FROM payments p
     LEFT JOIN vendors v ON v.id = p.vendor_id
     LEFT JOIN credits cr ON cr.id = p.credit_id
     LEFT JOIN clients cl ON cl.id = cr.client_id
     LEFT JOIN LATERAL (
       SELECT status, installment_number
       FROM installments ins
       WHERE ins.credit_id = p.credit_id
         AND ins.due_date <= p.paid_at::date
       ORDER BY ins.due_date DESC LIMIT 1
     ) i ON true
     WHERE p.admin_id = $1
       AND p.paid_at >= $2::date
       AND p.paid_at < ($3::date + INTERVAL '1 day')
     ORDER BY p.paid_at DESC`,
    [adminIdParam, startD, endD]
  );

  return rowsRes.rows;
}

async function lateClients(auth, adminIdParam, { date, limit, offset }) {
  assertAdminScope(auth, adminIdParam);
  const d = toDateOnly(date) || new Date().toISOString().slice(0, 10);
  const lim = Math.min(Math.max(Number(limit || 50), 1), 200);
  const off = Math.max(Number(offset || 0), 0);

  const itemsRes = await query(
    `SELECT
       c.id,
       c.name AS "clientName",
       c.phone,
       c.address,
       c.vendor_id,
       COALESCE(v.name, 'Sin vendedor') AS vendor,
       COALESCE(SUM(GREATEST(i.amount_due - i.amount_paid, 0)),0)::float8 AS "overdueAmount",
       COUNT(*)::int AS overdue_installments,
       (CURRENT_DATE - MIN(i.due_date))::int AS "daysLate",
       (
         SELECT COALESCE(SUM(cr2.balance_amount), 0)::float8
         FROM credits cr2
         WHERE cr2.client_id = c.id
           AND cr2.admin_id = $1
           AND cr2.deleted_at IS NULL
           AND cr2.status IN ('active','late')
       ) AS "totalDebt"
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
     ORDER BY "overdueAmount" DESC
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

async function vendorPerformance(auth, adminIdParam, { date, start_date, end_date }) {
  assertAdminScope(auth, adminIdParam);
  const today = new Date().toISOString().slice(0, 10);
  const startD = toDateOnly(start_date) || toDateOnly(date) || today;
  const endD   = toDateOnly(end_date)   || toDateOnly(date) || today;

  const res = await query(
    `SELECT
       v.id,
       v.name,
       COALESCE(cli.client_count,    0)::int    AS clients,
       COALESCE(cred.active_credits, 0)::int    AS "activeCredits",
       COALESCE(pay.collected,       0)::float8 AS collected,
       COALESCE(cred.portfolio,      0)::float8 AS portfolio,
       COALESCE(overdue.overdue_clients, 0)::int AS "overdueClients",
       CASE
         WHEN COALESCE(cred.portfolio, 0) > 0
         THEN ROUND((COALESCE(pay.collected, 0) / cred.portfolio * 100)::numeric, 1)::float8
         ELSE 0
       END AS "collectionRate"
     FROM vendors v

     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS client_count
       FROM clients c
       WHERE c.vendor_id = v.id
         AND c.admin_id = $1
         AND c.deleted_at IS NULL
         AND c.status = 'active'
     ) cli ON true

     LEFT JOIN LATERAL (
       SELECT
         COUNT(*) FILTER (WHERE cr.status IN ('active','late'))::int AS active_credits,
         COALESCE(SUM(CASE WHEN cr.status IN ('active','late') THEN cr.balance_amount ELSE 0 END), 0)::float8 AS portfolio
       FROM credits cr
       JOIN clients c ON c.id = cr.client_id
       WHERE (cr.vendor_id = v.id OR c.vendor_id = v.id)
         AND cr.admin_id = $1
         AND cr.deleted_at IS NULL
     ) cred ON true

     LEFT JOIN LATERAL (
       SELECT COALESCE(SUM(p.amount), 0)::float8 AS collected
       FROM payments p
       WHERE p.vendor_id = v.id
         AND p.admin_id = $1
         AND p.paid_at >= $2::date
         AND p.paid_at < ($3::date + INTERVAL '1 day')
     ) pay ON true

     LEFT JOIN LATERAL (
       SELECT COUNT(DISTINCT c.id)::int AS overdue_clients
       FROM clients c
       JOIN credits cr ON cr.client_id = c.id
       JOIN installments i ON i.credit_id = cr.id
       WHERE (cr.vendor_id = v.id OR c.vendor_id = v.id)
         AND cr.admin_id = $1
         AND cr.deleted_at IS NULL
         AND cr.status IN ('active','late')
         AND i.status IN ('pending','late')
         AND i.due_date < CURRENT_DATE
         AND (i.amount_due - i.amount_paid) > 0
     ) overdue ON true

     WHERE v.admin_id = $1
       AND v.deleted_at IS NULL
     ORDER BY collected DESC, clients DESC`,
    [adminIdParam, startD, endD]
  );

  return res.rows;
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
