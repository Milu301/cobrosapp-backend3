require("dotenv").config();
const { Client } = require("pg");

(async () => {
  const ssl =
    (process.env.DB_SSL || "true").toLowerCase() === "true"
      ? { rejectUnauthorized: false }
      : false;

  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl });

  const tables = ["credits", "installments", "payments"];

  try {
    await c.connect();
    console.log("DB OK ✅");

    for (const t of tables) {
      console.log(`\n== ${t} ==`);
      const r = await c.query(
        `select column_name,data_type
         from information_schema.columns
         where table_schema='public' and table_name=$1
         order by ordinal_position`,
        [t]
      );
      console.table(r.rows);
    }
  } catch (e) {
    console.error("DB FAIL ❌", e.message);
    process.exitCode = 1;
  } finally {
    await c.end().catch(() => {});
  }
})();
