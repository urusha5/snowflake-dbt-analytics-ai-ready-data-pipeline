// Explicit, credentialed acceptance check. Run only against a dedicated CI DB.
// It builds and publishes within the isolated STATE_DIR supplied by the operator.
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { loadConfig } from "../server/config.mjs";
import { StateStore } from "../server/state.mjs";
import { Warehouse } from "../server/warehouse.mjs";
import { executeRelease } from "../server/release.mjs";
const config = loadConfig(process.env, process.cwd(), "worker");
if (!config.warehouse.database.endsWith("_CI"))
  throw new Error(
    "Warehouse acceptance checks require a dedicated database ending in _CI.",
  );
const state = new StateStore(resolve(config.stateDir, "operations.sqlite")),
  warehouse = new Warehouse(config),
  owner = randomUUID();
const queued = state.enqueue("acceptance_check");
if (queued.deduplicated)
  throw new Error(
    "An existing job is active; acceptance check will not take it over.",
  );
const job = state.claim(owner),
  controller = new AbortController();
const timer = setTimeout(() => controller.abort(), config.jobTimeoutMs),
  heartbeat = setInterval(() => {
    if (!state.heartbeat(owner, job.id)) controller.abort();
  }, 10000);
try {
  const r = await executeRelease(
    config,
    state,
    warehouse,
    job,
    owner,
    controller.signal,
  );
  console.log(
    JSON.stringify({
      release: r.schema,
      models: r.models.length,
      checks: r.checks.length,
      status: "published",
    }),
  );
} catch (error) {
  state.failJob(job.id, owner, error.code || "ACCEPTANCE_FAILED");
  throw error;
} finally {
  clearTimeout(timer);
  clearInterval(heartbeat);
  await warehouse.close();
  state.close();
}
