require("dotenv").config();
const { Client } = require("pg");

const BASE = process.env.SMOKE_BASE_URL || "http://localhost:4000";
const DB_SSL = (process.env.DB_SSL || "true").toLowerCase() === "true";

async function j(method, url, token, body) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const txt = await res.text();
  let json;
  try { json = JSON.parse(txt); } catch { json = { raw: txt }; }
  return { status: res.status, json };
}

async function dbExec(sql, params) {
  const c = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: DB_SSL ? { rejectUnauthorized: false } : false
  });
  await c.connect();
  try {
    return await c.query(sql, params);
  } finally {
    await c.end().catch(() => {});
  }
}

(async () => {
  const today = new Date().toISOString().slice(0, 10);
  console.log("== Smoke tests ==");
  console.log("BASE:", BASE, "DATE:", today);

  // 1) Admin login
  const login = await j("POST", `${BASE}/api/auth/admin/login`, null, {
    email: "admin@demo.local",
    password: "Admin123!"
  });
  if (!login.json.ok) throw new Error("Admin login failed: " + JSON.stringify(login.json));
  const adminToken = login.json.data.token;
  const adminId = login.json.data.admin.id;
  console.log("✅ Admin login", adminId);

  // 2) Create vendor + vendor login
  const stamp = Date.now();
  const vendorEmail = `v${stamp}@demo.local`;

  const vCreate = await j("POST", `${BASE}/api/admins/${adminId}/vendors`, adminToken, {
    email: vendorEmail,
    password: "Vendor123!",
    name: `Vendor ${stamp}`,
    phone: "3000000000",
    status: "active",
    permissions: { canCreateCredits: true }
  });
  if (!vCreate.json.ok) throw new Error("Vendor create failed: " + JSON.stringify(vCreate.json));
  const vendorId = vCreate.json.data.id;
  console.log("✅ Vendor created", vendorId);

  const vLogin = await j("POST", `${BASE}/api/auth/vendor/login`, null, {
    email: vendorEmail,
    password: "Vendor123!"
  });
  if (!vLogin.json.ok) throw new Error("Vendor login failed: " + JSON.stringify(vLogin.json));
  const vendorToken = vLogin.json.data.token;
  console.log("✅ Vendor login");

  // 3) Create client
  const cCreate = await j("POST", `${BASE}/api/admins/${adminId}/clients`, adminToken, {
    name: "Cliente Smoke",
    phone: "3001234567",
    doc_id: `CC${stamp}`,
    address: "Calle 1",
    status: "active",
    notes: "smoke"
  });
  if (!cCreate.json.ok) throw new Error("Client create failed: " + JSON.stringify(cCreate.json));
  const clientId = cCreate.json.data.id;
  console.log("✅ Client created", clientId);

  // 4) Create credit
  const crCreate = await j("POST", `${BASE}/api/clients/${clientId}/credits`, adminToken, {
    principal_amount: 100000,
    interest_rate: 10,
    installments_count: 5,
    start_date: today,
    notes: "smoke credit"
  });
  if (!crCreate.json.ok) throw new Error("Credit create failed: " + JSON.stringify(crCreate.json));
  const creditId = crCreate.json.data.id;
  console.log("✅ Credit created", creditId);

  // 5) Pay
  const pay = await j("POST", `${BASE}/api/credits/${creditId}/payments`, vendorToken, {
    amount: 25000,
    method: "cash",
    note: "smoke payment"
  });
  if (!pay.json.ok) throw new Error("Payment failed: " + JSON.stringify(pay.json));
  console.log("✅ Payment ok");

  // 6) Cash movement vendor
  const cash = await j("POST", `${BASE}/api/vendors/${vendorId}/cash/movements`, vendorToken, {
    movement_type: "income",
    category: "cash",
    amount: 25000,
    note: "smoke cash"
  });
  if (!cash.json.ok) throw new Error("Vendor cash failed: " + JSON.stringify(cash.json));
  console.log("✅ Vendor cash ok");

  // 7) Location
  const loc = await j("POST", `${BASE}/api/vendors/${vendorId}/location`, vendorToken, {
    lat: 4.7110, lng: -74.0721, accuracy_m: 12, source: "foreground"
  });
  if (!loc.json.ok) throw new Error("Location failed: " + JSON.stringify(loc.json));
  console.log("✅ Location ok");

  // 8) Reports
  const rep1 = await j("GET", `${BASE}/api/admins/${adminId}/reports/collections?date=${today}`, adminToken);
  if (!rep1.json.ok) throw new Error("Report collections failed: " + JSON.stringify(rep1.json));
  console.log("✅ Reports collections ok");

  // 9) Expire subscription and verify block admin + vendor
  await dbExec(
    `UPDATE admins SET subscription_expires_at = now() - interval '1 minute' WHERE id = $1`,
    [adminId]
  );

  const blockedAdmin = await j("GET", `${BASE}/api/admins/${adminId}/clients?limit=1&offset=0`, adminToken);
  if (!(blockedAdmin.status === 403 && blockedAdmin.json?.error?.code === "SUBSCRIPTION_EXPIRED")) {
    throw new Error("Expected admin SUBSCRIPTION_EXPIRED, got: " + JSON.stringify(blockedAdmin));
  }

  const blockedVendor = await j("GET", `${BASE}/api/vendors/${vendorId}/clients?limit=1&offset=0`, vendorToken);
  if (!(blockedVendor.status === 403 && blockedVendor.json?.error?.code === "SUBSCRIPTION_EXPIRED")) {
    throw new Error("Expected vendor SUBSCRIPTION_EXPIRED, got: " + JSON.stringify(blockedVendor));
  }

  console.log("✅ Subscription expired blocks admin+vendor");

  // restore subscription 30 days
  await dbExec(
    `UPDATE admins SET subscription_expires_at = now() + interval '30 days' WHERE id = $1`,
    [adminId]
  );

  console.log("\n🎉 SMOKE TESTS PASSED");
})().catch((e) => {
  console.error("\n❌ SMOKE TESTS FAILED:", e.message);
  process.exit(1);
});
