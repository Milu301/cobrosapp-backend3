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

  try {
    await c.connect();
    const r = await c.query("select now() as now");
    console.log("DB OK ✅", r.rows[0]);
  } catch (e) {
    console.error("DB FAIL ❌", e.message);
    process.exitCode = 1;
  } finally {
    await c.end().catch(() => {});
  }
})();
