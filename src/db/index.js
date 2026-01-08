const { pool, query } = require("./pool");
const { withTransaction } = require("./tx");

// Compat: algunos servicios usan `tx(fn)`
async function tx(fn) {
  return withTransaction(fn);
}

module.exports = { pool, query, tx, withTransaction };
