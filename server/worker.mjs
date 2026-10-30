import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.mjs";
import { StateStore } from "./state.mjs";
import { Warehouse } from "./warehouse.mjs";
import { executeRelease } from "./release.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const config = loadConfig(process.env, root, "worker");
if (config.mode !== "snowflake")
  throw new Error("The production worker requires APP_MODE=snowflake.");
const state = new StateStore(resolve(config.stateDir, "operations.sqlite"));
const warehouse = new Warehouse(config),
  owner = randomUUID();
let stopping = false,
  activeController;
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    stopping = true;
    activeController?.abort();
  });
function log(event, fields = {}) {
  process.stdout.write(
    JSON.stringify({
      at: new Date().toISOString(),
      component: "worker",
      event,
      ...fields,
    }) + "\n",
  );
}
let lastScheduled = Date.now();
try {
  while (!stopping) {
    state.workerHeartbeat();
    state.prune();
    if (
      config.scheduleMinutes &&
      Date.now() - lastScheduled >= config.scheduleMinutes * 60000
    ) {
      state.enqueue("scheduler");
      lastScheduled = Date.now();
    }
    const job = state.claim(owner);
    if (!job) {
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }
    activeController = new AbortController();
    const heartbeat = setInterval(() => {
      state.workerHeartbeat();
      if (!state.heartbeat(owner, job.id)) activeController.abort();
    }, 10000);
    const timeout = setTimeout(
      () => activeController.abort(),
      config.jobTimeoutMs,
    );
    log("job_started", { jobId: job.id });
    try {
      const release = await executeRelease(
        config,
        state,
        warehouse,
        job,
        owner,
        activeController.signal,
      );
      log("release_published", {
        jobId: job.id,
        schema: release.schema,
        tests: release.checks.length,
      });
    } catch (error) {
      const code = error.code || "RELEASE_FAILED";
      state.failJob(job.id, owner, code);
      state.audit(job.actor, "pipeline_run", job.id, "failed");
      log("job_failed", { jobId: job.id, code });
    } finally {
      clearInterval(heartbeat);
      clearTimeout(timeout);
      activeController = null;
    }
  }
} finally {
  await warehouse.close();
  state.close();
}
