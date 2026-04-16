const { query } = require("../../db/pool");
const { AppError } = require("../../utils/appError");
const { env } = require("../../config/env");

const APP_TZ = env.APP_TIMEZONE || "America/Bogota";

async function getAdminStats(adminId) {
  const today = new Date().toISOString().slice(0, 10);
  const [vendors, clients, credits, overdue, cash, todayPay] = await Promise.all([
    query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'active') AS active_vendors,
         COUNT(*) AS total_vendors
       FROM vendors
       WHERE admin_id = $1 AND deleted_at IS NULL`,
      [adminId]
    ),
    query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'active') AS active_clients,
         COUNT(*) AS total_clients
       FROM clients
       WHERE admin_id = $1 AND deleted_at IS NULL`,
      [adminId]
    ),
    query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'active') AS active_credits,
         COUNT(*) FILTER (WHERE status = 'late')   AS late_credits,
         COALESCE(SUM(CASE WHEN status = 'active' THEN COALESCE(balance_amount, balance, 0) ELSE 0 END), 0)::float8 AS total_portfolio,
         COALESCE(SUM(CASE WHEN status IN ('active','late') THEN COALESCE(balance_amount, balance, 0) ELSE 0 END), 0)::float8 AS total_outstanding
       FROM credits
       WHERE admin_id = $1 AND deleted_at IS NULL`,
      [adminId]
    ),
    query(
      `SELECT
         COUNT(DISTINCT credit_id)::int AS overdue_credits,
         COALESCE(SUM(amount_due - amount_paid), 0)::float8 AS overdue_amount
       FROM installments i
       JOIN credits c ON c.id = i.credit_id
       WHERE c.admin_id = $1
         AND c.deleted_at IS NULL
         AND i.status IN ('late', 'paid_late')
         AND i.amount_paid < i.amount_due`,
      [adminId]
    ),
    query(
      `SELECT
         COALESCE(SUM(CASE WHEN movement_type='income'  THEN amount ELSE 0 END),0)::float8 AS today_income,
         COALESCE(SUM(CASE WHEN movement_type='expense' THEN amount ELSE 0 END),0)::float8 AS today_expense
       FROM (
         SELECT movement_type, amount
         FROM admin_cash_movements
         WHERE admin_id = $1
           AND deleted_at IS NULL
           AND occurred_at >= ($2::date::timestamp AT TIME ZONE $3)
           AND occurred_at <  (($2::date + 1)::timestamp AT TIME ZONE $3)
         UNION ALL
         SELECT movement_type, amount
         FROM vendor_cash_movements
         WHERE admin_id = $1
           AND deleted_at IS NULL
           AND occurred_at >= ($2::date::timestamp AT TIME ZONE $3)
           AND occurred_at <  (($2::date + 1)::timestamp AT TIME ZONE $3)
       ) AS combined_cash`,
      [adminId, today, APP_TZ]
    ),
    // Sum of all vendor payments received today
    query(
      `SELECT COALESCE(SUM(p.amount), 0)::float8 AS today_collections,
              COUNT(p.id)::int AS payment_count
       FROM payments p
       WHERE p.admin_id = $1
         AND p.paid_at >= ($2::date::timestamp AT TIME ZONE $3)
         AND p.paid_at <  (($2::date + 1)::timestamp AT TIME ZONE $3)`,
      [adminId, today, APP_TZ]
    ),
  ]);

  const v  = vendors.rows[0]  || {};
  const cl = clients.rows[0]  || {};
  const cr = credits.rows[0]  || {};
  const ov = overdue.rows[0]  || {};
  const ca = cash.rows[0]     || {};
  const tp = todayPay.rows[0] || {};

  const activeCredits  = (parseInt(cr.active_credits)  || 0);
  const lateCredits    = (parseInt(cr.late_credits)    || 0);
  const totalPortfolio = Number(cr.total_portfolio) || 0;
  const overdueAmount  = Number(ov.overdue_amount)  || 0;
  const todayCollect   = Number(tp.today_collections) || 0;

  return {
    // Nested structure
    vendors:    { active: parseInt(v.active_vendors) || 0, total: parseInt(v.total_vendors) || 0 },
    clients:    { active: parseInt(cl.active_clients) || 0, total: parseInt(cl.total_clients) || 0 },
    credits:    { active: activeCredits, late: lateCredits, total_portfolio: totalPortfolio, total_outstanding: Number(cr.total_outstanding) || 0 },
    overdue:    { credits: parseInt(ov.overdue_credits) || 0, amount: overdueAmount },
    cash_today: { income: Number(ca.today_income) || 0, expense: Number(ca.today_expense) || 0, net: (Number(ca.today_income) || 0) - (Number(ca.today_expense) || 0) },

    // Flat fields for frontend Dashboard compatibility
    totalVendors:      parseInt(v.total_vendors)     || 0,
    totalClients:      parseInt(cl.active_clients)   || 0,
    activeCredits:     activeCredits + lateCredits,
    totalPortfolio,
    overdueAmount,
    todayCollections:  todayCollect,
    paymentCount:      parseInt(tp.payment_count)    || 0,
  };
}

async function getVendorStats(adminId, vendorId) {
  const [clients, credits, overdue, cash, todayPay] = await Promise.all([
    query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'active') AS active_clients,
         COUNT(*) AS total_clients
       FROM clients
       WHERE admin_id = $1 AND vendor_id = $2 AND deleted_at IS NULL`,
      [adminId, vendorId]
    ),
    query(
      `SELECT
         COUNT(*) FILTER (WHERE c.status = 'active') AS active_credits,
         COUNT(*) FILTER (WHERE c.status = 'late')   AS late_credits,
         COALESCE(SUM(CASE WHEN c.status IN ('active','late') THEN COALESCE(c.balance_amount, c.balance, 0) ELSE 0 END), 0)::float8 AS total_portfolio
       FROM credits c
       JOIN clients cl ON cl.id = c.client_id
       WHERE c.admin_id = $1
         AND cl.vendor_id = $2
         AND c.deleted_at IS NULL`,
      [adminId, vendorId]
    ),
    query(
      `SELECT
         COUNT(DISTINCT i.credit_id)::int AS overdue_count,
         COALESCE(SUM(i.amount_due - i.amount_paid), 0)::float8 AS overdue_amount
       FROM installments i
       JOIN credits c ON c.id = i.credit_id
       JOIN clients cl ON cl.id = c.client_id
       WHERE c.admin_id = $1
         AND cl.vendor_id = $2
         AND c.deleted_at IS NULL
         AND i.status IN ('late', 'paid_late')
         AND i.amount_paid < i.amount_due`,
      [adminId, vendorId]
    ),
    query(
      `SELECT
         COALESCE(SUM(CASE WHEN movement_type='income'  THEN amount ELSE 0 END),0)::float8 AS today_income,
         COALESCE(SUM(CASE WHEN movement_type='expense' THEN amount ELSE 0 END),0)::float8 AS today_expense
       FROM vendor_cash_movements
       WHERE admin_id = $1
         AND vendor_id = $2
         AND deleted_at IS NULL
         AND occurred_at >= ($3::date::timestamp AT TIME ZONE $4)
         AND occurred_at <  (($3::date + 1)::timestamp AT TIME ZONE $4)`,
      [adminId, vendorId, new Date().toISOString().slice(0, 10), APP_TZ]
    ),
    query(
      `SELECT COALESCE(SUM(p.amount), 0)::float8 AS today_collections
       FROM payments p
       JOIN credits c ON c.id = p.credit_id
       JOIN clients cl ON cl.id = c.client_id
       WHERE p.admin_id = $1
         AND p.vendor_id = $2
         AND p.paid_at >= ($3::date::timestamp AT TIME ZONE $4)
         AND p.paid_at <  (($3::date + 1)::timestamp AT TIME ZONE $4)`,
      [adminId, vendorId, new Date().toISOString().slice(0, 10), APP_TZ]
    ),
  ]);

  const cl = clients.rows[0] || {};
  const cr = credits.rows[0] || {};
  const ov = overdue.rows[0] || {};
  const ca = cash.rows[0] || {};
  const tp = todayPay.rows[0] || {};

  return {
    clients: {
      active: parseInt(cl.active_clients) || 0,
      total: parseInt(cl.total_clients) || 0,
    },
    credits: {
      active: parseInt(cr.active_credits) || 0,
      late: parseInt(cr.late_credits) || 0,
      total_portfolio: Number(cr.total_portfolio) || 0,
    },
    overdue: {
      count: parseInt(ov.overdue_count) || 0,
      amount: Number(ov.overdue_amount) || 0,
    },
    cash_today: {
      income: Number(ca.today_income) || 0,
      expense: Number(ca.today_expense) || 0,
      net: (Number(ca.today_income) || 0) - (Number(ca.today_expense) || 0),
    },
    today_collections: Number(tp.today_collections) || 0,
  };
}

module.exports = { getAdminStats, getVendorStats };
