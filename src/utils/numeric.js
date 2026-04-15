function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function clampInt(n, { min, max, fallback }) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(v)));
}

function toInt(v, def) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

function clampPagination(limit, offset, { min = 1, max = 200, defaultLimit = 50 } = {}) {
  const lim = Math.min(Math.max(toInt(limit, defaultLimit), min), max);
  const off = Math.max(toInt(offset, 0), 0);
  return { lim, off };
}

module.exports = { round2, clampInt, toInt, clampPagination };
