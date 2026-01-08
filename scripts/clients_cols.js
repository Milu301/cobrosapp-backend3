require("dotenv").config();
const { Client } = require("pg");

(async () => {
  const ssl =
    (process.env.DB_SSL || "true").toLowerCase() === "true"
      ? { rejectUnauthorized: false }
      : false;

  const c = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl
  });

  const sql =
    "select column_name, data_type " +
    "from information_schema.columns " +
    "where table_schema='public' and table_name='clients' " +
    "order by ordinal_position";

  try {
    await c.connect();
    const r = await c.query(sql);
    console.table(r.rows);
  } catch (e) {
    console.error("DB FAIL ❌", e.message);
    process.exitCode = 1;
  } finally {
    await c.end().catch(() => {});
  }
})();
