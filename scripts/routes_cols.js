require("dotenv").config();
const { Client } = require("pg");

(async () => {
  const ssl =
    (process.env.DB_SSL || "true").toLowerCase() === "true"
      ? { rejectUnauthorized: false }
      : false;

  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl });

  const tables = ["routes", "route_clients", "route_assignments", "route_visits"];

  try {
    await c.connect();
    for (const t of tables) {
      const sql =
        "select column_name, data_type " +
        "from information_schema.columns " +
        "where table_schema='public' and table_name='" + t + "' " +
        "order by ordinal_position";
      const r = await c.query(sql);
      console.log("\n==", t, "==");
      console.table(r.rows);
    }
  } catch (e) {
    console.error("DB FAIL ❌", e.message);
    process.exitCode = 1;
  } finally {
    await c.end().catch(() => {});
  }
})();
