const { query } = require("../../db/pool");

function toDateOnly(d) {
  if (!d) return null;
  if (typeof d === "string") return d.slice(0, 10);
  return new Date(d).toISOString().slice(0, 10);
}

async function getAdminDashboardSummary(adminId, { from, to }) {
  const fromDate = toDateOnly(from);
  const toDate = toDateOnly(to);

  // Clientes
  const clientsRes = await query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE status = 'active')::int AS active,
       COUNT(*) FILTER (WHERE status = 'inactive')::int AS inactive
     FROM clients
     WHERE admin_id = $1 AND deleted_at IS NULL`,
    [adminId]
  );

  // Créditos
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

  // Pagos en rango (SIN deleted_at)
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

  // Cobrado hoy (pagos)
  const paidRes = await query(
    `SELECT COALESCE(SUM(amount),0)::float8 AS collected_today
     FROM payments
     WHERE admin_id = $1
       AND paid_at >= $2::date
       AND paid_at < ($2::date + INTERVAL '1 day')`,
    [adminId, dateStr]
  );

  // Vencido y Hoy por cobrar (cuotas pendientes)
  // (SIN installments.deleted_at)
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

  // Pagos por día (SIN deleted_at)
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

module.exports = {
  getAdminDashboardSummary,
  getAdminDailyCollections,
  getAdminMonthlyTrends,
};
