const { query } = require("../../db/pool");
const { AppError } = require("../../utils/appError");

function dayRangeUTC(dateStr) {
  const start = new Date(dateStr + "T00:00:00.000Z");
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

async function assertAdminSelf(reqAdminId, adminIdParam) {
  if (reqAdminId !== adminIdParam) {
    throw new AppError(403, "FORBIDDEN", "No puedes acceder a otro admin");
  }
}

async function collectionsSummary({ adminId }, adminIdParam, { date }) {
  await assertAdminSelf(adminId, adminIdParam);
  const { start, end } = dayRangeUTC(date);

  const totalRes = await query(
    `SELECT
       COALESCE(SUM(p.amount),0)::float8 AS total_amount,
       COUNT(*)::int AS payments_count
     FROM payments p
     WHERE p.admin_id = $1
       AND p.deleted_at IS NULL
       AND p.paid_at >= $2::timestamptz
       AND p.paid_at <  $3::timestamptz`,
    [adminIdParam, start, end]
  );

  const byVendorRes = await query(
    `SELECT
       p.vendor_id,
       COALESCE(v.name,'(admin)') AS vendor_name,
       COALESCE(SUM(p.amount),0)::float8 AS total_amount,
       COUNT(*)::int AS payments_count
     FROM payments p
     LEFT JOIN vendors v ON v.id = p.vendor_id
     WHERE p.admin_id = $1
       AND p.deleted_at IS NULL
       AND p.paid_at >= $2::timestamptz
       AND p.paid_at <  $3::timestamptz
     GROUP BY p.vendor_id, v.name
     ORDER BY total_amount DESC`,
    [adminIdParam, start, end]
  );

  return {
    date,
    total: totalRes.rows[0],
    by_vendor: byVendorRes.rows
  };
}

async function lateClients({ adminId }, adminIdParam, { date, limit, offset }) {
  await assertAdminSelf(adminId, adminIdParam);

  // overdue: due_date < date AND amount_paid < amount_due AND not deleted
  const listRes = await query(
    `WITH overdue AS (
       SELECT
         i.credit_id,
         COUNT(*) AS overdue_installments,
         COALESCE(SUM(i.amount_due - i.amount_paid),0) AS overdue_amount,
         MIN(i.due_date) AS oldest_due_date
       FROM installments i
       JOIN credits c ON c.id = i.credit_id
       WHERE c.admin_id = $1
         AND c.deleted_at IS NULL
         AND i.deleted_at IS NULL
         AND i.due_date < $2::date
         AND i.amount_paid < i.amount_due
       GROUP BY i.credit_id
     )
     SELECT
       cl.id AS client_id,
       cl.name,
       cl.phone,
       cl.doc_id,
       cl.address,
       cl.status AS client_status,
       c.id AS credit_id,
       c.status AS credit_status,
       c.balance::float8 AS balance,
       o.overdue_installments::int,
       o.overdue_amount::float8,
       o.oldest_due_date
     FROM overdue o
     JOIN credits c ON c.id = o.credit_id
     JOIN clients cl ON cl.id = c.client_id
     WHERE cl.deleted_at IS NULL
     ORDER BY o.overdue_amount DESC, o.oldest_due_date ASC
     LIMIT $3 OFFSET $4`,
    [adminIdParam, date, limit, offset]
  );

  const totalRes = await query(
    `WITH overdue AS (
       SELECT i.credit_id
       FROM installments i
       JOIN credits c ON c.id = i.credit_id
       WHERE c.admin_id = $1
         AND c.deleted_at IS NULL
         AND i.deleted_at IS NULL
         AND i.due_date < $2::date
         AND i.amount_paid < i.amount_due
       GROUP BY i.credit_id
     )
     SELECT COUNT(*)::int AS total
     FROM overdue`,
    [adminIdParam, date]
  );

  return { items: listRes.rows, total: totalRes.rows[0]?.total || 0 };
}

async function vendorPerformance({ adminId }, adminIdParam, { date }) {
  await assertAdminSelf(adminId, adminIdParam);
  const { start, end } = dayRangeUTC(date);

  // Payments by vendor
  const payRes = await query(
    `SELECT
       COALESCE(p.vendor_id, '00000000-0000-0000-0000-000000000000') AS vendor_key,
       p.vendor_id,
       COALESCE(SUM(p.amount),0)::float8 AS payments_total,
       COUNT(*)::int AS payments_count
     FROM payments p
     WHERE p.admin_id = $1
       AND p.deleted_at IS NULL
       AND p.paid_at >= $2::timestamptz
       AND p.paid_at <  $3::timestamptz
     GROUP BY p.vendor_id`,
    [adminIdParam, start, end]
  );

  // Visits by vendor
  const visitRes = await query(
    `SELECT
       rv.vendor_id,
       COUNT(*)::int AS visits_count,
       COUNT(*) FILTER (WHERE rv.visited = true)::int AS visited_true,
       COUNT(*) FILTER (WHERE rv.visited = false)::int AS visited_false
     FROM route_visits rv
     WHERE rv.admin_id = $1
       AND rv.visited_at >= $2::timestamptz
       AND rv.visited_at <  $3::timestamptz
     GROUP BY rv.vendor_id`,
    [adminIdParam, start, end]
  );

  // Cash net by vendor
  const cashRes = await query(
    `SELECT
       vcm.vendor_id,
       COALESCE(SUM(CASE WHEN vcm.movement_type='income' THEN vcm.amount ELSE 0 END),0)::float8 AS cash_income,
       COALESCE(SUM(CASE WHEN vcm.movement_type='expense' THEN vcm.amount ELSE 0 END),0)::float8 AS cash_expense
     FROM vendor_cash_movements vcm
     WHERE vcm.admin_id = $1
       AND vcm.occurred_at >= $2::timestamptz
       AND vcm.occurred_at <  $3::timestamptz
     GROUP BY vcm.vendor_id`,
    [adminIdParam, start, end]
  );

  // Vendors list
  const vendorsRes = await query(
    `SELECT id, name, status
     FROM vendors
     WHERE admin_id = $1 AND deleted_at IS NULL
     ORDER BY name ASC`,
    [adminIdParam]
  );

  const map = new Map();

  function key(vendorId) {
    return vendorId || "00000000-0000-0000-0000-000000000000";
  }

  // init vendors
  for (const v of vendorsRes.rows) {
    map.set(key(v.id), {
      vendor_id: v.id,
      vendor_name: v.name,
      vendor_status: v.status,
      payments_total: 0,
      payments_count: 0,
      visits_count: 0,
      visited_true: 0,
      visited_false: 0,
      cash_income: 0,
      cash_expense: 0,
      cash_net: 0
    });
  }

  // add payment rows
  for (const r of payRes.rows) {
    if (!r.vendor_id) continue; // ignora pagos admin-only aquí
    const k = key(r.vendor_id);
    if (!map.has(k)) {
      map.set(k, {
        vendor_id: r.vendor_id,
        vendor_name: "(unknown)",
        vendor_status: "unknown",
        payments_total: 0, payments_count: 0,
        visits_count: 0, visited_true: 0, visited_false: 0,
        cash_income: 0, cash_expense: 0, cash_net: 0
      });
    }
    const row = map.get(k);
    row.payments_total = r.payments_total;
    row.payments_count = r.payments_count;
  }

  // add visit rows
  for (const r of visitRes.rows) {
    const k = key(r.vendor_id);
    if (!map.has(k)) {
      map.set(k, {
        vendor_id: r.vendor_id,
        vendor_name: "(unknown)",
        vendor_status: "unknown",
        payments_total: 0, payments_count: 0,
        visits_count: 0, visited_true: 0, visited_false: 0,
        cash_income: 0, cash_expense: 0, cash_net: 0
      });
    }
    const row = map.get(k);
    row.visits_count = r.visits_count;
    row.visited_true = r.visited_true;
    row.visited_false = r.visited_false;
  }

  // add cash rows
  for (const r of cashRes.rows) {
    const k = key(r.vendor_id);
    if (!map.has(k)) {
      map.set(k, {
        vendor_id: r.vendor_id,
        vendor_name: "(unknown)",
        vendor_status: "unknown",
        payments_total: 0, payments_count: 0,
        visits_count: 0, visited_true: 0, visited_false: 0,
        cash_income: 0, cash_expense: 0, cash_net: 0
      });
    }
    const row = map.get(k);
    row.cash_income = r.cash_income;
    row.cash_expense = r.cash_expense;
    row.cash_net = Number(r.cash_income) - Number(r.cash_expense);
  }

  return { date, vendors: Array.from(map.values()).sort((a, b) => (b.payments_total - a.payments_total)) };
}

module.exports = {
  collectionsSummary,
  lateClients,
  vendorPerformance
};
