import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.mjs";
import { StateStore } from "./state.mjs";
import { Auth } from "./auth.mjs";
import { createApplication } from "./application.mjs";
import {
  createPipeline,
  overview,
  preview,
  insight,
  build,
  PROJECT_NAME,
} from "./pipeline.mjs";
import { SnowflakeProvider } from "./warehouse.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const config = loadConfig(process.env, root);
const state = new StateStore(resolve(config.stateDir, "operations.sqlite"));
let provider;
if (config.mode === "demo") {
  const pipeline = createPipeline(resolve(config.stateDir, "pipeline.sqlite"));
  provider = {
    overview: async (days) => ({
      ...overview(pipeline, days),
      sourceCounts: {
        raw_customer: 1200,
        raw_product: 30,
        raw_orders: pipeline.db
          .prepare("SELECT count(*) count FROM raw_orders")
          .get().count,
      },
    }),
    preview: async (name, download) =>
      preview(pipeline, name, download ? config.maxExportRows : 12),
    insight: async (question, days) => insight(pipeline, question, days),
    run: async () => build(pipeline),
    ready: async () => pipeline.checks.every((c) => c.status === "pass"),
    close: async () => pipeline.db.close(),
  };
} else provider = new SnowflakeProvider(config, state);
const auth = config.mode === "snowflake" ? new Auth(config, state) : null;
const server = createApplication({ config, state, provider, auth });
const maintenance = setInterval(() => {
  state.prune();
  state.reapExpired();
}, 60000).unref();
server.on("error", (error) => {
  console.error(
    JSON.stringify({
      event: "startup_failed",
      code: error.code || "STARTUP_FAILED",
    }),
  );
  process.exitCode = 1;
  clearInterval(maintenance);
  provider.close().finally(() => state.close());
});
server.listen(config.port, config.host, () =>
  console.log(
    JSON.stringify({
      event: "server_started",
      project: PROJECT_NAME,
      mode: config.mode,
      url: config.origin,
    }),
  ),
);
let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  clearInterval(maintenance);
  const force = setTimeout(() => {
    server.closeAllConnections();
    process.exit(1);
  }, 25000).unref();
  server.close(async () => {
    clearTimeout(force);
    try {
      await provider.close();
      state.close();
      process.exit(0);
    } catch {
      process.exit(1);
    }
  });
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, shutdown);
