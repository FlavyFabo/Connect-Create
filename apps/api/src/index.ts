import { buildApp } from "./app";
import { createDb } from "./db/client";
import { loadEnv } from "./env";

const env = loadEnv();
const { db, pool } = createDb(env.DATABASE_URL);

const app = await buildApp({ db, env });

try {
  await app.listen({ port: env.API_PORT, host: "0.0.0.0" });
} catch (err) {
  app.log.error(err);
  await pool.end();
  process.exit(1);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await app.close();
    await pool.end();
    process.exit(0);
  });
}
