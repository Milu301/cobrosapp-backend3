const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Client } = require("pg");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

function must(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

function sha256(s) {
  return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

async function getApplied(client) {
  const r = await client.query(`SELECT name, checksum FROM schema_migrations ORDER BY applied_at ASC`);
  const map = new Map();
  for (const row of r.rows) map.set(row.name, row.checksum);
  return map;
}

async function tableExists(client, table) {
  const r = await client.query(`SELECT to_regclass($1) as reg`, [`public.${table}`]);
  return r.rows[0].reg !== null;
}

async function hasAnyRow(client, table) {
  const r = await client.query(`SELECT EXISTS(SELECT 1 FROM ${table} LIMIT 1) as ok`);
  return !!r.rows[0].ok;
}

async function markApplied(client, name, checksum) {
  await client.query(
    `INSERT INTO schema_migrations(name, checksum) VALUES($1,$2)
     ON CONFLICT (name) DO NOTHING`,
    [name, checksum]
  );
}

async function runFile(client, filePath) {
  const name = path.basename(filePath);
  const sql = fs.readFileSync(filePath, "utf8");
  const checksum = sha256(sql);

  console.log(`\n==> Running: ${name}`);
  await client.query(sql);
  await markApplied(client, name, checksum);
  console.log(`✅ Done: ${name}`);
}

function resolveDatabaseRoot() {
  // Railway normalmente ejecuta el proyecto en /app y el cwd es el root del repo.
  const candidates = [
    path.resolve(process.cwd(), "database"),          // ✅ recomendado
    path.resolve(__dirname, "../database"),           // /app/scripts -> /app/database
    path.resolve(__dirname, "../../database"),        // fallback por si cambia layout
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }

  // mensaje claro para debug
  console.error("❌ No se encontró carpeta 'database' en ninguno de estos paths:");
  for (const p of candidates) console.error(" -", p);
  return null;
}

(async () => {
  const DATABASE_URL = must("DATABASE_URL");
  const DB_SSL = (process.env.DB_SSL || "true").toLowerCase() === "true";

  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: DB_SSL ? { rejectUnauthorized: false } : false
  });

  const root = resolveDatabaseRoot();
  if (!root) {
    process.exitCode = 1;
    return;
  }

  const migrationsDir = path.join(root, "migrations");
  const seedDir = path.join(root, "seed");

  if (!fs.existsSync(migrationsDir)) {
    console.error(`❌ No existe: ${migrationsDir}`);
    console.error("👉 Asegúrate que en tu repo esté: database/migrations/*.sql");
    process.exitCode = 1;
    return;
  }

  // seed es opcional, pero si existe lo usamos
  const hasSeed = fs.existsSync(seedDir);

  const migrationFiles = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => path.join(migrationsDir, f));

  const seedFiles = hasSeed
    ? fs
        .readdirSync(seedDir)
        .filter((f) => f.endsWith(".sql"))
        .sort()
        .map((f) => path.join(seedDir, f))
    : [];

  try {
    await client.connect();
    console.log("✅ DB connected");
    console.log("📁 database root:", root);

    await ensureMigrationsTable(client);

    // ✅ Bootstrap: si ya existen tablas base, marcamos migraciones base como “aplicadas”
    const baseOk =
      (await tableExists(client, "admins")) &&
      (await tableExists(client, "vendors")) &&
      (await tableExists(client, "clients"));

    const applied = await getApplied(client);

    if (applied.size === 0 && baseOk) {
      const baseNames = ["001_extensions.sql", "002_tables.sql", "003_indexes_triggers.sql"];
      for (const n of baseNames) {
        const fp = path.join(migrationsDir, n);
        if (fs.existsSync(fp)) {
          const sql = fs.readFileSync(fp, "utf8");
          await markApplied(client, n, sha256(sql));
        }
      }

      // si ya hay admin en DB, marcamos seed como aplicado
      const seedName = "001_seed_admin.sql";
      const seedPath = path.join(seedDir, seedName);
      if (hasSeed && fs.existsSync(seedPath)) {
        const hasAdmin = await hasAnyRow(client, "admins");
        if (hasAdmin) {
          const sql = fs.readFileSync(seedPath, "utf8");
          await markApplied(client, seedName, sha256(sql));
        }
      }

      console.log("ℹ️ Bootstrap: DB ya tenía tablas base. Migraciones base marcadas como aplicadas.");
    }

    // Re-cargar aplicadas (por si acabamos de bootstrapped)
    const applied2 = await getApplied(client);

    for (const f of migrationFiles) {
      const name = path.basename(f);
      if (applied2.has(name)) continue;
      await runFile(client, f);
    }

    for (const f of seedFiles) {
      const name = path.basename(f);
      if (applied2.has(name)) continue;
      await runFile(client, f);
    }

    console.log("\n🎉 DB migrated + seeded");
  } catch (e) {
    console.error("\n❌ DB apply failed:", e.message);
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
})();
