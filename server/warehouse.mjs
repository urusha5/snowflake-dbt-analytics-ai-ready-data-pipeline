import { quoted, identifier } from "./config.mjs";
import { readCatalog, PROJECT_NAME } from "./pipeline.mjs";

// Explicit public projections. A newly added warehouse column is never exposed
// merely because it exists. The reader role receives these views only.
export const SAFE_COLUMNS = {
  stg_customer: ["customer_type", "total_purchases"],
  customer: ["customer_type", "total_purchases"],
  stg_product: [
    "product_id",
    "name",
    "category",
    "price",
    "stock_quantity",
    "rating",
    "available_from",
  ],
  product: [
    "product_id",
    "name",
    "category",
    "price",
    "stock_quantity",
    "rating",
    "available_from",
  ],
  stg_orders: [
    "transaction_id",
    "product_id",
    "quantity",
    "total_amount",
    "transaction_date",
    "loaded_at",
    "customer_key",
  ],
  orders: [
    "transaction_id",
    "product_id",
    "quantity",
    "total_amount",
    "transaction_date",
    "loaded_at",
    "customer_key",
  ],
  incremental_sales: [
    "transaction_id",
    "product_id",
    "quantity",
    "total_amount",
    "transaction_date",
    "loaded_at",
    "customer_key",
  ],
  daily_sales: [
    "transaction_date",
    "total_orders",
    "total_quantity",
    "total_revenue",
    "average_order_value",
    "unique_customers",
    "unique_products",
  ],
  monthly_sales: [
    "sales_month",
    "total_orders",
    "total_quantity",
    "total_revenue",
    "average_order_value",
  ],
  category_sales: [
    "category",
    "total_orders",
    "total_units_sold",
    "total_revenue",
    "average_order_value",
  ],
  customer_summary: [
    "customer_type",
    "total_orders",
    "total_quantity",
    "lifetime_value",
    "average_order_value",
    "first_purchase_date",
    "last_purchase_date",
  ],
  customer_segmentation: [
    "customer_type",
    "total_orders",
    "total_units",
    "lifetime_value",
    "average_order_value",
    "first_purchase",
    "last_purchase",
    "customer_segment",
  ],
  top_customers: [
    "customer_type",
    "total_orders",
    "total_units",
    "lifetime_value",
    "average_order_value",
    "unique_products",
    "first_purchase",
    "last_purchase",
    "customer_rank",
  ],
  product_performance: [
    "product_id",
    "product_name",
    "category",
    "price",
    "stock_quantity",
    "rating",
    "available_from",
    "total_orders",
    "total_units_sold",
    "total_revenue",
    "average_order_value",
  ],
  executive_dashboard: [
    "total_orders",
    "total_customers",
    "total_products",
    "total_units_sold",
    "total_revenue",
    "average_order_value",
    "average_customer_spend",
    "average_units_per_order",
  ],
  customer_features: [
    "customer_key",
    "feature_as_of_date",
    "order_count",
    "lifetime_value",
    "average_order_value",
    "recency_days",
    "orders_30d",
    "revenue_30d",
    "orders_90d",
    "revenue_90d",
    "unique_products",
    "last_purchase_date",
  ],
  product_knowledge: [
    "document_id",
    "product_id",
    "product_name",
    "category",
    "content",
    "source_reference",
    "updated_as_of",
  ],
  daily_demand_features: [
    "product_id",
    "demand_date",
    "units_sold",
    "revenue",
    "units_lag_1d",
    "units_lag_7d",
    "avg_units_previous_7d",
  ],
};
export function publicColumns(model, columns) {
  if (!SAFE_COLUMNS[model]) throw new Error("Model not found.");
  return columns.filter((c) =>
    SAFE_COLUMNS[model].includes(c.name.toLowerCase()),
  );
}
export const MODEL_NAMES = Object.keys(SAFE_COLUMNS);

