// Convenience exports so features can do: const { query, tx } = require("../../db")
// Node will resolve this file when requiring the "src/db" folder.

const { pool, query } = require("./pool");
const { withTransaction } = require("./tx");

// Keep the old API name expected by some features (tx(fn)).
async function tx(fn) {
  return withTransaction(fn);
}

module.exports = { pool, query, tx, withTransaction };
