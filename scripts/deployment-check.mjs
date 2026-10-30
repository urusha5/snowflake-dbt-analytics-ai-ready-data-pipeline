import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "../server/config.mjs";
function envFile(name) {
  const text = readFileSync(resolve("deploy", name), "utf8");
  return Object.fromEntries(
    text
      .split(/\r?\n/)
      .filter((l) => l.trim() && !l.trim().startsWith("#"))
      .map((l) => {
        const i = l.indexOf("=");
        if (i < 1) throw new Error("Invalid deployment env file.");
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      }),
  );
}
for (const name of ["SNOWSTACK_IMAGE", "CADDY_IMAGE"])
  if (!/^.+@sha256:[a-f0-9]{64}$/.test(process.env[name] || ""))
    throw new Error(`${name} must identify an immutable image digest.`);
const web = envFile("web.env"),
  worker = envFile("worker.env"),
  proxy = envFile("proxy.env");
if (new URL(web.PUBLIC_ORIGIN).host !== proxy.PUBLIC_HOST)
  throw new Error("PUBLIC_ORIGIN and proxy PUBLIC_HOST must match.");
if (
  worker.PUBLIC_ORIGIN !== web.PUBLIC_ORIGIN ||
  worker.SNOWFLAKE_DATABASE !== web.SNOWFLAKE_DATABASE ||
  worker.SNOWFLAKE_READER_ROLE !== web.SNOWFLAKE_READER_ROLE ||
  worker.SNOWFLAKE_SCHEMA_PREFIX !== web.SNOWFLAKE_SCHEMA_PREFIX
)
  throw new Error(
    "Web and worker must agree on the origin, database, reader role, and release prefix.",
  );
for (const [file, component] of [
  [web, "web"],
  [worker, "worker"],
])
  loadConfig(
    {
      ...file,
      NODE_ENV: "production",
      APP_MODE: "snowflake",
      HOST: "0.0.0.0",
      STATE_DIR: resolve(".local", "preflight"),
      SNOWFLAKE_PRIVATE_KEY_PATH: resolve(
        "deploy/secrets",
        component === "web" ? "reader.p8" : "worker.p8",
      ),
      OIDC_CLIENT_SECRET:
        component === "web" ? "validated-presence-below" : undefined,
    },
    process.cwd(),
    component,
  );
for (const name of [
  "reader.p8",
  "reader-passphrase",
  "worker.p8",
  "worker-passphrase",
  "oidc-client-secret",
  "customer-key-salt",
]) {
  const path = resolve("deploy/secrets", name);
  if (!existsSync(path) || !readFileSync(path, "utf8").trim())
    throw new Error(`Missing secret: ${name}`);
}
if (
  readFileSync(resolve("deploy/secrets/customer-key-salt"), "utf8").trim()
    .length < 32
)
  throw new Error("Customer key salt needs at least 32 characters.");
console.log(
  "Static deployment configuration passed. This does not verify Snowflake grants, SSO connectivity, DNS, TLS, backups, or image execution.",
);
