const { query } = require("../db/pool");

function normalizeRole(role) {
  const r = String(role || "").toLowerCase();
  if (r === "admin" || r === "vendor" || r === "system") return r;
  return "system";
}

async function auditLog(input = {}) {
  const {
    adminId,
    vendorId,
    actorRole,
    actorId,
    action,
    entityType,
    entityId,
    requestIp,
    userAgent,
    requestId,
    meta,
    // compat con llamadas viejas
    metadata,
    success
  } = input;

  const role = normalizeRole(actorRole ?? (vendorId ? "vendor" : adminId ? "admin" : "system"));
  const finalActorId =
    actorId ?? (role === "vendor" ? vendorId : role === "admin" ? adminId : null);

  const mergedMeta = {
    ...(meta && typeof meta === "object" ? meta : {}),
    ...(metadata && typeof metadata === "object" ? metadata : {})
  };
  if (success !== undefined) mergedMeta.success = !!success;

  await query(
    `INSERT INTO audit_logs (
      admin_id, vendor_id, actor_role, actor_id, action, entity_type, entity_id,
      request_ip, user_agent, request_id, meta
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
    [
      adminId || null,
      vendorId || null,
      role, // ✅ NUNCA NULL
      finalActorId || null,
      (action || "UNKNOWN").toString(),
      entityType || null,
      entityId || null,
      requestIp || null,
      userAgent || null,
      requestId || null,
      JSON.stringify(mergedMeta)
    ]
  );
}

module.exports = { auditLog };
