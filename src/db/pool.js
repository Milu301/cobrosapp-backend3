const { Pool } = require("pg");
const { env } = require("../config/env");
const { logger } = require("../utils/logger");

function buildPoolConfig() {
  const cfg = {
    connectionString: env.DATABASE_URL,
    max: 10
  };

  // Supabase + pooler requiere SSL.
  // En muchos entornos (Windows/dev) la cadena puede fallar si Node intenta validar CA.
  // Para dev: rejectUnauthorized=false
  if (env.DB_SSL) {
    cfg.ssl = { rejectUnauthorized: false };
  }

  return cfg;
}

const pool = new Pool(buildPoolConfig());

pool.on("error", (err) => {
  logger.error("DB pool error", { message: err.message });
});

async function query(text, params = []) {
  const start = Date.now();
  const res = await pool.query(text, params);
  const ms = Date.now() - start;
  if (ms > 250) logger.warn("Slow query", { ms, text: text.slice(0, 120) });
  return res;
}

module.exports = { pool, query };