export class Warehouse {
  constructor(config, pool) {
    this.config = config;
    this.pool = pool;
    this.pending = 0;
  }
  async init() {
    if (this.pool) return;
    const { default: snowflake } = await import("snowflake-sdk");
    snowflake.configure({ logLevel: "OFF", ocspFailOpen: false });
    const {
      account,
      username,
      privateKeyPath,
      privateKeyPass,
      database,
      role,
      warehouse,
    } = this.config.warehouse;
    this.pool = snowflake.createPool(
      {
        account,
        username,
        privateKeyPath,
        privateKeyPass: privateKeyPass || undefined,
        database,
        role,
        warehouse,
        authenticator: "SNOWFLAKE_JWT",
        application: "Snowstack",
        clientSessionKeepAlive: false,
        // No SDK credential, token, or SQL logging. Statements have a server timeout.
        timeout: 15000,
      },
      { max: 3, min: 0, acquireTimeoutMillis: 10000, idleTimeoutMillis: 60000 },
    );
  }
  async query(sql, binds = [], tag = "snowstack:read") {
    await this.init();
    if (this.pending >= 12)
      throw Object.assign(new Error("Warehouse is busy."), {
        code: "WAREHOUSE_BUSY",
      });
    this.pending++;
    try {
      return await this.pool.use(
        (connection) =>
          new Promise((resolve, reject) => {
            let settled = false,
              statement;
            const finish = (error, rows) => {
              if (settled) return;
              settled = true;
              clearTimeout(timer);
              if (error)
                reject(
                  Object.assign(new Error("Warehouse query failed."), {
                    code: "WAREHOUSE_QUERY_FAILED",
                    queryId: statement?.getStatementId?.(),
                  }),
                );
              else
                resolve(
                  (rows || []).map((row) =>
                    Object.fromEntries(
                      Object.entries(row).map(([key, v]) => [
                        key.toLowerCase(),
                        v instanceof Date ? v.toISOString() : v,
                      ]),
                    ),
                  ),
                );
            };
            const timer = setTimeout(() => {
              statement?.cancel?.(() => {});
              finish(new Error("timeout"));
            }, this.config.queryTimeoutMs);
            try {
              statement = connection.execute({
                sqlText: sql,
                binds,
                parameters: {
                  STATEMENT_TIMEOUT_IN_SECONDS: Math.ceil(
                    this.config.queryTimeoutMs / 1000,
                  ),
                  QUERY_TAG: tag,
                  MULTI_STATEMENT_COUNT: 1,
                },
                complete: (err, _statement, rows) => finish(err, rows),
              });
            } catch (error) {
              finish(error);
            }
          }),
      );
    } finally {
      this.pending--;
    }
  }
  async close() {
    if (this.pool) {
      await this.pool.drain();
      await this.pool.clear();
    }
  }
}

