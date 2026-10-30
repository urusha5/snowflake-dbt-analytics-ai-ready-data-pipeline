import http from "node:http";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sameToken } from "./auth.mjs";

export class HttpError extends Error {
  constructor(status, message, code = "REQUEST_REJECTED") {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export class RateLimiter {
  constructor(limit = 120, clock = () => Date.now()) {
    this.limit = limit;
    this.clock = clock;
    this.windows = new Map();
  }
  allow(key, limit = this.limit) {
    const now = this.clock();
    if (this.windows.size > 10000)
      for (const [k, v] of this.windows)
        if (v.until <= now) this.windows.delete(k);
    if (this.windows.size > 10000 && !this.windows.has(key)) return false;
    let w = this.windows.get(key);
    if (!w || w.until <= now) {
      w = { until: now + 60000, count: 0 };
      this.windows.set(key, w);
    }
    return ++w.count <= limit;
  }
}
async function requestBody(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers["content-type"] || ""))
    throw new HttpError(415, "Use application/json.");
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 8192) throw new HttpError(413, "Request body is too large.");
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error();
    return value;
  } catch {
    throw new HttpError(400, "Invalid JSON object.");
  }
}
const staticFiles = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/index.html": ["index.html", "text/html; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/styles.css": ["styles.css", "text/css; charset=utf-8"],
  "/favicon.svg": ["favicon.svg", "image/svg+xml"],
};
const methodMap = {
  "/api/overview": ["GET"],
  "/api/models": ["GET"],
  "/api/settings": ["GET"],
  "/api/session": ["GET"],
  "/api/run": ["POST"],
  "/api/insights": ["POST"],
  "/api/logout": ["POST"],
  "/api/health": ["GET"],
};
function settings(config) {
  return {
    mode: config.mode,
    host: config.host,
    port: config.port,
    node: process.versions.node,
    database:
      config.mode === "demo"
        ? ".local/pipeline.sqlite"
        : "Snowflake · validated release",
    snowflake: {
      status: config.mode === "demo" ? "not_connected" : "configured",
      message:
        config.mode === "demo"
          ? "The local demonstration uses synthetic data."
          : "Warehouse data is read from the last successfully validated, published release.",
      variables: [
        "SNOWFLAKE_ACCOUNT",
        "SNOWFLAKE_USER",
        "SNOWFLAKE_PRIVATE_KEY_PATH",
        "SNOWFLAKE_ROLE",
        "SNOWFLAKE_WAREHOUSE",
        "SNOWFLAKE_DATABASE",
      ].map((name) => ({ name, configured: config.mode === "snowflake" })),
    },
    ai: {
      provider: "Approved analytical SQL",
      llm: false,
      description: "No external language model receives your data.",
    },
    exportsEnabled: config.exportsEnabled,
  };
}

