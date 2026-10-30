# Production deployment and operations

This project targets one private internal workspace on one Linux Docker host, with company OpenID Connect SSO, a Snowflake reader identity for the web app, and a separate transformer identity for a background worker. It is not a public multi-tenant service. Local sample mode remains available for development and is refused when `NODE_ENV=production`.

The repository contains production controls and deployment templates. Going live still requires configuring and testing your own Snowflake account, IdP, DNS, TLS, persistent storage, backups, and monitoring. Offline tests and parsing do not prove those external systems work.

## Architecture and release boundary

1. The web app verifies SSO identity and group membership. A viewer can inspect approved data; an operator can request builds. Built-in CSV exports are disabled by default and require an operator when enabled.
2. A build request enqueues one durable job in `operations.sqlite`. Concurrent requests follow the same active job. No dbt process runs inside an HTTP request.
3. The worker claims a renewable lease and creates a source-schema clone. All source tables for that release are frozen together, so later ingestion cannot change a tested release through a live staging view.
4. The worker checks all three sources for freshness, then runs a complete dbt build in a new release schema, excluding the separately managed customer snapshot. All configured tests must execute and pass. Warnings, skipped tests, missing models, and stale sources prevent publication.
5. The worker creates `APP_*` views with explicit approved columns. Only those views are granted to the reader role. Newly added columns are denied until reviewed in `server/warehouse.mjs`.
6. One operational-database transaction records the successful release and changes the active pointer. Each dashboard request captures one release and uses its immutable schema for every query. A failed build preserves the prior release.

Business data stays in Snowflake. The local operational database stores hashed session identifiers, job state, release metadata, and audit events. SQLite WAL is appropriate here for **one host, one web process, and one worker on a local persistent volume**. Do not place it on NFS, run independent hosts against it, or scale the web service horizontally without replacing operational storage and coordination with a shared service such as PostgreSQL.

## Required external setup

### Snowflake

- Use a dedicated database and a dedicated Bronze schema containing native Snowflake customer, product, and order tables. Review `sql/bootstrap_snowflake.sql` for the source contract; it does not migrate existing tables or load data.
- Supply actual UTC `loaded_at` values on every source row, actual customer `created_at` timestamps, and actual product `available_from` dates. Do not fabricate historical creation dates. Production requires these columns explicitly. Invalid types, missing ingestion timestamps, lost rows, inconsistent revenue, and invalid event chronology block a release.
- Provision separate reader and transformer service users with key-pair authentication. Mount PKCS#8 private keys through the deployment secret files. Encrypt the private keys and store their passphrases separately. Rotate keys using Snowflake's supported dual-key rotation process.
- Review and adapt `sql/production_access.sql`. The transformer needs schema creation, source access and cloning privileges, warehouse usage, and the ability to grant access to views it owns. The reader needs database/warehouse usage and only the safe views the worker grants. Do not grant the reader raw-table access, broad future grants, inherited transformer privileges, or an administrator role.
- Ensure the source schema and database have no broad inherited/future reader grants that defeat the intended boundary. Test the reader identity directly: it must read `APP_*` views and fail when querying raw/customer tables.
- Set both service users' session defaults to `TIMEZONE=UTC`, `STATEMENT_TIMEOUT_IN_SECONDS=900`, and `ABORT_DETACHED_QUERY=TRUE`. Configure warehouse auto-suspend and a resource monitor for your approved budget. The worker performs full isolated builds; large datasets require cost/performance acceptance before scheduling them.
- Freshness defaults to warnings after 24 hours and errors after 48 hours; **publication requires a pass**, so even a freshness warning blocks release. Adjust the source thresholds deliberately for your ingestion SLA.

Completed historical orders are needed to populate the AI datasets. Customer features exclude customers and purchases on or after the explicit as-of date. Demand features begin at product availability and include zero-sales days; their lags exclude the target day. Current inventory/ratings are suitable for current product knowledge, not historical predictive inputs. No predictive model or embedding service is silently enabled.

The stable customer salt must contain at least 32 characters. Its hash is pseudonymous, not anonymous. dbt renders the salt into compiled SQL, so keep compiled artifacts and logs private. The worker has a separate artifact volume that the web container cannot mount. Do not upload those files as public CI artifacts.

