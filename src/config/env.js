const env = {
  NODE_ENV: process.env.NODE_ENV || "development",
  PORT: process.env.PORT || 8080,

  DATABASE_URL: process.env.DATABASE_URL || null,

  JWT_SECRET: process.env.JWT_SECRET || "dev_secret_change_me",
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || "7d",

  // ✅ SUBIMOS DEFAULTS (para que ubicación + app no bloquee todo)
  RATE_LIMIT_WINDOW_MS: parseInt(process.env.RATE_LIMIT_WINDOW_MS || "900000", 10), // 15 min
  RATE_LIMIT_MAX: parseInt(process.env.RATE_LIMIT_MAX || "5000", 10), // antes 200

  CORS_ORIGIN: process.env.CORS_ORIGIN || "*",
};

module.exports = env;
