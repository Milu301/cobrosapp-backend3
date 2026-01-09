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

async function vendorHasClientInAssignedRoute(adminId, vendorId, clientId) {
  const r = await query(
    `
    SELECT 1
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

    // ✅ vendor puede crear crédito si:
    // - el cliente está asignado directo (client.vendor_id == vendorId)
    // - O el cliente está en una ruta asignada a este vendor
    if (clientRow.vendor_id !== vendorId) {
      const inRoute = await vendorHasClientInAssignedRoute(auth.adminId, vendorId, clientId);
      if (!inRoute) throw new AppError(403, "FORBIDDEN", "No asignado a este vendor");
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
        balance,
        currencyCode,
        payload.notes || null
      ]
    );

    const credit = cr.rows[0];

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

    // ✅ Caja automática: egreso por préstamo (principal)
    // Admin egreso
    const note = `Desembolso crédito ${credit.id} (cliente ${clientId})`;
    const occurredAt = new Date(payload.start_date + "T00:00:00.000Z");

    await client.query(
      `INSERT INTO admin_cash_movements
        (admin_id, movement_type, category, amount, occurred_at, reference_type, reference_id, note)
       SELECT $1,'expense','credit_disbursement',$2,$3::timestamptz,'credit',$4,$5
       WHERE NOT EXISTS (
         SELECT 1 FROM admin_cash_movements
         WHERE admin_id=$1 AND reference_type='credit' AND reference_id=$4
       )`,
      [auth.adminId, principal, occurredAt, credit.id, note]
    );

    // Vendor egreso (si el crédito quedó asignado a vendor)
    if (vendorId) {
      await client.query(
        `INSERT INTO vendor_cash_movements
          (admin_id, vendor_id, movement_type, category, amount, occurred_at, reference_type, reference_id, note)
         SELECT $1,$2,'expense','credit_disbursement',$3,$4::timestamptz,'credit',$5,$6
         WHERE NOT EXISTS (
           SELECT 1 FROM vendor_cash_movements
           WHERE admin_id=$1 AND vendor_id=$2 AND reference_type='credit' AND reference_id=$5
         )`,
        [auth.adminId, vendorId, principal, occurredAt, credit.id, note]
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

    // ✅ Traemos client_id para validar ruta también
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

      // ✅ vendor puede pagar si:
      // - el crédito está asignado a él
      // - O el cliente está en una ruta asignada a él
      const inRoute = await vendorHasClientInAssignedRoute(auth.adminId, auth.vendorId, credit.client_id);
      if (credit.vendor_id !== auth.vendorId && !inRoute) {
        throw new AppError(403, "FORBIDDEN", "No asignado a este vendor");
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

    // ✅ Caja automática: ingreso por pago (admin + vendor)
    const payAt = payment.paid_at ? new Date(payment.paid_at) : new Date();
    const notePay = `Pago ${payment.id} (crédito ${creditId})`;

    // Admin ingreso (siempre)
    await client.query(
      `INSERT INTO admin_cash_movements
        (admin_id, movement_type, category, amount, occurred_at, reference_type, reference_id, note)
       SELECT $1,'income','payment',$2,$3::timestamptz,'payment',$4,$5
       WHERE NOT EXISTS (
         SELECT 1 FROM admin_cash_movements
         WHERE admin_id=$1 AND reference_type='payment' AND reference_id=$4
       )`,
      [auth.adminId, amount, payAt, payment.id, notePay]
    );

    // Vendor ingreso:
    // - Si el pago lo registra un vendor -> payment.vendor_id
    // - Si lo registra el admin -> lo imputamos al vendor del crédito (si existe)
    const vendorCashVendorId = payment.vendor_id || credit.vendor_id || null;

    if (vendorCashVendorId) {
      const notePayVendor = `Pago ${payment.id} (crédito ${creditId}) vendor ${vendorCashVendorId}`;

      await client.query(
        `INSERT INTO vendor_cash_movements
          (admin_id, vendor_id, movement_type, category, amount, occurred_at, reference_type, reference_id, note)
         SELECT $1,$2,'income','payment',$3,$4::timestamptz,'payment',$5,$6
         WHERE NOT EXISTS (
           SELECT 1 FROM vendor_cash_movements
           WHERE admin_id=$1 AND vendor_id=$2 AND reference_type='payment' AND reference_id=$5
         )`,
        [auth.adminId, vendorCashVendorId, amount, payAt, payment.id, notePayVendor]
      );
    }

    // FIFO a cuotas
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
      const isPastDue = dueDate.getTime() < new Date(today.toISOString().slice(0, 10) + "T00:00:00.000Z").getTime();

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
