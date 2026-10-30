import test, { after } from "node:test";
import assert from "node:assert/strict";
import {
  createPipeline,
  build,
  overview,
  preview,
  insight,
  validate,
  readCatalog,
} from "../server/pipeline.mjs";

const p = createPipeline();
after(() => p.db.close());

test("the actual dbt catalog has all 18 executable local models and resolved references", () => {
  const models = readCatalog();
  assert.equal(models.length, 18);
  const names = new Set(models.map((m) => m.name));
  for (const m of models) {
    assert.ok(m.sql.length > 20);
    for (const ref of m.dependencies)
      assert.ok(names.has(ref), `Unresolved ref ${ref}`);
  }
  assert.equal(overview(p).models.length, 18);
});

test("source records pass integrity and reconciliation checks", () => {
  const d = overview(p);
  assert.equal(d.testsPassed, d.totalTests);
  assert.equal(d.totalTests, 26);
  assert.ok(d.totalRows > 20000);
  assert.equal(d.featureRows, 1200);
  assert.equal(d.documentRows, 30);
  assert.equal(d.demandRows, 30 * 180);
  assert.equal(d.readiness, 100);
  const revenue = p.db
    .prepare("SELECT sum(total_amount) n FROM orders")
    .get().n;
  const daily = p.db
    .prepare("SELECT sum(total_revenue) n FROM daily_sales")
    .get().n;
  assert.ok(Math.abs(revenue - daily) < 0.01);
});

test("reporting windows and category totals reconcile for 7, 30 and 90 days", () => {
  for (const days of [7, 30, 90]) {
    const d = overview(p, days);
    assert.equal(d.trend.length, days);
    assert.equal(
      d.trend.reduce((n, r) => n + r.total_orders, 0),
      d.current.orders,
    );
    assert.ok(
      Math.abs(
        d.categories.reduce((n, r) => n + r.revenue, 0) - d.current.revenue,
      ) < 0.01,
    );
    assert.ok(d.current.revenue > 0);
  }
});

test("rebuilds are idempotent and record real execution results", () => {
  const before = overview(p);
  build(p);
  const after = overview(p);
  assert.deepEqual(after.current, before.current);
  assert.equal(after.runs.length, before.runs.length + 1);
  assert.equal(after.runs[0].details.length, 18);
  assert.ok(after.runs[0].duration_ms > 0);
});

test("previews and downloads omit direct identifiers and reject unrecognized tables", () => {
  for (const name of [
    "customer",
    "orders",
    "customer_summary",
    "customer_segmentation",
    "top_customers",
  ]) {
    const sample = preview(p, name);
    for (const field of ["customer_id", "email", "age", "gender"])
      assert.ok(!sample.columns.includes(field));
    assert.ok(sample.redacted > 0);
  }
  assert.throws(() => preview(p, "raw_customer"), /not found/);
  assert.throws(() => preview(p, "orders; DROP TABLE orders"), /not found/);
});

test("customer features exclude present-day and future transactions", () => {
  const before = p.db
    .prepare("SELECT * FROM customer_features ORDER BY customer_key")
    .all();
  const asOf = overview(p).asOf;
  p.db
    .prepare("INSERT INTO raw_orders VALUES(?,?,?,?,?,?,?)")
    .run(9999999, 1, 1, 2, 258, asOf, new Date().toISOString());
  build(p);
  assert.deepEqual(
    p.db.prepare("SELECT * FROM customer_features ORDER BY customer_key").all(),
    before,
  );
  p.db.exec("DELETE FROM raw_orders WHERE transaction_id=9999999");
  build(p);
});

test("daily demand contains zero-sale days and strictly historical lag values", () => {
  const zero = p.db
    .prepare("SELECT count(*) n FROM daily_demand_features WHERE units_sold=0")
    .get().n;
  assert.ok(zero > 0);
  const first = p.db
    .prepare(
      "SELECT * FROM daily_demand_features ORDER BY demand_date,product_id LIMIT 1",
    )
    .get();
  assert.equal(first.units_lag_1d, null);
  assert.equal(first.avg_units_previous_7d, null);
  assert.equal(
    validate(p).find((c) => c.name === "Demand lag uses the previous day")
      .status,
    "pass",
  );
});

test("quality failure rolls back transformed tables and records a failed run", () => {
  const before = overview(p).current;
  p.db
    .prepare("INSERT INTO raw_orders VALUES(?,?,?,?,?,?,?)")
    .run(
      9999998,
      999999,
      1,
      1,
      -10,
      overview(p).trend[0].transaction_date,
      new Date().toISOString(),
    );
  assert.throws(() => build(p), /data quality checks failed/);
  assert.deepEqual(overview(p).current, before);
  const last = p.db
    .prepare(
      "SELECT status FROM pipeline_runs ORDER BY started_at DESC LIMIT 1",
    )
    .get();
  assert.equal(last.status, "failed");
  p.db.exec("DELETE FROM raw_orders WHERE transaction_id=9999998");
  build(p);
  assert.equal(overview(p).testsPassed, 26);
});

test("analytical answers cite models and never invent predictions", () => {
  const answer = insight(p, "Which category leads revenue?", 7);
  assert.ok(answer.answer.includes("7 days"));
  assert.ok(answer.sources.includes("orders"));
  assert.match(
    insight(p, "Predict next month revenue").answer,
    /does not contain a trained predictive model/,
  );
  assert.match(insight(p, "Hello").answer, /predefined analytical queries/);
  assert.ok(
    insight(p, "Is the data ready for AI?").sources.includes(
      "customer_features",
    ),
  );
});
