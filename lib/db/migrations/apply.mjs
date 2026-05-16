import pg from "pg";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(path.join(__dirname, "add_audit_and_jobs.sql"), "utf-8");

const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
console.log("Connected to Neon.");

const result = await client.query(sql);
const results = Array.isArray(result) ? result : [result];
for (const r of results) {
  if (r.rows?.length) console.log(r.rows);
}
console.log("Migration applied successfully.");
await client.end();
