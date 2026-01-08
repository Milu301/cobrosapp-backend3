/*
  Usage:
    node scripts/reset_password.js --type admin --email admin@demo.local --password NewPass123!
    node scripts/reset_password.js --type vendor --email vendor1@demo.local --password NewPass123!

  Notes:
  - Hashes the password with bcrypt.
  - For vendors, also increments token_version to revoke existing sessions.
*/

const bcrypt = require("bcrypt");
const { query } = require("../src/db/pool");

function arg(name, def = null) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return def;
  return process.argv[idx + 1] ?? def;
}

async function main() {
  const type = arg("type");
  const email = arg("email");
  const password = arg("password");

  if (!type || !email || !password) {
    console.error("Missing --type admin|vendor, --email or --password");
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 12);

  if (type === "admin") {
    const r = await query(
      `UPDATE admins SET password_hash = $2, updated_at = now()
       WHERE email = $1
       RETURNING id, email, status`,
      [email, passwordHash]
    );
    if (!r.rows[0]) throw new Error("Admin not found");
    console.log("✅ Admin password reset:", r.rows[0]);
  } else if (type === "vendor") {
    const r = await query(
      `UPDATE vendors SET password_hash = $2, token_version = token_version + 1, updated_at = now()
       WHERE email = $1
       RETURNING id, email, status, token_version`,
      [email, passwordHash]
    );
    if (!r.rows[0]) throw new Error("Vendor not found");
    console.log("✅ Vendor password reset:", r.rows[0]);
  } else {
    throw new Error("Invalid --type. Use admin or vendor");
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
