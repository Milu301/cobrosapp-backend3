function toISODate(d) {
  return d.toISOString().slice(0, 10);
}

function addMonths(isoDate, monthsToAdd) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const targetMonth = date.getUTCMonth() + monthsToAdd;
  date.setUTCMonth(targetMonth);

  // Ajuste si el día se desborda (ej. 31 -> 30/28)
  while (date.getUTCDate() !== d && date.getUTCDate() < d) {
    date.setUTCDate(date.getUTCDate() - 1);
  }

  return toISODate(date);
}

function nowUtcIso() {
  return new Date().toISOString();
}

module.exports = { toISODate, addMonths, nowUtcIso };
