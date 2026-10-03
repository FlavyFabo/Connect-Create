import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb } from "./client";
import { loadEnv } from "../env";

const env = loadEnv();
const { pool, db } = createDb(env.DATABASE_URL);

await migrate(db, { migrationsFolder: "./drizzle" });
await pool.end();
console.log("migrations applied");
