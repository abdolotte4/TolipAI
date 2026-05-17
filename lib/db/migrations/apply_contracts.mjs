import pg from "pg";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(path.join(__dirname, "add_contracts.sql"), "utf-8");

const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
console.log("Connected to Neon.");
await client.query(sql);
console.log("crm_contracts table and indexes created successfully.");
await client.end();