Source ingestion is an upstream responsibility: provision the three typed tables and a reliable loader before running this transformation service. Existing tables need a reviewed migration/backfill for the new creation/availability/ingestion columns; `CREATE TABLE IF NOT EXISTS` does not add or backfill them.

### Company SSO

Register a confidential OIDC application with your company identity provider:

- Redirect URI: `https://your-approved-host/auth/callback`, with an exact match.
- Authorization Code flow with PKCE S256, `openid profile email`, signed ID tokens, and a groups claim in the ID token.
- Distinct viewer and operator groups. Configure their exact names or IDs in `OIDC_VIEWER_GROUP` and `OIDC_OPERATOR_GROUP`. If your provider uses an alternate groups-claim name, set `OIDC_GROUPS_CLAIM`. Group overage/distributed claims are deliberately refused; configure an application-specific groups claim or application assignments.
- Store the client secret in `deploy/secrets/oidc-client-secret` and restrict its host permissions.

The app validates issuer, audience, signature, nonce, state, code verifier, and group membership. Login transactions are single-use. Session cookies are Secure, HttpOnly, SameSite=Lax and host-only. Sessions expire after at most one hour by default, bounded by the identity token expiry. Group removal takes effect at the next sign-in or session expiry; for immediate workspace revocation, use the administrative session-revocation command below. Workspace sign-out does not end the company-wide SSO session.

## Build and deploy

Use a Linux host with supported Docker Engine and Compose, a domain pointing at that host, outbound access to Snowflake/IdP/certificate endpoints, and inbound 80/443 for Caddy's HTTPS service. Port 3000 is not published to the host.

1. Run the repository CI and credentialed staging acceptance checks. Build one image and promote the same tested digest between environments. Do not rebuild separately in production.
2. Copy `deploy/web.env.example`, `worker.env.example`, and `proxy.env.example` to their corresponding `.env` filenames. Set actual account identifiers, service users, roles, origin, issuer, groups, and domain. The web role must equal the configured reader role; the worker must use its separate transformer role.
3. Create `deploy/secrets/` on the deployment host and provide `reader.p8`, `reader-passphrase`, `worker.p8`, `worker-passphrase`, `oidc-client-secret`, and `customer-key-salt`. Never commit them. Set host directory/file permissions and ensure UID 10001 can read the mounted secret files. Docker Compose file secrets rely on the host filesystem for protection.
4. Set `SNOWSTACK_IMAGE` and `CADDY_IMAGE` to verified `registry/image@sha256:...` references. Caddy also needs a tested immutable image. The application image uses a non-root UID, a read-only root filesystem, resource limits, and separate persistent state/artifact volumes.

```sh
docker build -t your-registry/snowstack:release .
# Push and obtain the tested image digest through your approved registry process.
export SNOWSTACK_IMAGE='your-registry/snowstack@sha256:<verified-64-hex-digest>'
export CADDY_IMAGE='caddy@sha256:<verified-64-hex-digest>'
npm run deployment:check
docker compose -f deploy/compose.yml config --quiet
docker compose -f deploy/compose.yml up -d
```

`deployment:check` validates static settings and secret presence, not external connectivity. The domain and both origins must agree. Caddy handles TLS and redacts request targets/cookies from its logs. The Node API logs route, status, timing, pseudonymous actor ID and request ID; it does not log question bodies, callback query parameters, SQL, or credentials.

Queue the first release through the signed-in operator's setup screen, or use the deployment CLI:

```sh
docker compose -f deploy/compose.yml exec worker node scripts/jobs.mjs queue
docker compose -f deploy/compose.yml exec worker node scripts/jobs.mjs status
```

No automatic schedule runs by default. If your ingestion SLA and compute budget support it, set `PIPELINE_INTERVAL_MINUTES` in `worker.env` and restart the worker. This is an interval measured from worker startup, not a calendar cron scheduler. The job lease prevents concurrent publication. A crashed worker's expired job becomes failed and is not automatically replayed; review the error and queue a new run.

## Validation gates before go-live

