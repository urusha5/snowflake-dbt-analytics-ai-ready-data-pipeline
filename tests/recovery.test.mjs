import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { resolve, join, sep, basename } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { StateStore } from "../server/state.mjs";
import { SnowflakeProvider, MODEL_NAMES } from "../server/warehouse.mjs";
import { createPipeline, build } from "../server/pipeline.mjs";

function cleanup(dir) {
  const target = resolve(dir);
  assert.ok(
    target.startsWith(resolve(tmpdir()) + sep) &&
      basename(target).startsWith("snowstack-"),
  );
  rmSync(target, { recursive: true, force: true });
}
function release(schema) {
  return {
    schema,
    asOf: "2026-10-29",
    checks: [{ name: "fixture", model: "customer_features", status: "pass" }],
    models: MODEL_NAMES.map((name) => ({ name, rows: 1, columns: [] })),
    run: { models: [], tests: 1, duration_ms: 1 },
    sourceCounts: { raw_customer: 3, raw_product: 3, raw_orders: 10 },
  };
}
test("online backup restores committed WAL state and refuses overwrite", () => {
  const dir = mkdtempSync(join(tmpdir(), "snowstack-backup-")),
    state = new StateStore(join(dir, "operations.sqlite")),
    backup = join(dir, "backup.sqlite");
  try {
    const job = state.enqueue("operator");
    state.createSession({ actor: "a", name: "Member", role: "viewer" }, 300);
    const result = spawnSync(
      process.execPath,
      ["scripts/backup-state.mjs", backup],
      {
        cwd: process.cwd(),
        env: { ...process.env, STATE_DIR: dir },
        encoding: "utf8",
        windowsHide: true,
      },
    );
    assert.equal(result.status, 0, result.stderr);
    const restored = new StateStore(backup);
    try {
      assert.equal(restored.jobs()[0].id, job.id);
      assert.equal(
        restored.db.prepare("SELECT count(*) n FROM sessions").get().n,
        1,
      );
    } finally {
      restored.close();
    }
    const again = spawnSync(
      process.execPath,
      ["scripts/backup-state.mjs", backup],
      {
        env: { ...process.env, STATE_DIR: dir },
        encoding: "utf8",
        windowsHide: true,
      },
    );
    assert.notEqual(again.status, 0);
  } finally {
    state.close();
    cleanup(dir);
  }
});
test("older application refuses a newer operational database without downgrading it", () => {
  const dir = mkdtempSync(join(tmpdir(), "snowstack-version-")),
    path = join(dir, "operations.sqlite");
  try {
    const db = new DatabaseSync(path);
    db.exec("PRAGMA user_version=99");
    db.close();
    assert.throws(() => new StateStore(path), /newer application/);
    const check = new DatabaseSync(path);
    assert.equal(check.prepare("PRAGMA user_version").get().user_version, 99);
    check.close();
  } finally {
    cleanup(dir);
  }
});
test("one overview request uses one frozen schema even when a new release publishes mid-request", async () => {
  const state = new StateStore(":memory:");
  try {
    const first = state.enqueue("operator");
    state.claim("worker");
    state.publish(first.id, "worker", release("ANALYTICS_RELEASE_A"));
    const calls = [];
    let switched = false;
    const warehouse = {
      query: async (sql) => {
        calls.push(sql);
        if (!switched) {
          switched = true;
          const second = state.enqueue("operator");
          state.claim("worker");
          state.publish(second.id, "worker", release("ANALYTICS_RELEASE_B"));
        }
        if (sql.includes("COUNT(*) orders"))
          return [{ orders: 10, revenue: 100, customers: 3, aov: 10 }];
        if (sql.includes("GROUP BY p.category"))
          return [{ category: "Electronics", revenue: 100, orders: 10 }];
        return [
          {
            transaction_date: "2026-10-28",
            total_orders: 10,
            total_revenue: 100,
          },
        ];
      },
    };
    const provider = new SnowflakeProvider(
      {
        schemaPrefix: "ANALYTICS_RELEASE",
        maxReleaseAgeHours: 48,
        warehouse: { database: "TEST_DB" },
      },
      state,
      warehouse,
    );
    const data = await provider.overview(30);
    assert.equal(data.releaseId, first.id);
    assert.equal(calls.length, 4);
    assert.ok(calls.every((sql) => sql.includes('"ANALYTICS_RELEASE_A"')));
    assert.equal(state.release().schema, "ANALYTICS_RELEASE_B");
  } finally {
    state.close();
  }
});
test("malformed local dates fail validation instead of disappearing from the pipeline", () => {
  const pipeline = createPipeline();
  try {
    pipeline.db
      .prepare("INSERT INTO raw_orders VALUES(?,?,?,?,?,?,?)")
      .run(9000001, 1, 1, 1, 10, null, new Date().toISOString());
    assert.throws(() => build(pipeline), /data quality checks failed/);
  } finally {
    pipeline.db.close();
  }
});
