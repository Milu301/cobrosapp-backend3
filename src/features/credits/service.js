const { pool, query } = require("../../db/pool");
const { AppError } = require("../../utils/appError");
const { round2 } = require("../../utils/numeric");
const { addDays, addMonths } = require("../../utils/date");
const { getVendorById } = require("../../utils/vendor");
const { permTrue } = require("../../utils/permissions");

function calcDueDate(startDate, installmentIndex, frequency) {
  switch (frequency) {
    case "interdaily": return addDays(startDate, installmentIndex * 2);
    case "weekly":     return addDays(startDate, installmentIndex * 7);
    case "biweekly":   return addDays(startDate, installmentIndex * 14);
    case "monthly":    return addMonths(startDate, installmentIndex);
    default:           return addDays(startDate, installmentIndex); // daily
  }
}

async function getClientById(clientId) {
  const r = await query(
    `SELECT id, admin_id, vendor_id, deleted_at FROM clients WHERE id = $1`,
    [clientId]
  );
  return r.rows[0] || null;
}

async function vendorHasClientInAssignedRoute(adminId, vendorId, clientId) {
  const r = await query(
    `SELECT 1
     FROM route_assignments ra
     JOIN routes rt ON rt.id = ra.route_id
     JOIN route_clients rc ON rc.route_id = ra.route_id
     WHERE ra.admin_id = $1
       AND ra.vendor_id = $2
       AND ra.deleted_at IS NULL
       AND ra.status IN ('assigned','completed')
       AND rt.deleted_at IS NULL
       AND rc.deleted_at IS NULL
       AND rc.is_active = true
       AND rc.client_id = $3
     LIMIT 1`,
    [adminId, vendorId, clientId]
  );
  return !!r.rows[0];
}

