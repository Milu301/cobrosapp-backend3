const { AppError } = require("./appError");

function toISODate(d) {
  return d.toISOString().slice(0, 10);
}

function addMonths(isoDate, monthsToAdd) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const targetMonth = date.getUTCMonth() + monthsToAdd;
  date.setUTCMonth(targetMonth);

  // Clamp to last valid day of the target month (e.g. Jan 31 + 1 month → Feb 28)
  while (date.getUTCDate() !== d && date.getUTCDate() < d) {
    date.setUTCDate(date.getUTCDate() - 1);
  }

  return toISODate(date);
}

function nowUtcIso() {
  return new Date().toISOString();
}

function addDays(dateStr, days) {
  const d = new Date(dateStr + "T00:00:00.000Z");
  d.setUTCDate(d.getUTCDate() + days);
  return toISODate(d);
}

function assertDateYYYYMMDD(dateStr) {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(String(dateStr || ""))) {
    throw new AppError(400, "VALIDATION_ERROR", "date debe ser YYYY-MM-DD");
  }
}

function dayWindowSql(column, dateParamIdx, tzParamIdx) {
  return `${column} >= ($${dateParamIdx}::date::timestamp AT TIME ZONE $${tzParamIdx})
      AND ${column} <  (($${dateParamIdx}::date + 1)::timestamp AT TIME ZONE $${tzParamIdx})`;
}

function dayRangeUTC(dateStr) {
  const start = new Date(dateStr + "T00:00:00.000Z");
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

module.exports = { toISODate, addMonths, nowUtcIso, addDays, assertDateYYYYMMDD, dayWindowSql, dayRangeUTC };