- `npm ci --ignore-scripts`, `npm run check`, and `npm test` pass on Windows and Linux. Authentication tests exercise signed OIDC tokens and reject tampered signatures, wrong audiences/issuers/nonces, expired tokens, unauthorized groups, and callback replay.
- `npm audit --omit=dev --audit-level=high` passes. Runtime npm versions are locked; Python dependencies are pinned and hash-locked in `requirements.lock`.
- `dbt parse --target prod` and the offline Snowflake grammar check pass. These are structural checks, not warehouse execution.
- The manually dispatched staging workflow completes against an isolated database whose name ends in `_CI`, with all source fixtures provisioned and current ingestion timestamps. Configure the GitHub `staging` environment and required reviewers outside the repository; the YAML name alone does not establish an approval policy. No PR workflow receives warehouse credentials.
- The Docker image builds, the proxy configuration validates, an unconfigured production container refuses to start, and the image smoke test passes. Docker was not available on the original development machine; run this CI gate on the Linux build host.
- Actual SSO viewer/operator accounts behave correctly in the browser. The reader identity fails raw-table access. A controlled invalid source blocks a build and leaves the previous dashboard release available. Verify this in staging.
- `/healthz` reports process liveness; `/readyz` reports a published, reachable release younger than `MAX_RELEASE_AGE_HOURS` (48 by default). It can return 503 before the first release or when warehouse data is stale. The worker heartbeat has its own container health check. Set external alerts for readiness failures, unhealthy workers, failed jobs, persistent queue time, storage pressure and warehouse budget events.
- Back up and restore operational state, retain required warehouse releases/source clones, test rollback, and measure realistic latency/concurrency against your Snowflake data. Suggested initial acceptance objectives are warm overview p95 under 2 seconds and no unbounded query/export memory growth; these are targets, not benchmark claims.

The web process limits request bodies, query concurrency, query duration, requests per user, build requests, exports, and response size. Production exports are disabled by default. When enabled, rows are capped (5,000 by default), text cells are capped at 2,000 characters, and responses are capped at 4 MiB. Browser CSVs are inspection exports, not a full-fidelity ML training-data transfer mechanism. Use a governed warehouse export for complete training datasets.

## Backup and recovery

The operational database and its WAL files must stay together on a local persistent volume. Use the SQLite online backup API; copying only the live `.sqlite` file is unsafe while writers are active.

```sh
docker compose -f deploy/compose.yml exec worker node scripts/backup-state.mjs /var/lib/snowstack/backups/operations-unique-timestamp.sqlite
```

The script refuses existing destinations and creates private files. Export backups through your approved encrypted backup process. Backups contain sessions and audit records; control access and retention. The artifacts volume is separately sensitive and must be governed independently. Do not run `docker compose down -v` against a live deployment.

To restore, stop both web and worker, preserve the current state volume, restore the verified backup into a clean state directory, and restart the services. Revoke restored sessions if recovering from an access incident. Check the active release pointer and `/readyz` before reopening access. A Snowflake release and its source clone must still exist for a restored pointer to work.

Rollback to a prior successful release without rebuilding:

```sh
docker compose -f deploy/compose.yml exec worker node scripts/jobs.mjs rollback <successful-release-id>
docker compose -f deploy/compose.yml exec worker node scripts/jobs.mjs revoke-sessions
```

The second command is for access incidents and signs everyone out. Rollback changes the published pointer in a transaction and records an audit event. Stale rolled-back releases intentionally fail the readiness age policy until resolved. Do not drop schemas or source clones used by the active release, retained rollback releases, historical training snapshots, or required audit evidence.

Failed jobs record their planned release/source schema names and sanitized error codes. dbt query tags contain the job ID for tracing in Snowflake Query History. Diagnose private dbt artifacts with the transformer/operator identity; never copy credential-bearing SQL or source-row failure samples into public logs. Cancel abandoned warehouse queries through your approved Snowflake operations process, investigate the source/configuration issue, and queue a new isolated build.

## Update procedure

Dependency update PRs are configured through Dependabot. Regenerate the Python lock with a universal resolver and hashes when changing `requirements.txt`. Run all CI, image, staging, backup/restore, and role checks before promoting a new image digest. Keep the old tested image and compatible operational backup for rollback. The application refuses operational database versions newer than it understands.
