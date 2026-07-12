import { createApp } from "./app.js";
import { env } from "./core/config/env.js";
import { getRootLogger } from "./core/logging/logger.js";
import { MongoUnreachableError } from "./core/database/mongodb-service.js";

const log = getRootLogger();

async function main() {
  const { app, startup, db } = await createApp();

  // Run startup sequence (connect DB, load entities, seed data)
  await startup();

  // Start listening
  await app.listen({ port: env.PORT, host: env.HOST });

  log.info({ port: env.PORT, host: env.HOST, url: env.BASE_URL }, "Server listening");

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    log.info({ signal }, "Shutdown signal received");
    await app.close();
    await db.disconnect();
    log.info("Server stopped");
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  // MongoUnreachableError gets a one-line actionable hint instead of the
  // full driver stack — the stack adds noise without information when the
  // root cause is "the DB isn't running." For everything else, log the
  // full error so root-cause diagnosis stays possible.
  if (err instanceof MongoUnreachableError) {
    log.fatal(
      { uri: err.uri },
      `MongoDB unreachable at ${err.uri}. ` +
        "Start dependencies with: pnpm docker:up  " +
        "(spins up mongo+redis+seq via docker/docker-compose.yml)",
    );
  } else {
    log.fatal({ err }, "Failed to start server");
  }
  process.exit(1);
});
