const { query } = require("../db/pool");

async function getAdminSubscription(adminId) {
  const r = await query(
    `SELECT id, status, subscription_expires_at
     FROM admins
     WHERE id = $1`,
    [adminId]
  );
  return r.rows[0] || null;
}

async function getVendorSubscriptionContext(vendorId) {
  const r = await query(
    `SELECT v.id AS vendor_id, v.admin_id, v.status AS vendor_status, v.deleted_at,
            v.token_version,
            a.status AS admin_status, a.subscription_expires_at
     FROM vendors v
     JOIN admins a ON a.id = v.admin_id
     WHERE v.id = $1`,
    [vendorId]
  );
  return r.rows[0] || null;
}

module.exports = { getAdminSubscription, getVendorSubscriptionContext };
