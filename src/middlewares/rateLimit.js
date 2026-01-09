const rateLimit = require("express-rate-limit");

// ✅ Este middleware NO debe tumbar el server si faltan env vars.
// Soporta:
//   - config/env.js exportando { env }
//   - config/env.js exportando el objeto env directo
let env = {};
try {
  const envMod = require("../config/env");
  env = envMod?.env || envMod || {};
} catch {
  env = {};
}

function toPositiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

const DISABLED =
  String(process.env.RATE_LIMIT_DISABLED || "").toLowerCase() === "true";

const RATE_LIMIT_WINDOW_MS = toPositiveInt(
  process.env.RATE_LIMIT_WINDOW_MS ?? env.RATE_LIMIT_WINDOW_MS,
  15 * 60 * 1000
);

// 🔥 Default más alto para producción móvil (evita 429 por refrescos)
const RATE_LIMIT_MAX = toPositiveInt(
  process.env.RATE_LIMIT_MAX ?? env.RATE_LIMIT_MAX,
  1000
);

const RATE_LIMIT_AUTH_WINDOW_MS = toPositiveInt(
  process.env.RATE_LIMIT_AUTH_WINDOW_MS ?? env.RATE_LIMIT_AUTH_WINDOW_MS,
  15 * 60 * 1000
);

const RATE_LIMIT_AUTH_MAX = toPositiveInt(
  process.env.RATE_LIMIT_AUTH_MAX ?? env.RATE_LIMIT_AUTH_MAX,
  200
);

// ✅ NO limitar endpoint que se llama muy seguido (ej: ubicación /location)
function shouldSkip(req) {
  if (DISABLED) return true;

  // req.path cuando estás montado en /api -> "/vendors/:id/location"
  const p = req.path || "";
  if (req.method === "POST" && /\/vendors\/[^/]+\/location$/.test(p)) return true;

  // opcional: health/ping
  if (req.method === "GET" && (p === "/health" || p === "/ping")) return true;

  return false;
}

const generalLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  skip: shouldSkip,
  message: {
    ok: false,
    error: { code: "RATE_LIMIT", message: "Too many requests, please try again later." }
  }
});

const authLimiter = rateLimit({
  windowMs: RATE_LIMIT_AUTH_WINDOW_MS,
  max: RATE_LIMIT_AUTH_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => DISABLED,
  message: {
    ok: false,
    error: { code: "AUTH_RATE_LIMIT", message: "Too many login attempts, try again later." }
  }
});

// Backwards-compatible alias used by src/routes/index.js
const apiLimiter = generalLimiter;

module.exports = { apiLimiter, generalLimiter, authLimiter };

