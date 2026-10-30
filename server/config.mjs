import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

export function secret(env, name, required = false) {
  if (env[name] && env[`${name}_FILE`])
    throw new Error(`Set ${name} or ${name}_FILE, not both.`);
  const value = env[`${name}_FILE`]
    ? readFileSync(env[`${name}_FILE`], "utf8").trim()
    : env[name]?.trim();
  if (required && !value) throw new Error(`${name} is required.`);
  return value || "";
}
export function identifier(value, name = "identifier") {
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,100}$/.test(value || ""))
    throw new Error(`Invalid ${name}.`);
  return value.toUpperCase();
}
export const quoted = (value) => `"${identifier(value)}"`;
function integer(value, fallback, min, max, name) {
  const n = value === undefined || value === "" ? fallback : Number(value);
  if (!Number.isInteger(n) || n < min || n > max)
    throw new Error(`Invalid ${name}.`);
  return n;
}
export function loadConfig(
  env = process.env,
  root = process.cwd(),
  component = "web",
) {
  const production = env.NODE_ENV === "production";
  const mode = env.APP_MODE || (production ? "" : "demo");
  if (!["demo", "snowflake"].includes(mode))
    throw new Error("APP_MODE must explicitly be snowflake in production.");
  if (production && mode !== "snowflake")
    throw new Error("Demo data is prohibited in production.");
  const port = integer(env.PORT, 3000, 1, 65535, "PORT");
  const origin = new URL(env.PUBLIC_ORIGIN || `http://127.0.0.1:${port}`);
  if (
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  )
    throw new Error(
      "PUBLIC_ORIGIN must be an origin without a path or credentials.",
    );
  if ((production || mode === "snowflake") && origin.protocol !== "https:")
    throw new Error(
      "Snowflake and production modes require an HTTPS PUBLIC_ORIGIN.",
    );
  if (!["http:", "https:"].includes(origin.protocol))
    throw new Error("Invalid PUBLIC_ORIGIN protocol.");
  const host = env.HOST || "127.0.0.1";
  if (mode === "demo" && !["127.0.0.1", "::1", "localhost"].includes(host))
    throw new Error("Demo mode must bind to loopback.");
  if (production && (!env.STATE_DIR || !isAbsolute(env.STATE_DIR)))
    throw new Error(
      "Production requires an absolute STATE_DIR on a persistent local disk.",
    );
  const config = {
    production,
    mode,
    port,
    host,
    origin: origin.origin,
    authority: origin.host,
    stateDir: resolve(env.STATE_DIR || resolve(root, ".local")),
    artifactDir: resolve(
      env.ARTIFACT_DIR ||
        resolve(env.STATE_DIR || resolve(root, ".local"), "artifacts"),
    ),
    exportsEnabled: mode === "demo" || env.ALLOW_EXPORTS === "true",
    maxExportRows: integer(
      env.MAX_EXPORT_ROWS,
      5000,
      1,
      10000,
      "MAX_EXPORT_ROWS",
    ),
    maxResponseBytes: integer(
      env.MAX_RESPONSE_BYTES,
      4194304,
      65536,
      16777216,
      "MAX_RESPONSE_BYTES",
    ),
    queryTimeoutMs: integer(
      env.QUERY_TIMEOUT_MS,
      20000,
      1000,
      120000,
      "QUERY_TIMEOUT_MS",
    ),
    maxReleaseAgeHours: integer(
      env.MAX_RELEASE_AGE_HOURS,
      48,
      1,
      168,
      "MAX_RELEASE_AGE_HOURS",
    ),
    sessionTtl: integer(
      env.SESSION_TTL_SECONDS,
      3600,
      300,
      28800,
      "SESSION_TTL_SECONDS",
    ),
    rateLimit: integer(
      env.RATE_LIMIT_PER_MINUTE,
      120,
      10,
      1000,
      "RATE_LIMIT_PER_MINUTE",
    ),
    dbtExecutable: env.DBT_EXECUTABLE || "dbt",
    jobTimeoutMs:
      integer(env.JOB_TIMEOUT_MINUTES, 45, 1, 180, "JOB_TIMEOUT_MINUTES") *
      60000,
    scheduleMinutes: integer(
      env.PIPELINE_INTERVAL_MINUTES,
      0,
      0,
      10080,
      "PIPELINE_INTERVAL_MINUTES",
    ),
    schemaPrefix: identifier(
      env.SNOWFLAKE_SCHEMA_PREFIX || "ANALYTICS_RELEASE",
    ),
    root,
  };
  if (mode === "snowflake") {
    const required = (name) => {
      if (!env[name]?.trim()) throw new Error(`${name} is required.`);
      return env[name].trim();
    };
    config.warehouse = {
      account: required("SNOWFLAKE_ACCOUNT"),
      username: required("SNOWFLAKE_USER"),
      privateKeyPath: required("SNOWFLAKE_PRIVATE_KEY_PATH"),
      privateKeyPass: secret(env, "SNOWFLAKE_PRIVATE_KEY_PASSPHRASE"),
      database: identifier(
        required("SNOWFLAKE_DATABASE"),
        "SNOWFLAKE_DATABASE",
      ),
      role: identifier(required("SNOWFLAKE_ROLE"), "SNOWFLAKE_ROLE"),
      warehouse: identifier(
        required("SNOWFLAKE_WAREHOUSE"),
        "SNOWFLAKE_WAREHOUSE",
      ),
      sourceSchema: identifier(env.SNOWFLAKE_SOURCE_SCHEMA || "BRONZE"),
      readerRole: identifier(
        required("SNOWFLAKE_READER_ROLE"),
        "SNOWFLAKE_READER_ROLE",
      ),
    };
    if (
      production &&
      component === "web" &&
      config.warehouse.role !== config.warehouse.readerRole
    )
      throw new Error(
        "The web process must use SNOWFLAKE_READER_ROLE. Use a separate transformer identity for the worker.",
      );
    if (
      production &&
      component === "worker" &&
      config.warehouse.role === config.warehouse.readerRole
    )
      throw new Error("The worker must use a separate transformer role.");
    if (!isAbsolute(config.warehouse.privateKeyPath))
      throw new Error("SNOWFLAKE_PRIVATE_KEY_PATH must be absolute.");
    if (
      [
        "ACCOUNTADMIN",
        "SECURITYADMIN",
        "SYSADMIN",
        "ORGADMIN",
        "USERADMIN",
        "PUBLIC",
      ].some((role) =>
        [config.warehouse.role, config.warehouse.readerRole].includes(role),
      )
    )
      throw new Error(
        "Use dedicated application roles; built-in administrative and PUBLIC roles are prohibited.",
      );
    if (config.schemaPrefix.length > 64)
      throw new Error(
        "SNOWFLAKE_SCHEMA_PREFIX is too long for generated release names.",
      );
    if (component === "web") {
      const issuer = new URL(required("OIDC_ISSUER"));
      if (
        issuer.protocol !== "https:" ||
        issuer.username ||
        issuer.password ||
        issuer.hash ||
        issuer.search
      )
        throw new Error("OIDC_ISSUER must be an HTTPS issuer URL.");
      config.oidc = {
        issuer: issuer.href,
        clientId: required("OIDC_CLIENT_ID"),
        clientSecret: secret(env, "OIDC_CLIENT_SECRET", true),
        viewerGroup: required("OIDC_VIEWER_GROUP"),
        operatorGroup: required("OIDC_OPERATOR_GROUP"),
        groupsClaim: env.OIDC_GROUPS_CLAIM || "groups",
      };
      if (config.oidc.viewerGroup === config.oidc.operatorGroup)
        throw new Error("Viewer and operator groups must differ.");
    }
  }
  return config;
}
