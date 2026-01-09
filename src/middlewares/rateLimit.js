const rateLimit = require("express-rate-limit");

// ✅ Robust: soporta env exportado como { env } o export directo
const envModule = require("../config/env");
const env = (envModule && envModule.env) ? envModule.env : (envModule || {});

// ✅ Defaults para que NO crashee si Railway no tiene variables
const RATE_LIMIT_ENABLED = String(env.RATE_LIMIT_ENABLED ?? process.env.RATE_LIMIT_ENABLED ?? "true").toLowerCase() !== "false";

// 15 min por defecto
const RATE_LIMIT_WINDOW_MS = Number(env.RATE_LIMIT_WINDOW_MS ?? process.env.RATE_LIMIT_WINDOW_MS ?? (15 * 60 * 1000));

// ✅ Subimos defaults para que NO te tire 429 por la app (la app hace muchas llamadas)
const RATE_LIMIT_MAX = Number(env.RATE_LIMIT_MAX ?? process.env.RATE_LIMIT_MAX ?? 2000);
const RATE_LIMIT_AUTH_MAX = Number(env.RATE_LIMIT_AUTH_MAX ?? process.env.RATE_LIMIT_AUTH_MAX ?? 300);

// fallback si el valor viene NaN
const windowMs = Number.isFinite(RATE_LIMIT_WINDOW_MS) ? RATE_LIMIT_WINDOW_MS : (15 * 60 * 1000);
const max = Number.isFinite(RATE_LIMIT_MAX) ? RATE_LIMIT_MAX : 2000;
const authMax = Number.isFinite(RATE_LIMIT_AUTH_MAX) ? RATE_LIMIT_AUTH_MAX : 300;

function json429(_req, res) {
  return res.status(429).json({
    ok: false,
    error: { code: "TOO_MANY_REQUESTS", message: "Too many requests, please try again later." }
  });
}

// ✅ si deshabilitas RATE_LIMIT_ENABLED=false, no limita nada
function noop(_req, _res, next) {
  return next();
}

const apiLimiter = RATE_LIMIT_ENABLED
  ? rateLimit({
      windowMs,
      max,
      standardHeaders: true,
      legacyHeaders: false,
      handler: (req, res) => json429(req, res)
    })
  : noop;

const authLimiter = RATE_LIMIT_ENABLED
  ? rateLimit({
      windowMs,
      max: authMax,
      standardHeaders: true,
      legacyHeaders: false,
      handler: (req, res) => json429(req, res)
    })
  : noop;

module.exports = { apiLimiter, authLimiter };
