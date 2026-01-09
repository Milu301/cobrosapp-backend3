const dotenv = require("dotenv");
dotenv.config();

const env = {
  NODE_ENV: process.env.NODE_ENV || "development",
  PORT: Number(process.env.PORT || 3000),
  HOST: process.env.HOST || "0.0.0.0",

  // ✅ NUEVO: zona horaria para reportes/caja (ej: America/Bogota)
  APP_TIMEZONE: process.env.APP_TIMEZONE || "America/Bogota",

  DATABASE_URL: process.env.DATABASE_URL,
  JWT_SECRET: process.env.JWT_SECRET || "secret",
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || "7d",

  CORS_ORIGIN: process.env.CORS_ORIGIN || "*",

  // Subscription / Billing
  SUBSCRIPTION_ENABLED: String(process.env.SUBSCRIPTION_ENABLED || "false").toLowerCase() === "true",
  SUBSCRIPTION_TRIAL_DAYS: Number(process.env.SUBSCRIPTION_TRIAL_DAYS || 7),
};

module.exports = { env };