export function createApplication({
  config,
  provider,
  state,
  auth,
  logger = (entry) => process.stdout.write(JSON.stringify(entry) + "\n"),
}) {
  const limiter = new RateLimiter(config.rateLimit);
  const staticCache = new Map(
    Object.entries(staticFiles).map(([path, [file, type]]) => [
      path,
      { body: readFileSync(join(config.root, "app", file)), type },
    ]),
  );
  let readiness, inflightReady;
  const ready = async () => {
    if (readiness && Date.now() - readiness.at < 30000) return readiness.value;
    if (!inflightReady)
      inflightReady = Promise.resolve(provider.ready())
        .then((value) => {
          readiness = { at: Date.now(), value };
          return value;
        })
        .finally(() => (inflightReady = null));
    return inflightReady;
  };
  const server = http.createServer(
    { maxHeaderSize: 16384 },
    async (req, res) => {
      const started = performance.now(),
        requestId = randomUUID();
      let actor = "anonymous",
        path = "invalid";
      const send = (status, value) => {
        if (res.writableEnded) return;
        const json = JSON.stringify(value);
        if (Buffer.byteLength(json) > (config.maxResponseBytes || 4194304))
          throw new HttpError(
            413,
            "Result exceeds the response limit. Ask an operator to reduce the export row limit.",
            "RESPONSE_TOO_LARGE",
          );
        res.writeHead(status, {
          "Content-Type": "application/json; charset=utf-8",
        });
        res.end(json);
      };
      res.setHeader("X-Request-Id", requestId);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Referrer-Policy", "no-referrer");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader(
        "Permissions-Policy",
        "camera=(), microphone=(), geolocation=()",
      );
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      );
      if (config.production)
        res.setHeader("Strict-Transport-Security", "max-age=31536000");
      res.on("finish", () =>
        logger({
          at: new Date().toISOString(),
          event: "http_request",
          requestId,
          method: req.method,
          path,
          status: res.statusCode,
          durationMs: Math.round(performance.now() - started),
          actor,
        }),
      );
      try {
        if (!req.url.startsWith("/") || req.url.startsWith("//"))
          throw new HttpError(400, "Invalid request target.");
        const url = new URL(req.url, config.origin);
        path = url.pathname;
        if (path === "/healthz") {
          if (req.method !== "GET")
            throw new HttpError(405, "Method not allowed.");
          return send(200, { status: "ok" });
        }
        if (path === "/readyz") {
          if (req.method !== "GET")
            throw new HttpError(405, "Method not allowed.");
          return send((await ready()) ? 200 : 503, {
            status: (await ready()) ? "ready" : "unavailable",
          });
        }
        const validHosts = new Set([
          config.authority,
          ...(config.mode === "demo" ? [`localhost:${config.port}`] : []),
        ]);
        if (!validHosts.has(req.headers.host))
          throw new HttpError(403, "Unrecognized host.");
        if (path === "/signed-out" && req.method === "GET") {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          return res.end(
            '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Signed out · Snowstack</title><link rel="stylesheet" href="/styles.css"><main><h1>You are signed out.</h1><p>Your company SSO session may still be active.</p><a class="button primary" href="/auth/login">Sign in to the workspace</a></main></html>',
          );
        }
        if (path === "/styles.css" && req.method === "GET") {
          const asset = staticCache.get(path);
          res.writeHead(200, { "Content-Type": asset.type });
          return res.end(asset.body);
        }
        if (path === "/auth/login" && req.method === "GET" && auth) {
          if (!limiter.allow(`login:${req.socket.remoteAddress}`, 20))
            throw new HttpError(429, "Too many sign-in attempts.");
          const login = await auth.login();
          res.writeHead(302, {
            "Set-Cookie": login.cookie,
            Location: login.url,
          });
          return res.end();
        }
        if (path === "/auth/callback" && req.method === "GET" && auth) {
          if (!limiter.allow(`callback:${req.socket.remoteAddress}`, 20))
            throw new HttpError(429, "Too many sign-in attempts.");
          try {
            const result = await auth.callback(url, req.headers.cookie);
            res.writeHead(303, { "Set-Cookie": result.cookies, Location: "/" });
            return res.end();
          } catch {
            throw new HttpError(
              401,
              "Sign-in failed. Start a new sign-in.",
              "AUTHENTICATION_FAILED",
            );
          }
        }
        const session =
          config.mode === "demo"
            ? {
                actor: "local_developer",
                name: "Local developer",
                role: "operator",
                csrf: null,
              }
            : auth.session(req);
        if (!session) {
          if (path === "/" || path === "/index.html") {
            res.writeHead(302, { Location: "/auth/login" });
            return res.end();
          }
          throw new HttpError(
            401,
            "Sign in to continue.",
            "AUTHENTICATION_REQUIRED",
          );
        }
        actor = session.actor;
        if (!limiter.allow(`user:${actor}`))
          throw new HttpError(429, "Too many requests. Try again shortly.");
        if (methodMap[path] && !methodMap[path].includes(req.method)) {
          res.setHeader("Allow", methodMap[path].join(", "));
          throw new HttpError(405, "Method not allowed.");
        }
        if (req.method === "POST") {
          if (
            req.headers.origin !== config.origin &&
            !(
              config.mode === "demo" &&
              (!req.headers.origin ||
                req.headers.origin === `http://localhost:${config.port}`)
            )
          )
            throw new HttpError(403, "Unrecognized request origin.");
          if (
            config.mode !== "demo" &&
            !sameToken(req.headers["x-csrf-token"], session.csrf)
          )
            throw new HttpError(403, "Invalid request token.");
        }
        if (path === "/api/session")
          return send(200, {
            name: session.name,
            role: session.role,
            csrf: session.csrf,
            mode: config.mode,
            exportsEnabled: config.exportsEnabled,
            canRun: session.role === "operator",
          });
        if (path === "/api/health")
          return send(200, {
            status: "ok",
            mode: config.mode,
            engine: config.mode === "demo" ? "SQLite" : "Snowflake",
          });
        if (path === "/api/settings") return send(200, settings(config));
        const n = Number(url.searchParams.get("days") || 30);
        if (
          ["/api/overview", "/api/insights"].includes(path) &&
          ![7, 30, 90].includes(n)
        )
          throw new HttpError(
            400,
            "Reporting period must be 7, 30, or 90 days.",
          );
        if (path === "/api/overview") {
          try {
            return send(200, {
              ...(await provider.overview(n)),
              canRun: session.role === "operator",
              exportsEnabled: config.exportsEnabled,
            });
          } catch (error) {
            if (error.code === "NO_PUBLISHED_RELEASE")
              return send(200, {
                setupRequired: true,
                project: "Snowflake + dbt Analytics and AI-Ready Data Pipeline",
                mode: config.mode,
                canRun: session.role === "operator",
                exportsEnabled: config.exportsEnabled,
                workerAvailable: state.workerAlive(),
              });
            throw error;
          }
        }
        if (path === "/api/models") {
          const name = url.searchParams.get("name");
          if (!name) throw new HttpError(400, "Choose a model.");
          const download = url.searchParams.get("download") === "1";
          if (
            download &&
            (!config.exportsEnabled || session.role !== "operator")
          )
            throw new HttpError(
              403,
              "Exports require an operator role and enabled exports.",
            );
          if (download && !limiter.allow(`export:${actor}`, 10))
            throw new HttpError(429, "Too many exports.");
          const result = await provider.preview(name, download);
          if (download)
            state.audit(actor, "export_model", name, "success", requestId);
          return send(200, result);
        }
        if (path === "/api/run") {
          if (session.role !== "operator")
            throw new HttpError(403, "An operator role is required.");
          await requestBody(req);
          if (!limiter.allow(`run:${actor}`, 5))
            throw new HttpError(429, "Too many build requests.");
          if (config.mode === "demo") {
            const id = await provider.run();
            state.audit(actor, "demo_run", id, "success", requestId);
            return send(200, { id, status: "success" });
          }
          if (!state.workerAlive())
            throw new HttpError(
              503,
              "The pipeline worker is unavailable.",
              "WORKER_UNAVAILABLE",
            );
          const job = state.enqueue(actor);
          state.audit(actor, "queue_pipeline", job.id, "queued", requestId);
          return send(202, job);
        }
        if (/^\/api\/jobs\/[a-f0-9-]{36}$/.test(path) && req.method === "GET") {
          const job = state.job(path.split("/").at(-1));
          if (!job) throw new HttpError(404, "Run not found.");
          return send(200, {
            id: job.id,
            status: job.status,
            error_code: job.error_code,
            created_at: job.created_at,
            started_at: job.started_at,
            finished_at: job.finished_at,
          });
        }
        if (path === "/api/insights") {
          if (!limiter.allow(`insight:${actor}`, 20))
            throw new HttpError(429, "Too many analytical requests.");
          const input = await requestBody(req);
          if (
            typeof input.question !== "string" ||
            !input.question.trim() ||
            input.question.length > 500 ||
            (input.days !== undefined && ![7, 30, 90].includes(input.days))
          )
            throw new HttpError(
              400,
              "Enter a question up to 500 characters and a supported reporting period.",
            );
          return send(
            200,
            await provider.insight(input.question, input.days || 30),
          );
        }
        if (path === "/api/logout") {
          if (auth) res.setHeader("Set-Cookie", auth.logout(req));
          state.audit(actor, "logout", "session", "success", requestId);
          return send(200, { status: "signed_out" });
        }
        if (path.startsWith("/api/"))
          throw new HttpError(404, "Endpoint not found.");
        if (!["GET", "HEAD"].includes(req.method))
          throw new HttpError(405, "Method not allowed.");
        const asset = staticCache.get(path);
        if (!asset) throw new HttpError(404, "Not found.");
        res.writeHead(200, { "Content-Type": asset.type });
        res.end(req.method === "HEAD" ? undefined : asset.body);
      } catch (error) {
        const status =
          Number.isInteger(error.status) &&
          error.status >= 400 &&
          error.status < 600
            ? error.status
            : 503;
        const code = /^[A-Z_]{2,60}$/.test(error.code || "")
          ? error.code
          : "SERVICE_UNAVAILABLE";
        if (status === 429) res.setHeader("Retry-After", "60");
        if (status >= 500)
          logger({
            at: new Date().toISOString(),
            event: "request_failed",
            requestId,
            code,
          });
        if (!res.headersSent)
          send(status, {
            error:
              status < 500
                ? error.message
                : "The service is temporarily unavailable.",
            code,
            requestId,
          });
        else res.destroy();
      }
    },
  );
  server.headersTimeout = 15000;
  server.requestTimeout = 30000;
  server.keepAliveTimeout = 5000;
  server.maxRequestsPerSocket = 1000;
  return server;
}