export class SnowflakeProvider {
  constructor(config, state, warehouse = new Warehouse(config)) {
    this.config = config;
    this.state = state;
    this.warehouse = warehouse;
    this.cache = new Map();
    this.inflight = new Map();
    this.catalog = readCatalog();
  }
  release() {
    const r = this.state.release();
    if (!r)
      throw Object.assign(
        new Error("No validated warehouse release has been published yet."),
        { status: 503, code: "NO_PUBLISHED_RELEASE" },
      );
    if (!r.schema.startsWith(`${this.config.schemaPrefix}_`))
      throw new Error("Invalid published schema.");
    identifier(r.schema);
    return r;
  }
  table(r, name) {
    if (!MODEL_NAMES.includes(name))
      throw Object.assign(new Error("Model not found."), { status: 404 });
    return `${quoted(this.config.warehouse.database)}.${quoted(r.schema)}.${quoted(`APP_${name}`)}`;
  }
  async ready() {
    try {
      const r = this.release();
      if (
        Date.now() - Date.parse(r.publishedAt) >
        this.config.maxReleaseAgeHours * 3600000
      )
        return false;
      await this.warehouse.query(
        `SELECT 1 FROM ${this.table(r, "daily_sales")} LIMIT 1`,
        [],
        "snowstack:readiness",
      );
      return true;
    } catch {
      return false;
    }
  }
  async overview(days = 30) {
    const r = this.release(),
      key = `${r.id}:${days}`,
      entry = this.cache.get(key);
    if (entry && Date.now() - entry.at < 30000)
      return {
        ...entry.data,
        runs: this.runs(),
        busy: this.busy(),
        workerAvailable: this.state.workerAlive(),
        lastError:
          this.runs()[0]?.status === "failed"
            ? this.runs()[0].error_code
            : null,
      };
    if (this.inflight.has(key)) return this.inflight.get(key);
    const promise = this.loadOverview(r, days)
      .then((data) => {
        this.cache.set(key, { at: Date.now(), data });
        while (this.cache.size > 6)
          this.cache.delete(this.cache.keys().next().value);
        return data;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, promise);
    return promise;
  }
  busy() {
    return this.state
      .jobs()
      .some((j) => ["queued", "running"].includes(j.status));
  }
  runs() {
    return this.state
      .jobs()
      .map((j) => ({
        id: j.id,
        started_at: j.started_at || j.created_at,
        finished_at: j.finished_at,
        status: j.status,
        duration_ms: j.details.duration_ms || 0,
        models: j.details.models?.length || 0,
        tests: j.details.tests || 0,
        failed: 0,
        details: j.details.models || [],
        error_code: j.error_code,
      }));
  }
  async loadOverview(r, days) {
    const t = (name) => this.table(r, name),
      q = (sql, binds = []) => this.warehouse.query(sql, binds);
    const metricSql = `SELECT COUNT(*) orders,ROUND(COALESCE(SUM(total_amount),0),2) revenue,COUNT(DISTINCT customer_key) customers,ROUND(COALESCE(AVG(total_amount),0),2) aov FROM ${t("incremental_sales")} WHERE transaction_date>=DATEADD('day',?,TO_DATE(?)) AND transaction_date<DATEADD('day',?,TO_DATE(?))`;
    const [cur, priorRows, trend, categories] = await Promise.all([
      q(metricSql, [-days, r.asOf, 0, r.asOf]),
      q(metricSql, [-2 * days, r.asOf, -days, r.asOf]),
      q(
        `SELECT * FROM ${t("daily_sales")} WHERE transaction_date>=DATEADD('day',?,TO_DATE(?)) AND transaction_date<TO_DATE(?) ORDER BY transaction_date`,
        [-days, r.asOf, r.asOf],
      ),
      q(
        `SELECT p.category,ROUND(SUM(o.total_amount),2) revenue,COUNT(*) orders FROM ${t("incremental_sales")} o JOIN ${t("product")} p USING(product_id) WHERE transaction_date>=DATEADD('day',?,TO_DATE(?)) AND transaction_date<TO_DATE(?) GROUP BY p.category ORDER BY revenue DESC`,
        [-days, r.asOf, r.asOf],
      ),
    ]);
    const current = cur[0],
      prior = priorRows[0];
    const changes = Object.fromEntries(
      Object.keys(current).map((k) => [
        k,
        prior[k]
          ? Math.round(((current[k] - prior[k]) / prior[k]) * 10000) / 100
          : null,
      ]),
    );
    const testsPassed = r.checks.filter((c) => c.status === "pass").length,
      aiChecks = r.checks.filter(
        (c) =>
          c.model &&
          [
            "customer_features",
            "product_knowledge",
            "daily_demand_features",
          ].includes(c.model),
      );
    const models = this.catalog.map((m) => {
      const published = r.models.find((x) => x.name === m.name);
      if (!published) throw new Error("Incomplete published catalog.");
      return {
        ...m,
        ...published,
        status: r.checks.some((c) => c.model === m.name && c.status !== "pass")
          ? "fail"
          : "healthy",
        owner: m.layer === "ai" ? "AI Engineering" : "Data Engineering",
      };
    });
    return {
      project: PROJECT_NAME,
      mode: "snowflake",
      engine: "Snowflake",
      releaseId: r.id,
      publishedAt: r.publishedAt,
      stale:
        Date.now() - Date.parse(r.publishedAt) >
        this.config.maxReleaseAgeHours * 3600000,
      asOf: r.asOf,
      seededAt: null,
      days,
      current,
      prior,
      changes,
      trend,
      categories,
      runs: this.runs(),
      checks: r.checks,
      testsPassed,
      totalTests: r.checks.length,
      readiness: aiChecks.length
        ? Math.round(
            (aiChecks.filter((c) => c.status === "pass").length /
              aiChecks.length) *
              100,
          )
        : 0,
      readinessChecks: aiChecks.length,
      totalRows: r.sourceCounts.raw_orders,
      sourceCounts: r.sourceCounts,
      featureRows: models.find((m) => m.name === "customer_features").rows,
      documentRows: models.find((m) => m.name === "product_knowledge").rows,
      demandRows: models.find((m) => m.name === "daily_demand_features").rows,
      busy: this.busy(),
      models,
      lastError:
        this.state.jobs()[0]?.status === "failed"
          ? this.state.jobs()[0].error_code
          : null,
      workerAvailable: this.state.workerAlive(),
      freshness: r.freshness,
    };
  }
  async preview(name, download = false) {
    const r = this.release(),
      model = r.models.find((m) => m.name === name);
    if (!model)
      throw Object.assign(new Error("Model not found."), { status: 404 });
    const columns = publicColumns(name, model.columns).map((c) => c.name);
    if (!columns.length)
      throw new Error("This model has no approved public columns.");
    const limit = download ? this.config.maxExportRows : 12;
    const projection = publicColumns(name, model.columns).map((c) =>
      /VARCHAR|TEXT|STRING/i.test(c.type)
        ? `LEFT(${quoted(c.name)},2000) AS ${quoted(c.name)}`
        : quoted(c.name),
    );
    const rows = await this.warehouse.query(
      `SELECT ${projection.join(",")} FROM ${this.table(r, name)} LIMIT ?`,
      [limit],
      "snowstack:preview",
    );
    return {
      name,
      columns,
      rows,
      redacted: model.redacted || 0,
      limit,
      truncated: model.rows > limit,
      textLimit: 2000,
    };
  }
  async insight(question, days) {
    const d = await this.overview(days),
      text = question.toLowerCase(),
      money = (n) =>
        new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: "USD",
          maximumFractionDigits: 0,
        }).format(n);
    if (/forecast|predict|churn|train|model accuracy/.test(text))
      return {
        answer:
          "There is no evaluated predictive model connected. These datasets provide inputs for a separately trained model with historical labels and time-based evaluation; this workspace will not invent predictions.",
        sources: ["daily_demand_features", "customer_features"],
        kind: "Model guidance",
      };
    if (/ready|readiness|quality|test|pii|feature/.test(text))
      return {
        answer: `Published release ${d.releaseId} passed ${d.testsPassed} of ${d.totalTests} dbt checks. It contains ${d.featureRows} customer feature rows, ${d.documentRows} product documents, and ${d.demandRows} daily demand rows, as of ${d.asOf}. This measures dataset checks, not predictive performance or anonymization.`,
        sources: [
          "customer_features",
          "product_knowledge",
          "daily_demand_features",
        ],
        kind: "Validated warehouse release",
      };
    if (/customer|segment|retention/.test(text)) {
      const r = this.release(),
        rows = await this.warehouse.query(
          `SELECT customer_segment,COUNT(*) customers,ROUND(SUM(lifetime_value),2) revenue FROM ${this.table(r, "customer_segmentation")} GROUP BY customer_segment ORDER BY revenue DESC`,
        );
      return {
        answer: `Across all history in the published release: ${rows.map((s) => `${s.customer_segment}: ${s.customers} customers and ${money(s.revenue)} revenue`).join("; ")}. Segmentation describes observed spending, not future value.`,
        sources: ["customer_segmentation"],
        kind: "Customer analysis",
      };
    }
    if (/product|sell|best/.test(text)) {
      const r = this.release(),
        rows = await this.warehouse.query(
          `SELECT p.name,ROUND(SUM(o.total_amount),2) revenue FROM ${this.table(r, "incremental_sales")} o JOIN ${this.table(r, "product")} p USING(product_id) WHERE transaction_date>=DATEADD('day',?,TO_DATE(?)) AND transaction_date<TO_DATE(?) GROUP BY p.name ORDER BY revenue DESC LIMIT 3`,
          [-days, r.asOf, r.asOf],
        );
      return {
        answer: `Top products by revenue in the ${days} days before ${r.asOf}: ${rows.map((p) => `${p.name} (${money(p.revenue)})`).join(", ")}.`,
        sources: ["incremental_sales", "product"],
        kind: "Product analysis",
      };
    }
    if (/revenue|sale|category|perform|trend|order|business/.test(text))
      return {
        answer: `Revenue was ${money(d.current.revenue)} across ${d.current.orders} orders in the ${days} days before ${d.asOf}. ${d.categories[0]?.category || "No category"} leads the period. Average order value: ${money(d.current.aov)}.`,
        sources: ["daily_sales", "incremental_sales"],
        kind: "Revenue analysis",
      };
    return {
      answer:
        "Supported questions cover revenue, products, customer segments, and dataset readiness. Answers use approved analytical SQL over the published Snowflake release; no LLM is connected.",
      sources: [],
      kind: "Analytical guide",
    };
  }
  close() {
    return this.warehouse.close();
  }
}
