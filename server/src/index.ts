import { createServer } from "node:http";
import { app } from "./app.js";
import { connectDatabase, disconnectDatabase } from "./config/database.js";
import { env } from "./config/env.js";

async function start(): Promise<void> {
  try {
    await connectDatabase();
    const server = createServer(app);
    server.listen(env.PORT, () => console.info(`RecoveryIQ API listening on port ${env.PORT}`));

    const shutdown = (signal: string): void => {
      console.info(`${signal} received; shutting down`);
      server.close(() => { void disconnectDatabase().finally(() => process.exit(0)); });
    };
    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
  } catch (error) {
    console.error("Server startup failed", error);
    process.exit(1);
  }
}
void start();

