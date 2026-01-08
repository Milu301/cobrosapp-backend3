const dotenv = require("dotenv");
dotenv.config();

function must(name, fallback = undefined) {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === null || String(v).trim() === "") {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

const env = {
  NODE_ENV: process.env.NODE_ENV || "development",
  PORT: Number(process.env.PORT || 4000),

  // ✅ NUEVO: bind host (necesario para emulador/lan)
  HOST: process.env.HOST || "0.0.0.0",

  DATABASE_URL: must("DATABASE_URL"),
  DB_SSL: (process.env.DB_SSL || "true").toLowerCase() === "true",

  JWT_SECRET: must("JWT_SECRET", "CHANGE_ME_SUPER_SECRET"),
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || "7d",
  DEVICE_HASH_SALT: process.env.DEVICE_HASH_SALT || process.env.JWT_SECRET || "cobrosapp",

  CORS_ORIGINS: process.env.CORS_ORIGINS || "*",

  RATE_LIMIT_WINDOW_MS: Number(process.env.RATE_LIMIT_WINDOW_MS || 900000),
  RATE_LIMIT_MAX: Number(process.env.RATE_LIMIT_MAX || 200),
  RATE_LIMIT_AUTH_MAX: Number(process.env.RATE_LIMIT_AUTH_MAX || 20),

  LOG_LEVEL: process.env.LOG_LEVEL || "info"
};

module.exports = { env };
