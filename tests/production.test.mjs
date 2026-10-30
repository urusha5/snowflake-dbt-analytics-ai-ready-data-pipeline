import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep, basename } from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { request as httpRequest } from "node:http";
import { StateStore } from "../server/state.mjs";
import { createApplication, RateLimiter } from "../server/application.mjs";
import { artifactRelease, executeRelease } from "../server/release.mjs";
import {
  MODEL_NAMES,
  SAFE_COLUMNS,
  publicColumns,
  SnowflakeProvider,
  Warehouse,
} from "../server/warehouse.mjs";

function removeFixture(dir) {
  const path = resolve(dir);
  assert.ok(
    path.startsWith(resolve(tmpdir()) + sep) &&
      basename(path).startsWith("snowstack-"),
  );
  rmSync(path, { recursive: true, force: true });
}

function release(schema = "ANALYTICS_RELEASE_TEST") {
  return {
    schema,
    asOf: "2026-10-29",
    checks: [{ name: "fixture_check", model: "orders", status: "pass" }],
    models: MODEL_NAMES.map((name) => ({
      name,
      rows: 1,
      columns: [{ name: "total_amount", type: "NUMBER" }],
    })),
    run: { tests: 1, models: [], duration_ms: 1 },
    sourceCounts: { raw_customer: 3, raw_product: 3, raw_orders: 20 },
  };
}
test("jobs deduplicate, claim once, and prevent a stale worker from publishing", () => {
  let now = 1000;
  const state = new StateStore(":memory:", () => now);
  try {
    const a = state.enqueue("operator"),
      b = state.enqueue("operator");
    assert.equal(a.id, b.id);
    assert.equal(b.deduplicated, true);
    const job = state.claim("first");
    assert.equal(state.claim("second"), null);
    assert.equal(state.heartbeat("wrong", job.id), false);
    now += 120001;
    assert.throws(() => state.publish(job.id, "first", release()), /lease/);
    state.reapExpired();
    assert.equal(state.job(job.id).status, "failed");
    assert.notEqual(state.enqueue("operator").id, job.id);
  } finally {
    state.close();
  }
});
test("publication is atomic, failed checks preserve the previous release, and rollback is audited", () => {
  const s = new StateStore(":memory:");
  try {
    const a = s.enqueue("op");
    s.claim("worker");
    s.publish(a.id, "worker", release("ANALYTICS_RELEASE_A"));
    const b = s.enqueue("op");
    s.claim("worker");
    const invalid = release("ANALYTICS_RELEASE_B");
    invalid.checks[0].status = "fail";
    assert.throws(() => s.publish(b.id, "worker", invalid));
    assert.equal(s.release().id, a.id);
    s.publish(b.id, "worker", release("ANALYTICS_RELEASE_B"));
    s.rollback(a.id, "admin");
    assert.equal(s.release().id, a.id);
    assert.equal(
      s.db
        .prepare("SELECT count(*) n FROM audit WHERE action='rollback_release'")
        .get().n,
      1,
    );
  } finally {
    s.close();
  }
});
test("queue and active release survive reopening the operational database", () => {
  const dir = mkdtempSync(join(tmpdir(), "snowstack-state-")),
    path = join(dir, "state.sqlite");
  let s;
  try {
    s = new StateStore(path);
    const job = s.enqueue("op");
    s.close();
    s = new StateStore(path);
    assert.equal(s.jobs()[0].id, job.id);
    s.claim("worker");
    s.publish(job.id, "worker", release());
    s.close();
    s = new StateStore(path);
    assert.equal(s.release().id, job.id);
  } finally {
    s?.close();
    removeFixture(dir);
  }
});
function artifacts() {
  const nodes = {},
    results = [];
  for (const name of MODEL_NAMES) {
    const id = "model.snowflake_dbt_ai_pipeline." + name;
    nodes[id] = {
      unique_id: id,
      name,
      resource_type: "model",
      package_name: "snowflake_dbt_ai_pipeline",
    };
    results.push({ unique_id: id, status: "success", execution_time: 0.01 });
  }
  for (const name of MODEL_NAMES) {
    const id = "test.snowflake_dbt_ai_pipeline." + name;
    nodes[id] = {
      unique_id: id,
      name: "test_" + name,
      resource_type: "test",
      package_name: "snowflake_dbt_ai_pipeline",
      depends_on: { nodes: ["model.snowflake_dbt_ai_pipeline." + name] },
    };
    results.push({ unique_id: id, status: "pass" });
  }
  return {
    manifest: { nodes, metadata: { dbt_version: "fixture" } },
    results: { results, elapsed_time: 1 },
    sources: {
      results: ["raw_customer", "raw_product", "raw_orders"].map((n) => ({
        unique_id: "source.project.bronze." + n,
        status: "pass",
        max_loaded_at: "2026-10-29T00:00:00Z",
      })),
    },
  };
}
test("release gate rejects missing, failed, skipped, or stale validation results", () => {
  const a = artifacts();
  assert.equal(
    artifactRelease(
      a.manifest,
      a.results,
      a.sources,
      "ANALYTICS_RELEASE_TEST",
      "2026-10-29",
    ).models.length,
    18,
  );
  for (const status of ["fail", "skipped", "warn"]) {
    const bad = structuredClone(a);
    bad.results.results.at(-1).status = status;
    assert.throws(() =>
      artifactRelease(
        bad.manifest,
        bad.results,
        bad.sources,
        "A",
        "2026-10-29",
      ),
    );
  }
  const missing = structuredClone(a);
  missing.results.results.pop();
  assert.throws(() =>
    artifactRelease(
      missing.manifest,
      missing.results,
      missing.sources,
      "A",
      "2026-10-29",
    ),
  );
  const stale = structuredClone(a);
  stale.sources.results[0].status = "error";
  assert.throws(() =>
    artifactRelease(
      stale.manifest,
      stale.results,
      stale.sources,
      "A",
      "2026-10-29",
    ),
  );
});
test("public projections deny direct identifiers and newly added private columns", () => {
  for (const name of MODEL_NAMES) {
    const cols = publicColumns(name, [
      { name: "email" },
      { name: "customer_id" },
      { name: "gender" },
      { name: "age" },
      { name: "new_private_field" },
      ...SAFE_COLUMNS[name].map((name) => ({ name })),
    ]);
    assert.ok(cols.length);
    for (const field of [
      "email",
      "customer_id",
      "gender",
      "age",
      "new_private_field",
    ])
      assert.ok(!cols.some((c) => c.name === field));
  }
});
test("release orchestration freezes sources, grants only safe views, and publishes after successful validation", async () => {
  const dir = mkdtempSync(join(tmpdir(), "snowstack-release-")),
    state = new StateStore(":memory:"),
    a = artifacts(),
    events = [];
  const oldSalt = process.env.CUSTOMER_KEY_SALT;
  process.env.CUSTOMER_KEY_SALT = "fixture-production-salt-32-characters-long";
  const config = {
    root: process.cwd(),
    stateDir: dir,
    schemaPrefix: "ANALYTICS_RELEASE",
    dbtExecutable: "dbt",
    jobTimeoutMs: 60000,
    warehouse: {
      database: "TEST_DB",
      sourceSchema: "BRONZE",
      readerRole: "APP_READER",
    },
  };
  const warehouse = {
    query: async (sql, binds) => {
      events.push(sql);
      if (sql.includes("INFORMATION_SCHEMA.COLUMNS"))
        return MODEL_NAMES.flatMap((name) =>
          [...SAFE_COLUMNS[name], "email", "new_private_field"].map((c) => ({
            table_name: name,
            column_name: c,
            data_type: "VARCHAR",
          })),
        );
      if (sql.startsWith("SELECT COUNT")) return [{ count: 10 }];
      return [];
    },
  };
  const execute = async (_exe, args, options) => {
    events.push("dbt:" + args[0]);
    if (args[0] === "source")
      writeFileSync(
        join(options.env.DBT_TARGET_PATH, "sources.json"),
        JSON.stringify(a.sources),
      );
    else {
      writeFileSync(
        join(options.env.DBT_TARGET_PATH, "manifest.json"),
        JSON.stringify(a.manifest),
      );
      writeFileSync(
        join(options.env.DBT_TARGET_PATH, "run_results.json"),
        JSON.stringify(a.results),
      );
    }
  };
  try {
    const job = state.enqueue("op");
    state.claim("worker");
    const r = await executeRelease(
      config,
      state,
      warehouse,
      job,
      "worker",
      new AbortController().signal,
      execute,
    );
    assert.match(events[0], /CREATE SCHEMA.*CLONE/);
    assert.equal(events[1], "dbt:source");
    assert.equal(events[2], "dbt:build");
    assert.equal(state.release().id, job.id);
    assert.equal(r.models.length, 18);
    for (const sql of events.filter((x) => x.startsWith("GRANT SELECT")))
      assert.match(sql, /ON VIEW.*APP_/);
    assert.ok(
      !events.some((x) => /GRANT SELECT ON ALL|SELECT.*EMAIL.*FROM/i.test(x)),
    );
  } finally {
    state.close();
    if (oldSalt === undefined) delete process.env.CUSTOMER_KEY_SALT;
    else process.env.CUSTOMER_KEY_SALT = oldSalt;
    removeFixture(dir);
  }
});
test("query wrapper binds values, applies a server timeout, and normalizes names", async () => {
  let options;
  const pool = {
    use: async (fn) =>
      fn({
        execute: (o) => {
          options = o;
          queueMicrotask(() => o.complete(null, null, [{ REVENUE: 12.5 }]));
          return { getStatementId: () => "id" };
        },
      }),
  };
  const warehouse = new Warehouse({ queryTimeoutMs: 1000 }, pool);
  assert.deepEqual(await warehouse.query("SELECT ?", ["unsafe'value"]), [
    { revenue: 12.5 },
  ]);
  assert.deepEqual(options.binds, ["unsafe'value"]);
  assert.equal(options.parameters.MULTI_STATEMENT_COUNT, 1);
  assert.equal(options.parameters.STATEMENT_TIMEOUT_IN_SECONDS, 1);
});
test("rate limiting expires and does not depend on caller-supplied proxy headers", () => {
  let now = 0;
  const r = new RateLimiter(2, () => now);
  assert.ok(r.allow("actor"));
  assert.ok(r.allow("actor"));
  assert.equal(r.allow("actor"), false);
  now = 60001;
  assert.ok(r.allow("actor"));
});