async function createCredit(auth, clientId, payload) {
  const clientRow = await getClientById(clientId);
  if (!clientRow || clientRow.deleted_at) throw new AppError(404, "NOT_FOUND", "Cliente no encontrado");
  if (clientRow.admin_id !== auth.adminId) throw new AppError(403, "FORBIDDEN", "Cliente no pertenece a tu admin");

  if (!payload?.start_date) throw new AppError(400, "VALIDATION_ERROR", "start_date requerido");
  if (!payload?.installments_count || Number(payload.installments_count) <= 0) {
    throw new AppError(400, "VALIDATION_ERROR", "installments_count inválido");
  }

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

    if (clientRow.vendor_id !== vendorId) {
      const inRoute = await vendorHasClientInAssignedRoute(auth.adminId, vendorId, clientId);
      if (!inRoute) throw new AppError(403, "FORBIDDEN", "No asignado a este vendor");
    }
  } else {
    if (payload.vendor_id) {
      const v = await getVendorById(payload.vendor_id);
      if (!v || v.deleted_at) throw new AppError(404, "NOT_FOUND", "Vendor no encontrado");
      if (v.admin_id !== auth.adminId) throw new AppError(403, "FORBIDDEN", "Vendor no pertenece a tu admin");
      if (String(v.status || "").toLowerCase() !== "active") throw new AppError(403, "FORBIDDEN", "Vendor inactivo");
      vendorId = payload.vendor_id;
    }
  }

  const principal = round2(payload.principal_amount);
  if (principal <= 0) throw new AppError(400, "VALIDATION_ERROR", "principal_amount inválido");

  const interestRate = round2(payload.interest_rate || 0);
  const count = Number(payload.installments_count);
  const currencyCode = String(payload.currency_code || "COP").toUpperCase();
  const frequency = payload.payment_frequency || "daily";

  const total = round2(principal * (1 + interestRate / 100));
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
         payment_frequency, status, total_amount, balance, balance_amount, currency_code, notes)
       VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,'active',$9,$10,$11,$12,$13)
       RETURNING
        id, admin_id, client_id, vendor_id,
        principal_amount::float8, interest_rate::float8,
        installments_count, start_date, payment_frequency, status,
        total_amount::float8, balance::float8, balance_amount::float8,
        currency_code, notes, created_at, updated_at`,
      [auth.adminId, clientId, vendorId, principal, interestRate, count,
       payload.start_date, frequency, total, total, total, currencyCode, payload.notes || null]
    );

    const credit = cr.rows[0];

    // Batch insert all installments in a single query
    const instNums = [];
    const dueDates = [];
    const amountsDue = [];
    for (let i = 1; i <= count; i++) {
      instNums.push(i);
      dueDates.push(calcDueDate(payload.start_date, i - 1, frequency));
      amountsDue.push((i === count ? baseCents + remainder : baseCents) / 100);
    }
    await client.query(
      `INSERT INTO installments (credit_id, installment_number, due_date, amount_due, amount_paid, status)
       SELECT $1, n, d::date, a, 0, 'pending'
       FROM unnest($2::int[], $3::text[], $4::numeric[]) AS t(n, d, a)`,
      [credit.id, instNums, dueDates, amountsDue]
    );

    const occurredAt = new Date(payload.start_date + "T00:00:00.000Z");
    const disbNote = `Desembolso crédito (cliente ${clientId})`;

    await client.query(
      `INSERT INTO admin_cash_movements
        (admin_id, movement_type, category, amount, occurred_at, reference_type, reference_id, note)
       SELECT $1,'expense','credit_disbursement',$2,$3::timestamptz,'credit',$4,$5
       WHERE NOT EXISTS (
         SELECT 1 FROM admin_cash_movements
         WHERE admin_id=$1 AND reference_type='credit' AND reference_id=$4 AND deleted_at IS NULL
       )`,
      [auth.adminId, principal, occurredAt, credit.id, disbNote]
    );

    if (vendorId) {
      await client.query(
        `INSERT INTO vendor_cash_movements
          (admin_id, vendor_id, movement_type, category, amount, occurred_at, reference_type, reference_id, note)
         SELECT $1,$2,'expense','credit_disbursement',$3,$4::timestamptz,'credit',$5,$6
         WHERE NOT EXISTS (
           SELECT 1 FROM vendor_cash_movements
           WHERE admin_id=$1 AND vendor_id=$2 AND reference_type='credit' AND reference_id=$5 AND deleted_at IS NULL
         )`,
        [auth.adminId, vendorId, principal, occurredAt, credit.id, disbNote]
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

      // Allow if: credit is theirs, client is assigned to them, or client is in their route
      if (credit.vendor_id !== auth.vendorId) {
        const [inRoute, clientRow] = await Promise.all([
          vendorHasClientInAssignedRoute(auth.adminId, auth.vendorId, credit.client_id),
          query(
            `SELECT vendor_id FROM clients WHERE id=$1 AND deleted_at IS NULL LIMIT 1`,
            [credit.client_id]
          ).then((r) => r.rows[0] || {}),
        ]);
        if (!inRoute && clientRow.vendor_id !== auth.vendorId) {
          throw new AppError(403, "FORBIDDEN", "No asignado a este vendor");
        }
      }
    }

    if (String(credit.status).toLowerCase() === "cancelled") {
      throw new AppError(400, "VALIDATION_ERROR", "Crédito cancelado");
    }

    const amount = round2(payload.amount);
    if (amount <= 0) throw new AppError(400, "VALIDATION_ERROR", "Monto inválido");

    const balanceCents = Math.round(Number(credit.balance_amount) * 100);
    const payCents = Math.round(amount * 100);
    if (payCents > balanceCents) throw new AppError(400, "VALIDATION_ERROR", "El pago excede el saldo");

    const pr = await client.query(
      `INSERT INTO payments
        (admin_id, credit_id, vendor_id, amount, method, note, paid_at)
       VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7, now()))
       RETURNING id, admin_id, credit_id, vendor_id,
        amount::float8, method, note, paid_at, created_at`,
      [
        auth.adminId, creditId,
        auth.role === "vendor" ? auth.vendorId : null,
        amount, payload.method || "cash", payload.note || null, payload.paid_at || null
      ]
    );

    const payment = pr.rows[0];
    const payAt = payment.paid_at ? new Date(payment.paid_at) : new Date();
    const payNote = `Pago recibido (crédito)`;

    await client.query(
      `INSERT INTO admin_cash_movements
        (admin_id, movement_type, category, amount, occurred_at, reference_type, reference_id, note)
       SELECT $1,'income','payment',$2,$3::timestamptz,'payment',$4,$5
       WHERE NOT EXISTS (
         SELECT 1 FROM admin_cash_movements
         WHERE admin_id=$1 AND reference_type='payment' AND reference_id=$4 AND deleted_at IS NULL
       )`,
      [auth.adminId, amount, payAt, payment.id, payNote]
    );

    const vendorCashVendorId = payment.vendor_id || credit.vendor_id || null;
    if (vendorCashVendorId) {
      await client.query(
        `INSERT INTO vendor_cash_movements
          (admin_id, vendor_id, movement_type, category, amount, occurred_at, reference_type, reference_id, note)
         SELECT $1,$2,'income','payment',$3,$4::timestamptz,'payment',$5,$6
         WHERE NOT EXISTS (
           SELECT 1 FROM vendor_cash_movements
           WHERE admin_id=$1 AND vendor_id=$2 AND reference_type='payment' AND reference_id=$5 AND deleted_at IS NULL
         )`,
        [auth.adminId, vendorCashVendorId, amount, payAt, payment.id, payNote]
      );
    }

    const instRes = await client.query(
      `SELECT id, installment_number, amount_due::float8, amount_paid::float8, status, due_date
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
      const isPastDue = dueDate.getTime() < new Date(today.toISOString().slice(0, 10) + "T00:00:00.000Z").getTime();
      const newStatus = fullyPaid ? (isPastDue ? "paid_late" : "paid") : isPastDue ? "late" : "pending";

      await client.query(
        `UPDATE installments SET amount_paid=$2, status=$3, updated_at=now() WHERE id=$1`,
        [inst.id, newPaidCents / 100, newStatus]
      );

      remainingCents -= payToThis;
    }

    const newBalance = round2(Number(credit.balance_amount) - amount);
    const finalBalance = newBalance < 0 ? 0 : newBalance;
    const paidOff = Math.round(finalBalance * 100) <= 0;

    await client.query(
      `UPDATE credits
       SET balance_amount=$2, balance=$2,
           status = CASE WHEN $3 THEN 'paid' ELSE status END,
           updated_at=now()
       WHERE id=$1`,
      [creditId, finalBalance, paidOff]
    );

    await client.query("COMMIT");

    return {
      payment,
      credit: { balance_amount: finalBalance, status: paidOff ? "paid" : credit.status }
    };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function listClientCredits(auth, clientId) {
  const clientRow = await getClientById(clientId);
  if (!clientRow || clientRow.deleted_at) throw new AppError(404, "NOT_FOUND", "Cliente no encontrado");
  if (clientRow.admin_id !== auth.adminId) throw new AppError(403, "FORBIDDEN", "Cliente no pertenece a tu admin");

  const r = await query(
    `SELECT
       c.id, c.admin_id, c.client_id, c.vendor_id,
       c.principal_amount::float8, c.interest_rate::float8,
       c.installments_count, c.start_date, c.payment_frequency, c.status,
       c.total_amount::float8, c.balance::float8, c.balance_amount::float8,
       c.currency_code, c.notes, c.created_at, c.updated_at,
       v.name AS vendor_name,
       (
         SELECT json_agg(i ORDER BY i.installment_number)
         FROM (
           SELECT id, installment_number, due_date,
                  amount_due::float8, amount_paid::float8, status
           FROM installments
           WHERE credit_id = c.id
           ORDER BY installment_number
         ) i
       ) AS installments
     FROM credits c
     LEFT JOIN vendors v ON v.id = c.vendor_id
     WHERE c.client_id = $1 AND c.deleted_at IS NULL
     ORDER BY c.created_at DESC`,
    [clientId]
  );

  return r.rows;
}

module.exports = { createCredit, createPayment, listClientCredits };
