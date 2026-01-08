/*
  Usage:
    node scripts/create_admin.js --email admin2@demo.local --password Admin123! --days 365

  Creates an admin with a bcrypt-hashed password and an active subscription.
*/

const bcrypt = require("bcrypt");
const { query } = require("../src/db/pool");

function arg(name, def = null) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return def;
  return process.argv[idx + 1] ?? def;
}

async function main() {
  const email = arg("email");
  const password = arg("password");
  const days = Number(arg("days", "365"));

  if (!email || !password) {
    console.error("Missing --email or --password");
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const expires = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

  const r = await query(
    `INSERT INTO admins (email, password_hash, status, subscription_expires_at)
     VALUES ($1, $2, 'active', $3)
     RETURNING id, email, status, subscription_expires_at`,
    [email, passwordHash, expires.toISOString()]
  );

  console.log("✅ Admin created:", r.rows[0]);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
