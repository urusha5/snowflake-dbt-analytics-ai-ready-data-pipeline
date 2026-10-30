import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { identifier, quoted, secret } from "./config.mjs";
import { MODEL_NAMES, publicColumns } from "./warehouse.mjs";

export function artifactRelease(
  manifest,
  results,
  sourceResults,
  schema,
  asOf,
) {
  const nodes = Object.values(manifest.nodes).filter(
    (n) => n.package_name === "snowflake_dbt_ai_pipeline",
  );
  const byId = new Map(results.results.map((r) => [r.unique_id, r]));
  const modelNodes = nodes.filter((n) => n.resource_type === "model");
  const tests = nodes.filter((n) => n.resource_type === "test");
  if (
    modelNodes.length !== MODEL_NAMES.length ||
    new Set(modelNodes.map((n) => n.name)).size !== MODEL_NAMES.length ||
    modelNodes.some((n) => !MODEL_NAMES.includes(n.name))
  )
    throw new Error("The release catalog does not match the approved models.");
  if (
    !tests.length ||
    tests.some((n) => byId.get(n.unique_id)?.status !== "pass")
  )
    throw new Error("All configured dbt tests must run and pass.");
  if (modelNodes.some((n) => byId.get(n.unique_id)?.status !== "success"))
    throw new Error("All dbt models must build successfully.");
  if (
    sourceResults.results?.length !== 3 ||
    new Set(sourceResults.results.map((r) => r.unique_id)).size !== 3 ||
    sourceResults.results.some((r) => r.status !== "pass")
  )
    throw new Error("Every source must pass freshness before publication.");
  return {
    schema: identifier(schema),
    asOf,
    checks: tests.map((n) => ({
      name: n.name,
      model:
        manifest.nodes[
          n.depends_on.nodes.find(
            (id) => manifest.nodes[id]?.resource_type === "model",
          )
        ]?.name || "source",
      status: "pass",
      failures: 0,
    })),
    models: modelNodes.map((n) => ({
      name: n.name,
      sql: n.raw_code || n.raw_sql || '',
      dependencies: (n.depends_on?.nodes || []).filter(id=>manifest.nodes[id]?.resource_type==='model').map(id=>manifest.nodes[id].name),
      sources: (n.depends_on?.nodes || []).filter(id=>manifest.sources?.[id]).map(id=>`${manifest.sources[id].source_name}.${manifest.sources[id].name}`),
      materialization: n.config?.materialized,
      path: n.original_file_path,
      rows: 0,
      columns: [],
      redacted: 0,
    })),
    freshness: sourceResults.results.map((r) => ({
      source: r.unique_id.split(".").at(-1),
      status: r.status,
      maxLoadedAt: r.max_loaded_at,
    })),
    run: {
      tests: tests.length,
      duration_ms: Math.round((results.elapsed_time || 0) * 1000),
      models: modelNodes.map((n) => ({
        name: n.name,
        status: "success",
        duration_ms: Math.round(
          (byId.get(n.unique_id).execution_time || 0) * 1000,
        ),
        rows: 0,
      })),
    },
    dbtVersion: manifest.metadata.dbt_version,
  };
}

export function runDbt(executable, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    let settled = false,
      abortForce;
    if (options.signal?.aborted) {
      reject(
        Object.assign(new Error("Job cancelled."), { code: "JOB_CANCELLED" }),
      );
      return;
    }
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    // dbt output may contain compiled pseudonymization salts and source values.
    // Drain it without forwarding to public logs or storing it in the jobs API.
    child.stdout.on("data", () => {});
    child.stderr.on("data", () => {});
    const stop = () => {
      child.kill("SIGTERM");
      abortForce ||= setTimeout(() => child.kill("SIGKILL"), 5000);
    };
    options.signal?.addEventListener("abort", stop, { once: true });
    const timeout = setTimeout(stop, options.timeoutMs || 2700000);
    const force = setTimeout(
      () => child.kill("SIGKILL"),
      (options.timeoutMs || 2700000) + 5000,
    );
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(force);
      clearTimeout(abortForce);
      options.signal?.removeEventListener("abort", stop);
      error ? reject(error) : resolvePromise();
    };
    child.on("error", () =>
      finish(
        Object.assign(new Error("Unable to start dbt."), {
          code: "DBT_START_FAILED",
        }),
      ),
    );
    child.on("exit", (code, signal) =>
      finish(
        code === 0 && !signal && !options.signal?.aborted
          ? null
          : Object.assign(new Error("dbt did not complete successfully."), {
              code: "DBT_EXECUTION_FAILED",
            }),
      ),
    );
  });
}

