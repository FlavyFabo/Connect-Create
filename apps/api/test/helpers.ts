import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { createDb, type Db } from "../src/db/client";

const ADMIN_URL =
  process.env.TEST_ADMIN_URL ?? "postgres://postgres:postgres@localhost:5432/postgres";
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://postgres:postgres@localhost:5432/connect_create_test";

export async function setupTestDb(): Promise<{ db: Db; pool: pg.Pool }> {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query("DROP DATABASE IF EXISTS connect_create_test");
  await admin.query("CREATE DATABASE connect_create_test");
  await admin.end();

  const { pool, db } = createDb(TEST_DATABASE_URL);
  await migrate(db, { migrationsFolder: "./drizzle" });
  return { db, pool };
}

let counter = 0;
export function uniqueEmail(): string {
  counter += 1;
  return `user${counter}@example.com`;
}