async function apiFixture(role = "operator", providerChanges = {}) {
  const state = new StateStore(":memory:");
  state.workerHeartbeat();
  const logs = [];
  const config = {
    root: process.cwd(),
    mode: "snowflake",
    production: true,
    origin: "https://data.example",
    authority: "data.example",
    port: 3000,
    host: "127.0.0.1",
    rateLimit: 120,
    exportsEnabled: false,
    maxExportRows: 5000,
  };
  const provider = {
    ready: async () => true,
    overview: async () => ({ models: [], current: { revenue: 1 } }),
    preview: async () => ({ rows: [] }),
    insight: async () => ({ answer: "Approved SQL answer" }),
    ...providerChanges,
  };
  const auth = {
    session: (req) =>
      req.headers.cookie === "fixture=valid"
        ? { actor: "fixture-actor", name: "User", role, csrf: "fixture-csrf" }
        : null,
    logout: () => "",
  };
  const server = createApplication({
    config,
    state,
    provider,
    auth,
    logger: (e) => logs.push(e),
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  return {
    state,
    logs,
    request: (path, options = {}) =>
      new Promise((resolve, reject) => {
        const req = httpRequest(
          {
            hostname: "127.0.0.1",
            port,
            path,
            method: options.method || "GET",
            headers: {
              Host: "data.example",
              Cookie: "fixture=valid",
              Origin: "https://data.example",
              "X-CSRF-Token": "fixture-csrf",
              "Content-Type": "application/json",
              ...options.headers,
            },
          },
          (res) => {
            const chunks = [];
            res.on("data", (c) => chunks.push(c));
            res.on("end", () =>
              resolve(
                new Response(Buffer.concat(chunks), {
                  status: res.statusCode,
                  headers: res.headers,
                }),
              ),
            );
          },
        );
        req.on("error", reject);
        req.end(options.body);
      }),
    close: async () => {
      await new Promise((r) => server.close(r));
      state.close();
    },
  };
}
test("API requires authentication and does not trust an asserted role header", async () => {
  const f = await apiFixture();
  try {
    const r = await f.request("/api/overview", {
      headers: { Cookie: "", "X-Role": "operator" },
    });
    assert.equal(r.status, 401);
    const root = await f.request("/", { headers: { Cookie: "" } });
    assert.equal(root.status, 302);
    assert.equal(root.headers.get("location"), "/auth/login");
  } finally {
    await f.close();
  }
});
test("viewers cannot run jobs or export, and POST requires CSRF plus same origin", async () => {
  const f = await apiFixture("viewer");
  try {
    assert.equal(
      (await f.request("/api/run", { method: "POST", body: "{}" })).status,
      403,
    );
    assert.equal(
      (await f.request("/api/models?name=orders&download=1")).status,
      403,
    );
    assert.equal(
      (
        await f.request("/api/insights", {
          method: "POST",
          body: "{}",
          headers: { "X-CSRF-Token": "" },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await f.request("/api/insights", {
          method: "POST",
          body: "{}",
          headers: { Origin: "https://attacker.example" },
        })
      ).status,
      403,
    );
  } finally {
    await f.close();
  }
});
test("operators enqueue durable jobs instead of running dbt in the request process", async () => {
  const f = await apiFixture();
  try {
    const r = await f.request("/api/run", { method: "POST", body: "{}" });
    assert.equal(r.status, 202);
    const job = await r.json();
    assert.equal(f.state.job(job.id).status, "queued");
    assert.equal((await f.request("/api/jobs/" + job.id)).status, 200);
    assert.equal(
      f.state.db
        .prepare("SELECT count(*) n FROM audit WHERE action='queue_pipeline'")
        .get().n,
      1,
    );
  } finally {
    await f.close();
  }
});
test("API bounds JSON input and methods, hides errors, and supplies security headers", async () => {
  const f = await apiFixture("operator", {
    overview: async () => {
      throw new Error("password=do-not-expose SQL SECRET");
    },
  });
  try {
    const bad = await f.request("/api/overview");
    assert.equal(bad.status, 503);
    assert.ok(!(await bad.text()).includes("SECRET"));
    assert.ok(!JSON.stringify(f.logs).includes("SECRET"));
    assert.ok(bad.headers.get("strict-transport-security"));
    assert.match(
      bad.headers.get("content-security-policy"),
      /frame-ancestors 'none'/,
    );
    assert.equal((await f.request("/api/run")).status, 405);
    assert.equal(
      (
        await f.request("/api/insights", {
          method: "POST",
          body: "x".repeat(9000),
        })
      ).status,
      413,
    );
    assert.equal(
      (
        await f.request("/api/insights", {
          method: "POST",
          body: "{}",
          headers: { "Content-Type": "text/plain" },
        })
      ).status,
      415,
    );
    assert.equal(
      (
        await f.request("/api/overview", {
          headers: { Host: "attacker.example" },
        })
      ).status,
      403,
    );
  } finally {
    await f.close();
  }
});
test("initial setup is usable without falling back to demonstration data", async () => {
  const f = await apiFixture("operator", {
    overview: async () => {
      throw Object.assign(new Error("No release"), {
        code: "NO_PUBLISHED_RELEASE",
      });
    },
  });
  try {
    const r = await f.request("/api/overview"),
      body = await r.json();
    assert.equal(r.status, 200);
    assert.equal(body.setupRequired, true);
    assert.equal(body.mode, "snowflake");
    assert.equal(body.current, undefined);
  } finally {
    await f.close();
  }
});
test("production preview rejects SQL injection before issuing warehouse queries", async () => {
  const state = new StateStore(":memory:");
  try {
    const job = state.enqueue("op");
    state.claim("w");
    state.publish(job.id, "w", release());
    let queried = false;
    const p = new SnowflakeProvider(
      { schemaPrefix: "ANALYTICS_RELEASE", warehouse: { database: "TEST_DB" } },
      state,
      {
        query: async () => {
          queried = true;
          return [];
        },
      },
    );
    await assert.rejects(
      () => p.preview("orders; DROP TABLE customer"),
      /not found/,
    );
    assert.equal(queried, false);
  } finally {
    state.close();
  }
});
