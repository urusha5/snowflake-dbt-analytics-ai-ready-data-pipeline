import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, chmodSync } from "node:fs";
import { dirname } from "node:path";

export const hash = (s) => createHash("sha256").update(s).digest("hex");
const token = () => randomBytes(32).toString("base64url");
export class StateStore {
  constructor(path, clock = () => Date.now()) {
    this.clock = clock;
    if (path !== ":memory:")
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA busy_timeout=5000");
    if (this.db.prepare("PRAGMA user_version").get().user_version > 1) {
      this.db.close();
      throw new Error(
        "The operational database requires a newer application version.",
      );
    }
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,actor TEXT NOT NULL,name TEXT NOT NULL,role TEXT NOT NULL,csrf TEXT NOT NULL,expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS login_transactions(id TEXT PRIMARY KEY,payload TEXT NOT NULL,expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,status TEXT NOT NULL,actor TEXT NOT NULL,created_at TEXT NOT NULL,started_at TEXT,finished_at TEXT,lease_until INTEGER,owner TEXT,release_schema TEXT,error_code TEXT,details TEXT NOT NULL DEFAULT '{}');
      CREATE UNIQUE INDEX IF NOT EXISTS one_active_job ON jobs((1)) WHERE status IN ('queued','running');
      CREATE TABLE IF NOT EXISTS releases(id TEXT PRIMARY KEY,published_at TEXT NOT NULL,schema_name TEXT NOT NULL UNIQUE,payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS active_release(id INTEGER PRIMARY KEY CHECK(id=1),release_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,at TEXT NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,resource TEXT NOT NULL,outcome TEXT NOT NULL,request_id TEXT);
      CREATE TABLE IF NOT EXISTS worker_heartbeat(id INTEGER PRIMARY KEY CHECK(id=1),at INTEGER NOT NULL);
      PRAGMA user_version=1;`);
    if (path !== ":memory:" && process.platform !== "win32")
      chmodSync(path, 0o600);
  }
  transaction(fn) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  createSession(user, ttlSeconds) {
    const id = token(),
      csrf = token();
    this.db
      .prepare("INSERT INTO sessions VALUES(?,?,?,?,?,?)")
      .run(
        hash(id),
        user.actor,
        user.name,
        user.role,
        csrf,
        this.clock() + ttlSeconds * 1000,
      );
    return { id, csrf, ...user };
  }
  session(id) {
    if (!id || !/^[A-Za-z0-9_-]{43}$/.test(id)) return null;
    return (
      this.db
        .prepare(
          "SELECT actor,name,role,csrf,expires FROM sessions WHERE id=? AND expires>?",
        )
        .get(hash(id), this.clock()) || null
    );
  }
  revokeSession(id) {
    if (id) this.db.prepare("DELETE FROM sessions WHERE id=?").run(hash(id));
  }
  saveLogin(payload) {
    const id = token();
    this.db
      .prepare("INSERT INTO login_transactions VALUES(?,?,?)")
      .run(hash(id), JSON.stringify(payload), this.clock() + 600000);
    return id;
  }
  takeLogin(id) {
    if (!id || !/^[A-Za-z0-9_-]{43}$/.test(id)) return null;
    return this.transaction(() => {
      const row = this.db
        .prepare("SELECT * FROM login_transactions WHERE id=?")
        .get(hash(id));
      this.db
        .prepare("DELETE FROM login_transactions WHERE id=?")
        .run(hash(id));
      return row && row.expires > this.clock() ? JSON.parse(row.payload) : null;
    });
  }
  audit(actor, action, resource, outcome, requestId = "") {
    this.db
      .prepare(
        "INSERT INTO audit(at,actor,action,resource,outcome,request_id) VALUES(?,?,?,?,?,?)",
      )
      .run(
        new Date(this.clock()).toISOString(),
        actor,
        action,
        resource,
        outcome,
        requestId,
      );
  }
  enqueue(actor) {
    return this.transaction(() => {
      this.reapExpired();
      const active = this.db
        .prepare(
          "SELECT id,status FROM jobs WHERE status IN ('queued','running') LIMIT 1",
        )
        .get();
      if (active) return { ...active, deduplicated: true };
      const id = randomUUID();
      this.db
        .prepare(
          "INSERT INTO jobs(id,status,actor,created_at) VALUES(?,'queued',?,?)",
        )
        .run(id, actor, new Date(this.clock()).toISOString());
      return { id, status: "queued", deduplicated: false };
    });
  }
  reapExpired() {
    this.db
      .prepare(
        "UPDATE jobs SET status='failed',finished_at=?,error_code='WORKER_LEASE_EXPIRED',owner=NULL,lease_until=NULL WHERE status='running' AND lease_until<?",
      )
      .run(new Date(this.clock()).toISOString(), this.clock());
  }
  claim(owner) {
    return this.transaction(() => {
      this.reapExpired();
      const row = this.db
        .prepare(
          "SELECT * FROM jobs WHERE status='queued' ORDER BY created_at LIMIT 1",
        )
        .get();
      if (!row) return null;
      this.db
        .prepare(
          "UPDATE jobs SET status='running',owner=?,lease_until=?,started_at=? WHERE id=?",
        )
        .run(
          owner,
          this.clock() + 120000,
          new Date(this.clock()).toISOString(),
          row.id,
        );
      return this.job(row.id);
    });
  }
  heartbeat(owner, id) {
    const r = this.db
      .prepare(
        "UPDATE jobs SET lease_until=? WHERE id=? AND owner=? AND status='running' AND lease_until>=?",
      )
      .run(this.clock() + 120000, id, owner, this.clock());
    return r.changes === 1;
  }
  plan(id, owner, schema, sourceSchema, asOf) {
    const r = this.db
      .prepare(
        "UPDATE jobs SET release_schema=?,details=? WHERE id=? AND owner=? AND status='running' AND lease_until>=?",
      )
      .run(
        schema,
        JSON.stringify({ sourceSchema, asOf }),
        id,
        owner,
        this.clock(),
      );
    if (r.changes !== 1) throw new Error("Job lease is no longer valid.");
  }
  workerHeartbeat() {
    this.db
      .prepare("INSERT OR REPLACE INTO worker_heartbeat VALUES(1,?)")
      .run(this.clock());
  }
  workerAlive() {
    const r = this.db
      .prepare("SELECT at FROM worker_heartbeat WHERE id=1")
      .get();
    return Boolean(r && this.clock() - r.at < 45000);
  }
  job(id) {
    const r = this.db.prepare("SELECT * FROM jobs WHERE id=?").get(id);
    return r ? { ...r, details: JSON.parse(r.details) } : null;
  }
  jobs() {
    return this.db
      .prepare("SELECT * FROM jobs ORDER BY created_at DESC LIMIT 30")
      .all()
      .map((r) => ({ ...r, details: JSON.parse(r.details) }));
  }
  failJob(id, owner, code) {
    this.db
      .prepare(
        "UPDATE jobs SET status='failed',finished_at=?,error_code=?,owner=NULL,lease_until=NULL WHERE id=? AND owner=? AND status='running'",
      )
      .run(new Date(this.clock()).toISOString(), code, id, owner);
  }
  publish(id, owner, release) {
    return this.transaction(() => {
      const job = this.job(id);
      if (
        !job ||
        job.status !== "running" ||
        job.owner !== owner ||
        job.lease_until < this.clock()
      )
        throw new Error("The publishing lease is no longer valid.");
      if (
        !release.checks?.length ||
        release.checks.some((c) => c.status !== "pass") ||
        release.models.length !== 18 ||
        new Set(release.models.map((m) => m.name)).size !== 18
      )
        throw new Error(
          "A release must pass every data test before publication.",
        );
      this.db
        .prepare("INSERT INTO releases VALUES(?,?,?,?)")
        .run(
          id,
          new Date(this.clock()).toISOString(),
          release.schema,
          JSON.stringify(release),
        );
      this.db
        .prepare("INSERT OR REPLACE INTO active_release VALUES(1,?)")
        .run(id);
      this.db
        .prepare(
          "UPDATE jobs SET status='success',finished_at=?,release_schema=?,details=?,owner=NULL,lease_until=NULL WHERE id=?",
        )
        .run(
          new Date(this.clock()).toISOString(),
          release.schema,
          JSON.stringify(release.run),
          id,
        );
      this.audit(job.actor, "publish_release", id, "success");
    });
  }
  release() {
    const r = this.db
      .prepare(
        "SELECT r.* FROM releases r JOIN active_release a ON a.release_id=r.id WHERE a.id=1",
      )
      .get();
    return r
      ? { ...JSON.parse(r.payload), id: r.id, publishedAt: r.published_at }
      : null;
  }
  rollback(id, actor) {
    return this.transaction(() => {
      const r = this.db.prepare("SELECT id FROM releases WHERE id=?").get(id);
      if (!r) throw new Error("Release not found.");
      this.db
        .prepare("INSERT OR REPLACE INTO active_release VALUES(1,?)")
        .run(id);
      this.audit(actor, "rollback_release", id, "success");
    });
  }
  prune() {
    const now = this.clock();
    this.db.prepare("DELETE FROM sessions WHERE expires<=?").run(now);
    this.db.prepare("DELETE FROM login_transactions WHERE expires<=?").run(now);
  }
  close() {
    this.db.close();
  }
}
