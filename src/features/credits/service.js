const { pool, query } = require("../../db/pool");
const { AppError } = require("../../utils/appError");

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function addDays(dateStr, days) {
  const d = new Date(dateStr + "T00:00:00.000Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

async function getClientById(clientId) {
  const r = await query(
    `SELECT id, admin_id, vendor_id, deleted_at
     FROM clients
     WHERE id = $1`,
    [clientId]
  );
  return r.rows[0] || null;
}

async function getVendorById(vendorId) {
  const r = await query(
    `SELECT id, admin_id, status, permissions, deleted_at
     FROM vendors
     WHERE id = $1`,
    [vendorId]
  );
  return r.rows[0] || null;
}

function permTrue(permissions, key) {
  if (!permissions) return false;
  const v = permissions[key];
  return v === true || v === "true" || v === 1 || v === "1";
}

/**
 * ✅ Permite por ruta asignada:
 * - Primero busca una asignación de HOY (assigned_date = CURRENT_DATE)
 * - Si no hay, usa la última asignación (assigned_date desc)
 * - Luego valida si el cliente está en route_clients de esa ruta
 */
async function vendorHasClientInAssignedRoute(adminId, vendorId, clientId) {
  const r = await query(
    `
    WITH todays AS (
      SELECT ra.route_id
      FROM route_assignments ra
      JOIN routes rt ON rt.id = ra.route_id
      WHERE ra.admin_id = $1
        AND ra.vendor_id = $2
        AND ra.assigned_date = CURRENT_DATE
        AND ra.deleted_at IS NULL
        AND rt.deleted_at IS NULL
        AND rt.status = 'active'
        AND ra.status IN ('assigned','completed')
      ORDER BY ra.created_at DESC
      LIMIT 1
    ),
    latest AS (
      SELECT ra.route_id
      FROM route_assignments ra
      JOIN routes rt ON rt.id = ra.route_id
      WHERE ra.admin_id = $1
        AND ra.vendor_id = $2
        AND ra.deleted_at IS NULL
        AND rt.deleted_at IS NULL
        AND rt.status = 'active'
        AND ra.status IN ('assigned','completed')
      ORDER BY ra.assigned_date DESC, ra.created_at DESC
      LIMIT 1
    ),
    chosen AS (
      SELECT route_id FROM todays
      UNION ALL
      SELECT route_id FROM latest WHERE NOT EXISTS (SELECT 1 FROM todays)
      LIMIT 1
    )
    SELECT 1
    FROM chosen
    JOIN route_clients rc ON rc.route_id = chosen.route_id
    WHERE rc.client_id = $3
      AND rc.deleted_at IS NULL
      AND rc.is_active = true
    LIMIT 1
    `,
    [adminId, vendorId, clientId]
  );

  return !!r.rows[0];
}

async function createCredit(auth, clientId, payload) {
  const clientRow = await getClientById(clientId);
  if (!clientRow || clientRow.deleted_at) throw new AppError(404, "NOT_FOUND", "Cliente no encontrado");
  if (clientRow.admin_id !== auth.adminId) throw new AppError(403, "FORBIDDEN", "Cliente no pertenece a tu admin");

  // Resolver vendor_id
  let vendorId = null;

  if (auth.role === "vendor") {
    const v = await getVendorById(auth.vendorId);
    if (!v || v.deleted_at) throw new AppError(404, "NOT_FOUND", "Vendor no encontrado");
    if (v.admin_id !== auth.adminId) throw new AppError(403, "FORBIDDEN", "Vendor no pertenece a tu admin");
    if (String(v.status || "").toLowerCase() !== "active") throw new AppError(403, "FORBIDDEN", "Vendor inactivo");
    if (!permTrue(v.permissions, "canCreateCredits")) {
      throw new AppError(403, "FORBIDDEN", "No tienes permiso para crear créditos");
    }

    vendorId = auth.vendorId;

    // ✅ NUEVO: vendor puede crear si el cliente es suyo O si está en su ruta asignada
    const okByOwner = clientRow.vendor_id === vendorId;
    const okByRoute = okByOwner ? true : await vendorHasClientInAssignedRoute(auth.adminId, vendorId, clientId);

    if (!okByRoute) {
      throw new AppError(403, "FORBIDDEN", "Cliente no asignado a este vendor");
    }
  } else {
    // admin puede asignar vendor_id opcionalmente
    if (payload.vendor_id) {
      const v = await getVendorById(payload.vendor_id);
      if (!v || v.deleted_at) throw new AppError(404, "NOT_FOUND", "Vendor no encontrado");
      if (v.admin_id !== auth.adminId) throw new AppError(403, "FORBIDDEN", "Vendor no pertenece a tu admin");
      if (String(v.status || "").toLowerCase() !== "active") throw new AppError(403, "FORBIDDEN", "Vendor inactivo");
      vendorId = payload.vendor_id;
    }
  }

  const principal = round2(payload.principal_amount);
  const interestRate = round2(payload.interest_rate || 0);
  const count = payload.installments_count;

  // ✅ divisa
  const currencyCode = String(payload.currency_code || "COP").toUpperCase();

  const total = round2(principal * (1 + interestRate / 100));
  const balance = total;

  // distribuir cuotas exactas en centavos
  const centsTotal = Math.round(total * 100);
  const baseCents = Math.floor(centsTotal / count);
  const remainder = centsTotal - baseCents * count;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const cr = await client.query(
      `INSERT INTO credits
        (admin_id, client_id, vendor_id,
         principal_amount, interest_rate, installments_count, start_date,
         status, total_amount, balance, balance_amount, currency_code, notes)
       VALUES
        ($1,$2,$3,$4,$5,$6,$7,'active',$8,$9,$10,$11,$12)
       RETURNING
        id, admin_id, client_id, vendor_id,
        principal_amount::float8 AS principal_amount,
        interest_rate::float8 AS interest_rate,
        installments_count,
        start_date,
        status,
        total_amount::float8 AS total_amount,
        balance::float8 AS balance,
        balance_amount::float8 AS balance_amount,
        currency_code,
        notes,
        created_at, updated_at`,
      [
        auth.adminId,
        clientId,
        vendorId,
        principal,
        interestRate,
        count,
        payload.start_date,
        total,
        balance,
        balance, // balance_amount = balance
        currencyCode,
        payload.notes || null
      ]
    );

    const credit = cr.rows[0];

    // insertar cuotas (por defecto diario: +1 día)
    for (let i = 1; i <= count; i++) {
      let cents = baseCents;
      if (i === count) cents = baseCents + remainder;
      const amountDue = cents / 100;

      const dueDate = addDays(payload.start_date, i - 1);

      await client.query(
        `INSERT INTO installments
          (credit_id, installment_number, due_date, amount_due, amount_paid, status)
         VALUES
          ($1,$2,$3,$4,0,'pending')`,
        [credit.id, i, dueDate, amountDue]
      );
    }

    await client.query("COMMIT");
    return credit;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function createPayment(auth, creditId, payload) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Traemos también client_id para validar ruta por cliente si vendor_id no coincide
    const cr = await client.query(
      `SELECT id, admin_id, vendor_id, client_id, status,
              balance_amount::float8 AS balance_amount
       FROM credits
       WHERE id = $1 AND deleted_at IS NULL
       LIMIT 1`,
      [creditId]
    );
    const credit = cr.rows[0];
    if (!credit) throw new AppError(404, "NOT_FOUND", "Crédito no encontrado");
    if (credit.admin_id !== auth.adminId) throw new AppError(403, "FORBIDDEN", "Crédito no pertenece a tu admin");

    if (auth.role === "vendor") {
      const v = await getVendorById(auth.vendorId);
      if (!v || v.deleted_at) throw new AppError(404, "NOT_FOUND", "Vendor no encontrado");
      if (v.admin_id !== auth.adminId) throw new AppError(403, "FORBIDDEN", "Vendor no pertenece a tu admin");
      if (String(v.status || "").toLowerCase() !== "active") throw new AppError(403, "FORBIDDEN", "Vendor inactivo");

      // ✅ NUEVO: vendor puede cobrar si:
      // - el crédito está asignado a él, o
      // - el cliente del crédito está en su ruta asignada
      const okByOwner = credit.vendor_id === auth.vendorId;
      const okByRoute = okByOwner ? true : await vendorHasClientInAssignedRoute(auth.adminId, auth.vendorId, credit.client_id);

      if (!okByRoute) {
        throw new AppError(403, "FORBIDDEN", "Crédito no asignado a este vendor");
      }
    }

    if (String(credit.status).toLowerCase() === "cancelled") {
      throw new AppError(400, "VALIDATION_ERROR", "Crédito cancelado");
    }

    const amount = round2(payload.amount);
    if (amount <= 0) throw new AppError(400, "VALIDATION_ERROR", "Monto inválido");

    // No permitir pagar más de lo que debe (tolerancia centavos)
    const balanceCents = Math.round(Number(credit.balance_amount) * 100);
    const payCents = Math.round(amount * 100);
    if (payCents > balanceCents) {
      throw new AppError(400, "VALIDATION_ERROR", "El pago excede el saldo");
    }

    // insertar payment
    const pr = await client.query(
      `INSERT INTO payments
        (admin_id, credit_id, vendor_id, amount, method, note, paid_at)
       VALUES
        ($1,$2,$3,$4,$5,$6,COALESCE($7, now()))
       RETURNING
        id,
        admin_id,
        credit_id,
        vendor_id,
        amount::float8 AS amount,
        method,
        note,
        paid_at,
        created_at`,
      [
        auth.adminId,
        creditId,
        auth.role === "vendor" ? auth.vendorId : null,
        amount,
        payload.method || "cash",
        payload.note || null,
        payload.paid_at || null
      ]
    );

    const payment = pr.rows[0];

    // aplicar pago a cuotas (FIFO)
    const instRes = await client.query(
      `SELECT id, installment_number, amount_due::float8 AS amount_due, amount_paid::float8 AS amount_paid, status, due_date
       FROM installments
       WHERE credit_id = $1
       ORDER BY installment_number ASC`,
      [creditId]
    );

    let remainingCents = payCents;

    for (const inst of instRes.rows) {
      if (remainingCents <= 0) break;

      const dueCents = Math.round(Number(inst.amount_due) * 100);
      const paidCents = Math.round(Number(inst.amount_paid) * 100);
      const need = dueCents - paidCents;
      if (need <= 0) continue;

      const payToThis = Math.min(need, remainingCents);
      const newPaidCents = paidCents + payToThis;

      const fullyPaid = newPaidCents >= dueCents;

      const dueDate = new Date(inst.due_date + "T00:00:00.000Z");
      const today = new Date();
      const isPastDue =
        dueDate.getTime() <
        new Date(today.toISOString().slice(0, 10) + "T00:00:00.000Z").getTime();

      const newStatus = fullyPaid ? (isPastDue ? "paid_late" : "paid") : isPastDue ? "late" : "pending";

      await client.query(
        `UPDATE installments
         SET amount_paid = $2,
             status = $3,
             updated_at = now()
         WHERE id = $1`,
        [inst.id, newPaidCents / 100, newStatus]
      );

      remainingCents -= payToThis;
    }

    // recalcular balance del crédito
    const newBalance = round2(Number(credit.balance_amount) - amount);
    const finalBalance = newBalance < 0 ? 0 : newBalance;
    const paidOff = Math.round(finalBalance * 100) <= 0;

    await client.query(
      `UPDATE credits
       SET balance_amount = $2,
           balance = $2,
           status = CASE WHEN $3 THEN 'paid' ELSE status END,
           updated_at = now()
       WHERE id = $1`,
      [creditId, finalBalance, paidOff]
    );

    await client.query("COMMIT");

    return {
      payment,
      credit: { id: creditId, balance_amount: finalBalance, status: paidOff ? "paid" : credit.status }
    };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { createCredit, createPayment };