export async function executeRelease(
  config,
  state,
  warehouse,
  job,
  owner,
  signal,
  execute = runDbt,
) {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, "")
    .slice(0, 14);
  const suffix = `${stamp}_${job.id.replaceAll("-", "").slice(0, 8)}`;
  const schema = identifier(`${config.schemaPrefix}_${suffix}`),
    sourceSchema = identifier(`SOURCE_RELEASE_${suffix}`);
  const database = quoted(config.warehouse.database),
    asOf = new Date().toISOString().slice(0, 10);
  const dir = resolve(
    config.artifactDir || join(config.stateDir, "artifacts"),
    job.id,
  );
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const salt = secret(process.env, "CUSTOMER_KEY_SALT", true);
  if (salt.length < 32)
    throw Object.assign(
      new Error(
        "Use a stable customer pseudonymization salt of at least 32 characters.",
      ),
      { code: "INVALID_KEY_SALT" },
    );
  const env = {
    ...process.env,
    NODE_ENV: "production",
    DBT_SEND_ANONYMOUS_USAGE_STATS: "false",
    DBT_LOG_PATH: join(dir, "private-logs"),
    DBT_TARGET_PATH: dir,
    SNOWFLAKE_SCHEMA: schema,
    SNOWFLAKE_SOURCE_SCHEMA: sourceSchema,
    CUSTOMER_KEY_SALT: salt,
    SNOWSTACK_QUERY_TAG: `snowstack:job:${job.id}`,
    DBT_ENV_SECRET_SNOWFLAKE_PRIVATE_KEY_PASSPHRASE:
      config.warehouse.privateKeyPass || "",
  };
  const query = (sql, binds = []) =>
    warehouse.query(sql, binds, `snowstack:release:${job.id}`);
  const checkLease = () => {
    if (signal?.aborted || !state.heartbeat(owner, job.id))
      throw Object.assign(new Error("Job lease expired."), {
        code: "LEASE_EXPIRED",
      });
  };
  checkLease();
  state.plan(job.id, owner, schema, sourceSchema, asOf);
  // All views in this release ultimately read a frozen source clone. Otherwise
  // live bronze tables could change after tests and invalidate publication.
  await query(
    `CREATE SCHEMA ${database}.${quoted(sourceSchema)} CLONE ${database}.${quoted(config.warehouse.sourceSchema)}`,
  );
  const vars = JSON.stringify({
    feature_as_of_date: asOf,
    source_loaded_at_field: "loaded_at",
    customer_created_at_field: "created_at",
    product_available_from_field: "available_from",
  });
  const common = [
    "--profiles-dir",
    join(config.root, "config"),
    "--target",
    "prod",
    "--vars",
    vars,
    "--no-use-colors",
  ];
  await execute(config.dbtExecutable, ["source", "freshness", ...common], {
    cwd: config.root,
    env,
    signal,
    timeoutMs: config.jobTimeoutMs,
  });
  const sourceResults = JSON.parse(
    readFileSync(join(dir, "sources.json"), "utf8"),
  );
  checkLease();
  // Each release is a full, isolated build. No failed partial build is served.
  await execute(
    config.dbtExecutable,
    [
      "build",
      "--full-refresh",
      "--exclude",
      "resource_type:snapshot",
      ...common,
    ],
    { cwd: config.root, env, signal, timeoutMs: config.jobTimeoutMs },
  );
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  const results = JSON.parse(
    readFileSync(join(dir, "run_results.json"), "utf8"),
  );
  const release = artifactRelease(
    manifest,
    results,
    sourceResults,
    schema,
    asOf,
  );
  const columnRows = await query(
    `SELECT TABLE_NAME,COLUMN_NAME,DATA_TYPE FROM ${database}.INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=?`,
    [schema],
  );
  for (const model of release.models) {
    checkLease();
    const original = columnRows
      .filter((c) => c.table_name.toLowerCase() === model.name)
      .map((c) => ({ name: c.column_name.toLowerCase(), type: c.data_type }));
    const columns = publicColumns(model.name, original);
    if (!columns.length)
      throw new Error("An approved model has no public columns.");
    await query(
      `CREATE VIEW ${database}.${quoted(schema)}.${quoted(`APP_${model.name}`)} AS SELECT ${columns.map((c) => quoted(c.name)).join(",")} FROM ${database}.${quoted(schema)}.${quoted(model.name)}`,
    );
    const rows = await query(
      `SELECT COUNT(*) count FROM ${database}.${quoted(schema)}.${quoted(model.name)}`,
    );
    model.rows = Number(rows[0].count);
    model.columns = columns;
    model.redacted = original.length - columns.length;
    if (!Number.isSafeInteger(model.rows))
      throw new Error("Model row counts exceed supported bounds.");
    release.run.models.find((m) => m.name === model.name).rows = model.rows;
  }
  release.sourceCounts = {};
  for (const name of ["raw_customer", "raw_product", "raw_orders"]) {
    const row = await query(
      `SELECT COUNT(*) count FROM ${database}.${quoted(sourceSchema)}.${quoted(name)}`,
    );
    release.sourceCounts[name] = Number(row[0].count);
    if (
      !Number.isSafeInteger(release.sourceCounts[name]) ||
      release.sourceCounts[name] === 0
    )
      throw new Error("Empty or oversized source cannot be published.");
  }
  release.sourceSchema = sourceSchema;
  // Grant only safe views, never raw tables or all objects in the schema.
  await query(
    `GRANT USAGE ON SCHEMA ${database}.${quoted(schema)} TO ROLE ${quoted(config.warehouse.readerRole)}`,
  );
  for (const name of MODEL_NAMES)
    await query(
      `GRANT SELECT ON VIEW ${database}.${quoted(schema)}.${quoted(`APP_${name}`)} TO ROLE ${quoted(config.warehouse.readerRole)}`,
    );
  checkLease();
  writeFileSync(
    join(dir, "release-summary.json"),
    JSON.stringify(
      {
        ...release,
        models: release.models.map((m) => ({ name: m.name, rows: m.rows })),
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  state.publish(job.id, owner, release);
  return release;
}
