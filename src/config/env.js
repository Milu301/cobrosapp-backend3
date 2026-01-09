const dotenv = require("dotenv");
dotenv.config();

// Acepta ambos nombres de variable para evitar crashes por typo
// - CORS_ORIGINS: "*" o lista separada por comas
// - CORS_ORIGIN:  alias legacy
const corsOrigins = process.env.CORS_ORIGINS || process.env.CORS_ORIGIN || "*";

const env = {
  NODE_ENV: process.env.NODE_ENV || "development",
  PORT: Number(process.env.PORT || 3000),
  HOST: process.env.HOST || "0.0.0.0",

  // ✅ NUEVO: zona horaria para reportes/caja (ej: America/Bogota)
  APP_TIMEZONE: process.env.APP_TIMEZONE || "America/Bogota",

  DATABASE_URL: process.env.DATABASE_URL,

  // Supabase/Neon/etc: muchas veces requiere SSL detrás de poolers
  DB_SSL: String(process.env.DB_SSL || "").toLowerCase() === "true",

  JWT_SECRET: process.env.JWT_SECRET || "secret",
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || "7d",

  // Compat: el código usa CORS_ORIGINS, pero aceptamos ambos nombres.
  CORS_ORIGINS: corsOrigins,
  CORS_ORIGIN: corsOrigins,

  // Subscription / Billing
  SUBSCRIPTION_ENABLED: String(process.env.SUBSCRIPTION_ENABLED || "false").toLowerCase() === "true",
  SUBSCRIPTION_TRIAL_DAYS: Number(process.env.SUBSCRIPTION_TRIAL_DAYS || 7),

  // ✅ RATE LIMIT (para que NO crashee y NO te bloquee todo)
  RATE_LIMIT_ENABLED: String(process.env.RATE_LIMIT_ENABLED || "true").toLowerCase() === "true",
  RATE_LIMIT_WINDOW_MS: Number(process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
  RATE_LIMIT_MAX: Number(process.env.RATE_LIMIT_MAX || 2000),
  RATE_LIMIT_AUTH_MAX: Number(process.env.RATE_LIMIT_AUTH_MAX || 300),
};

module.exports = { env };
