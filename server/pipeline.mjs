import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, mkdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const PROJECT_NAME =
  "Snowflake + dbt Analytics and AI-Ready Data Pipeline";
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const DAY = 86400000;
const round = (n) => Math.round(n * 100) / 100;
const date = (n) => new Date(n).toISOString().slice(0, 10);
const descriptions = {
  stg_customer: "Standardized customer source records",
  stg_product: "Standardized product catalog",
  stg_orders: "Typed retail transactions with ingestion timestamps",
  customer: "Clean customer dimension",
  product: "Clean product dimension",
  orders: "Validated retail transaction fact table",
  daily_sales: "Daily revenue, order volume, and customer reach",
  monthly_sales: "Monthly sales trends and average order value",
  category_sales: "Revenue and units by product category",
  customer_summary: "Customer lifetime purchasing metrics",
  customer_segmentation: "Value-based customer segments",
  product_performance: "Product sales, inventory, and ratings",
  top_customers: "Customers ranked by lifetime value",
  executive_dashboard: "Executive business performance indicators",
  incremental_sales: "Transaction-level sales with a late-arrival lookback",
  customer_features:
    "As-of customer behavior features without direct identifiers",
  product_knowledge: "Product documents with source provenance for retrieval",
  daily_demand_features: "Historical product demand with lagged features",
};

export function readCatalog(root = ROOT) {
  const walk = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? walk(join(dir, entry.name))
        : entry.name.endsWith(".sql")
          ? [join(dir, entry.name)]
          : [],
    );
  return walk(join(root, "models")).map((file) => {
    const sql = readFileSync(file, "utf8");
    const name = file.split(/[\\/]/).at(-1).replace(".sql", "");
    const layer = relative(join(root, "models"), file).split(/[\\/]/)[0];
    return {
      name,
      layer,
      description: descriptions[name] || name,
      path: relative(root, file).replaceAll("\\", "/"),
      sql,
      materialization:
        name === "incremental_sales"
          ? "incremental"
          : ["staging", "silver"].includes(layer)
            ? "view"
            : "table",
      dependencies: [...sql.matchAll(/ref\(['"]([^'"]+)['"]\)/g)].map(
        (m) => m[1],
      ),
      sources: [
        ...sql.matchAll(/source\(['"]([^'"]+)['"],\s*['"]([^'"]+)['"]\)/g),
      ].map((m) => `${m[1]}.${m[2]}`),
    };
  });
}

const transforms = {
  stg_customer: "SELECT * FROM raw_customer",
  stg_product: "SELECT * FROM raw_product",
  stg_orders: "SELECT * FROM raw_orders",
  customer: `SELECT customer_id, customer_type, lower(email) email, CASE WHEN age BETWEEN 18 AND 120 THEN age END age, gender, total_purchases FROM stg_customer`,
  product: "SELECT * FROM stg_product",
  orders: "SELECT * FROM stg_orders",
  daily_sales: `SELECT transaction_date, count(*) total_orders, sum(quantity) total_quantity, round(sum(total_amount),2) total_revenue, round(avg(total_amount),2) average_order_value, count(DISTINCT customer_id) unique_customers, count(DISTINCT product_id) unique_products FROM orders GROUP BY transaction_date`,
  monthly_sales: `SELECT substr(transaction_date,1,7)||'-01' sales_month, count(*) total_orders, sum(quantity) total_quantity, round(sum(total_amount),2) total_revenue, round(avg(total_amount),2) average_order_value FROM orders GROUP BY substr(transaction_date,1,7)`,
  category_sales: `SELECT p.category, count(*) total_orders, sum(o.quantity) total_units_sold, round(sum(o.total_amount),2) total_revenue, round(avg(o.total_amount),2) average_order_value FROM orders o JOIN product p USING(product_id) GROUP BY p.category`,
  customer_summary: `SELECT c.customer_id, c.customer_type, c.email, c.age, c.gender, count(o.transaction_id) total_orders, coalesce(sum(o.quantity),0) total_quantity, round(coalesce(sum(o.total_amount),0),2) lifetime_value, round(coalesce(avg(o.total_amount),0),2) average_order_value, min(o.transaction_date) first_purchase_date, max(o.transaction_date) last_purchase_date FROM customer c LEFT JOIN orders o USING(customer_id) GROUP BY c.customer_id`,
  customer_segmentation: `SELECT *, CASE WHEN lifetime_value >= 3000 THEN 'VIP' WHEN lifetime_value >= 1500 THEN 'Gold' WHEN lifetime_value >= 500 THEN 'Silver' ELSE 'Bronze' END customer_segment FROM customer_summary`,
  product_performance: `SELECT p.product_id, p.name product_name, p.category, p.price, p.stock_quantity, p.rating, count(o.transaction_id) total_orders, coalesce(sum(o.quantity),0) total_units_sold, round(coalesce(sum(o.total_amount),0),2) total_revenue, round(coalesce(avg(o.total_amount),0),2) average_order_value FROM product p LEFT JOIN orders o USING(product_id) GROUP BY p.product_id`,
  top_customers: `SELECT *, dense_rank() OVER (ORDER BY lifetime_value DESC) customer_rank FROM customer_summary`,
  executive_dashboard: `SELECT count(DISTINCT transaction_id) total_orders, count(DISTINCT customer_id) total_customers, count(DISTINCT product_id) total_products, sum(quantity) total_units_sold, round(sum(total_amount),2) total_revenue, round(avg(total_amount),2) average_order_value, round(sum(total_amount)/nullif(count(DISTINCT customer_id),0),2) average_customer_spend, round(1.0*sum(quantity)/nullif(count(*),0),2) average_units_per_order FROM orders`,
  incremental_sales: "SELECT * FROM orders",
  customer_features: `WITH eligible AS (SELECT * FROM orders WHERE transaction_date < (SELECT value FROM metadata WHERE key='as_of_date'))
    SELECT sha256('local-demo-only:'||c.customer_id) customer_key, (SELECT value FROM metadata WHERE key='as_of_date') feature_as_of_date,
    count(o.transaction_id) order_count, coalesce(sum(o.total_amount),0) lifetime_value,
    round(coalesce(avg(o.total_amount),0),2) average_order_value,
    CAST(julianday((SELECT value FROM metadata WHERE key='as_of_date'))-julianday(max(o.transaction_date)) AS INTEGER) recency_days,
    sum(CASE WHEN o.transaction_date >= date((SELECT value FROM metadata WHERE key='as_of_date'),'-30 days') THEN 1 ELSE 0 END) orders_30d,
    round(sum(CASE WHEN o.transaction_date >= date((SELECT value FROM metadata WHERE key='as_of_date'),'-30 days') THEN o.total_amount ELSE 0 END),2) revenue_30d,
    sum(CASE WHEN o.transaction_date >= date((SELECT value FROM metadata WHERE key='as_of_date'),'-90 days') THEN 1 ELSE 0 END) orders_90d,
    round(sum(CASE WHEN o.transaction_date >= date((SELECT value FROM metadata WHERE key='as_of_date'),'-90 days') THEN o.total_amount ELSE 0 END),2) revenue_90d,
    count(DISTINCT o.product_id) unique_products, max(o.transaction_date) last_purchase_date
    FROM customer c LEFT JOIN eligible o USING(customer_id) GROUP BY c.customer_id`,
  product_knowledge: `SELECT sha256('product:'||product_id) document_id, product_id, name product_name, category,
    'Product: '||name||'. Category: '||category||'. Price: $'||printf('%.2f',price)||'. Rating: '||rating||'/5. Stock: '||stock_quantity||' units.' content,
    'product/'||product_id source_reference, (SELECT value FROM metadata WHERE key='as_of_date') updated_as_of FROM product`,
  daily_demand_features: `WITH RECURSIVE dates(day) AS (SELECT min(transaction_date) FROM orders UNION ALL SELECT date(day,'+1 day') FROM dates WHERE day < date((SELECT value FROM metadata WHERE key='as_of_date'),'-1 day')),
    daily AS (SELECT p.product_id, d.day demand_date, coalesce(sum(o.quantity),0) units_sold, round(coalesce(sum(o.total_amount),0),2) revenue FROM product p CROSS JOIN dates d LEFT JOIN orders o ON o.product_id=p.product_id AND o.transaction_date=d.day GROUP BY p.product_id,d.day)
    SELECT *, lag(units_sold,1) OVER (PARTITION BY product_id ORDER BY demand_date) units_lag_1d,
    lag(units_sold,7) OVER (PARTITION BY product_id ORDER BY demand_date) units_lag_7d,
    round(avg(units_sold) OVER (PARTITION BY product_id ORDER BY demand_date ROWS BETWEEN 7 PRECEDING AND 1 PRECEDING),2) avg_units_previous_7d FROM daily`,
};

export function createPipeline(databasePath = ":memory:") {
  if (databasePath !== ":memory:")
    mkdirSync(dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
  db.function("sha256", (value) =>
    createHash("sha256").update(String(value)).digest("hex"),
  );
  db.exec(`CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT);
    CREATE TABLE IF NOT EXISTS pipeline_runs(id TEXT PRIMARY KEY, started_at TEXT, finished_at TEXT, status TEXT, duration_ms REAL, models INTEGER, tests INTEGER, failed INTEGER, details TEXT);
    CREATE TABLE IF NOT EXISTS raw_customer(customer_id INTEGER PRIMARY KEY,customer_type TEXT,email TEXT,age INTEGER,gender TEXT,total_purchases INTEGER,loaded_at TEXT);
    CREATE TABLE IF NOT EXISTS raw_product(product_id INTEGER PRIMARY KEY,name TEXT,category TEXT,price REAL,stock_quantity INTEGER,rating REAL,loaded_at TEXT);
    CREATE TABLE IF NOT EXISTS raw_orders(transaction_id INTEGER PRIMARY KEY,customer_id INTEGER,product_id INTEGER,quantity INTEGER,total_amount REAL,transaction_date TEXT,loaded_at TEXT);`);
  if (!db.prepare("SELECT 1 FROM raw_orders LIMIT 1").get()) seed(db);
  const pipeline = {
    db,
    busy: false,
    catalog: readCatalog(),
    checks: [],
    lastError: null,
  };
  build(pipeline);
  return pipeline;
}

function seed(db) {
  let state = 73829;
  const random = () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const now = new Date();
  const anchor = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const loaded = new Date().toISOString();
  const products = [
    ["Studio headphones", "Electronics", 129],
    ["Wireless keyboard", "Electronics", 79],
    ["Portable speaker", "Electronics", 89],
    ["Smart desk lamp", "Electronics", 59],
    ["USB-C hub", "Electronics", 49],
    ["Fitness watch", "Electronics", 179],
    ["Everyday backpack", "Accessories", 68],
    ["Canvas tote", "Accessories", 29],
    ["Leather cardholder", "Accessories", 45],
    ["Travel organizer", "Accessories", 39],
    ["Classic sunglasses", "Accessories", 75],
    ["Linen shirt", "Clothing", 64],
    ["Essential tee", "Clothing", 28],
    ["Relaxed hoodie", "Clothing", 85],
    ["Merino sweater", "Clothing", 110],
    ["Everyday trousers", "Clothing", 78],
    ["Ceramic coffee set", "Home & living", 42],
    ["Woven throw", "Home & living", 65],
    ["Scented candle", "Home & living", 32],
    ["Oak desk shelf", "Home & living", 95],
    ["Linen cushion", "Home & living", 38],
    ["Trail running shoes", "Sports & outdoors", 125],
    ["Yoga mat", "Sports & outdoors", 48],
    ["Insulated bottle", "Sports & outdoors", 35],
    ["Resistance bands", "Sports & outdoors", 25],
    ["Hiking daypack", "Sports & outdoors", 98],
    ["Daily moisturizer", "Beauty & care", 34],
    ["Botanical cleanser", "Beauty & care", 26],
    ["Mineral sunscreen", "Beauty & care", 29],
    ["Hand care set", "Beauty & care", 22],
  ];
  db.exec("BEGIN");
  try {
    const customer = db.prepare(
      "INSERT INTO raw_customer VALUES(?,?,?,?,?,?,?)",
    );
    for (let i = 1; i <= 1200; i++)
      customer.run(
        i,
        i % 7 === 0 ? "Premium" : "Standard",
        `customer${i}@example.test`,
        18 + Math.floor(random() * 56),
        ["Female", "Male", "Unspecified"][i % 3],
        0,
        loaded,
      );
    const product = db.prepare("INSERT INTO raw_product VALUES(?,?,?,?,?,?,?)");
    products.forEach((p, i) =>
      product.run(
        i + 1,
        ...p,
        Math.floor(50 + random() * 450),
        round(3.8 + random() * 1.2),
        loaded,
      ),
    );
    const order = db.prepare("INSERT INTO raw_orders VALUES(?,?,?,?,?,?,?)");
    let id = 1;
    for (let d = 180; d >= 1; d--) {
      const orders = Math.floor(
        80 + (180 - d) * 0.38 + random() * 55 + (d % 7 === 0 ? 35 : 0),
      );
      for (let j = 0; j < orders; j++) {
        const p = Math.min(
          products.length - 1,
          Math.floor(Math.pow(random(), 1.2) * products.length),
        );
        const quantity = 1 + Math.floor(random() * 3);
        order.run(
          id++,
          1 + Math.floor(Math.pow(random(), 1.3) * 1200),
          p + 1,
          quantity,
          round(products[p][2] * quantity * (random() < 0.12 ? 0.9 : 1)),
          date(anchor - d * DAY),
          loaded,
        );
      }
    }
    db.prepare("INSERT OR REPLACE INTO metadata VALUES(?,?)").run(
      "as_of_date",
      date(anchor),
    );
    db.prepare("INSERT OR REPLACE INTO metadata VALUES(?,?)").run(
      "seeded_at",
      loaded,
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function validate(pipeline) {
  const { db } = pipeline;
  const checks = [];
  const check = (name, model, sql) => {
    const failures = Number(db.prepare(sql).get().failures);
    checks.push({ name, model, status: failures ? "fail" : "pass", failures });
  };
  for (const [model, key] of [
    ["customer", "customer_id"],
    ["product", "product_id"],
    ["orders", "transaction_id"],
    ["customer_features", "customer_key"],
    ["product_knowledge", "document_id"],
  ]) {
    check(
      `${key} is not null`,
      model,
      `SELECT count(*) failures FROM ${model} WHERE ${key} IS NULL`,
    );
    check(
      `${key} is unique`,
      model,
      `SELECT count(*) failures FROM (SELECT ${key} FROM ${model} GROUP BY ${key} HAVING count(*)>1)`,
    );
  }
  check(
    "Every order has a customer",
    "orders",
    "SELECT count(*) failures FROM orders o LEFT JOIN customer c USING(customer_id) WHERE c.customer_id IS NULL",
  );
  check(
    "Every order has a product",
    "orders",
    "SELECT count(*) failures FROM orders o LEFT JOIN product p USING(product_id) WHERE p.product_id IS NULL",
  );
  check(
    "Revenue is positive",
    "orders",
    "SELECT count(*) failures FROM orders WHERE total_amount IS NULL OR total_amount<=0",
  );
  check(
    "Quantity is a positive integer",
    "orders",
    "SELECT count(*) failures FROM orders WHERE quantity IS NULL OR quantity<=0 OR quantity!=CAST(quantity AS INTEGER)",
  );
  check(
    "Transaction dates are valid",
    "orders",
    "SELECT count(*) failures FROM orders WHERE date(transaction_date) IS NULL",
  );
  check(
    "Daily revenue reconciles",
    "daily_sales",
    "SELECT CASE WHEN abs((SELECT sum(total_revenue) FROM daily_sales)-(SELECT sum(total_amount) FROM orders))>0.01 THEN 1 ELSE 0 END failures",
  );
  check(
    "Category revenue reconciles",
    "category_sales",
    "SELECT CASE WHEN abs((SELECT sum(total_revenue) FROM category_sales)-(SELECT sum(total_amount) FROM orders))>0.01 THEN 1 ELSE 0 END failures",
  );
  check(
    "Feature dates exclude future purchases",
    "customer_features",
    "SELECT count(*) failures FROM customer_features WHERE last_purchase_date>=feature_as_of_date",
  );
  check(
    "Feature windows are consistent",
    "customer_features",
    "SELECT count(*) failures FROM customer_features WHERE orders_30d>orders_90d OR orders_90d>order_count OR revenue_30d>revenue_90d+0.01",
  );
  check(
    "Customer keys are pseudonymized",
    "customer_features",
    "SELECT count(*) failures FROM customer_features WHERE length(customer_key)!=64",
  );
  check(
    "Knowledge documents are populated",
    "product_knowledge",
    "SELECT count(*) failures FROM product_knowledge WHERE content IS NULL OR length(content)<20 OR source_reference IS NULL",
  );
  check(
    "Product documents exclude email addresses",
    "product_knowledge",
    "SELECT count(*) failures FROM product_knowledge WHERE content LIKE '%@%'",
  );
  check(
    "Demand keys are unique",
    "daily_demand_features",
    "SELECT count(*) failures FROM (SELECT product_id,demand_date FROM daily_demand_features GROUP BY 1,2 HAVING count(*)>1)",
  );
  check(
    "Demand history has no missing days",
    "daily_demand_features",
    `SELECT count(*) failures FROM (SELECT product_id,count(*) n,CAST(julianday(max(demand_date))-julianday(min(demand_date))+1 AS INTEGER) expected FROM daily_demand_features GROUP BY product_id) WHERE n!=expected`,
  );
  check(
    "Ingestion timestamps exist",
    "stg_orders",
    "SELECT count(*) failures FROM stg_orders WHERE loaded_at IS NULL",
  );
  check(
    "Demand lag uses the previous day",
    "daily_demand_features",
    `SELECT count(*) failures FROM daily_demand_features d JOIN daily_demand_features p ON d.product_id=p.product_id AND p.demand_date=date(d.demand_date,'-1 day') WHERE d.units_lag_1d IS NULL OR d.units_lag_1d!=p.units_sold`,
  );
  pipeline.checks = checks;
  return checks;
}

export function build(pipeline) {
  if (pipeline.busy) throw new Error("A pipeline run is already in progress.");
  const { db } = pipeline;
  pipeline.busy = true;
  const id = `run_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const start = performance.now();
  const started = new Date().toISOString();
  let built = 0;
  let details = [];
  try {
    db.exec("BEGIN");
    for (const [name, sql] of Object.entries(transforms)) {
      const modelStart = performance.now();
      const isView = [
        "stg_customer",
        "stg_product",
        "stg_orders",
        "customer",
        "product",
        "orders",
      ].includes(name);
      db.exec(
        `DROP ${isView ? "VIEW" : "TABLE"} IF EXISTS ${name}; CREATE ${isView ? "VIEW" : "TABLE"} ${name} AS ${sql}`,
      );
      details.push({
        name,
        status: "success",
        duration_ms: round(performance.now() - modelStart),
        rows: db.prepare(`SELECT count(*) count FROM ${name}`).get().count,
      });
      built++;
    }
    const checks = validate(pipeline);
    const failed = checks.filter((t) => t.status === "fail").length;
    if (failed) throw new Error(`${failed} data quality checks failed.`);
    db.prepare("INSERT INTO pipeline_runs VALUES(?,?,?,?,?,?,?,?,?)").run(
      id,
      started,
      new Date().toISOString(),
      "success",
      round(performance.now() - start),
      built,
      checks.length,
      0,
      JSON.stringify(details),
    );
    db.exec("COMMIT");
    pipeline.lastError = null;
  } catch (error) {
    db.exec("ROLLBACK");
    pipeline.lastError = error.message;
    db.prepare("INSERT INTO pipeline_runs VALUES(?,?,?,?,?,?,?,?,?)").run(
      id,
      started,
      new Date().toISOString(),
      "failed",
      round(performance.now() - start),
      built,
      pipeline.checks.length,
      pipeline.checks.filter((t) => t.status === "fail").length,
      JSON.stringify({ error: error.message, models: details }),
    );
    throw error;
  } finally {
    pipeline.busy = false;
  }
  return id;
}

export function catalog(pipeline) {
  return pipeline.catalog.map((model) => {
    const sample =
      pipeline.db.prepare(`SELECT * FROM "${model.name}" LIMIT 1`).get() || {};
    const columns = pipeline.db
      .prepare(`PRAGMA table_info("${model.name}")`)
      .all()
      .map((c) => ({
        name: c.name,
        type:
          c.type ||
          (typeof sample[c.name] === "string"
            ? "TEXT"
            : typeof sample[c.name] === "number"
              ? Number.isInteger(sample[c.name])
                ? "INTEGER"
                : "REAL"
              : "DYNAMIC"),
      }));
    const checks = pipeline.checks.filter((t) => t.model === model.name);
    return {
      ...model,
      columns,
      rows: pipeline.db
        .prepare(`SELECT count(*) count FROM "${model.name}"`)
        .get().count,
      tests: checks.length,
      status: checks.some((t) => t.status === "fail") ? "fail" : "healthy",
      owner: model.layer === "ai" ? "AI Engineering" : "Data Engineering",
    };
  });
}

export function overview(pipeline, days = 30) {
  const { db } = pipeline;
  const asOf = db
    .prepare("SELECT value FROM metadata WHERE key='as_of_date'")
    .get().value;
  const end = Date.parse(`${asOf}T00:00:00Z`);
  const start = date(end - days * DAY),
    previous = date(end - days * 2 * DAY);
  const metrics = (from, to) =>
    db
      .prepare(
        "SELECT count(*) orders,round(coalesce(sum(total_amount),0),2) revenue,count(DISTINCT customer_id) customers,round(coalesce(avg(total_amount),0),2) aov FROM incremental_sales WHERE transaction_date>=? AND transaction_date<?",
      )
      .get(from, to);
  const current = metrics(start, asOf),
    prior = metrics(previous, start);
  const changes = Object.fromEntries(
    Object.keys(current).map((k) => [
      k,
      prior[k] ? round(((current[k] - prior[k]) / prior[k]) * 100) : null,
    ]),
  );
  const trend = db
    .prepare(
      "SELECT * FROM daily_sales WHERE transaction_date>=? AND transaction_date<? ORDER BY transaction_date",
    )
    .all(start, asOf);
  const categories = db
    .prepare(
      "SELECT p.category,round(sum(o.total_amount),2) revenue,count(*) orders FROM incremental_sales o JOIN product p USING(product_id) WHERE transaction_date>=? AND transaction_date<? GROUP BY p.category ORDER BY revenue DESC",
    )
    .all(start, asOf);
  const runs = db
    .prepare("SELECT * FROM pipeline_runs ORDER BY started_at DESC LIMIT 30")
    .all()
    .map((r) => ({ ...r, details: JSON.parse(r.details) }));
  const checks = pipeline.checks;
  const testsPassed = checks.filter((c) => c.status === "pass").length;
  const aiChecks = checks.filter((c) =>
    [
      "customer_features",
      "product_knowledge",
      "daily_demand_features",
    ].includes(c.model),
  );
  const aiPassed = aiChecks.filter((c) => c.status === "pass").length;
  return {
    project: PROJECT_NAME,
    mode: "demo",
    engine: "SQLite",
    asOf,
    seededAt: db
      .prepare("SELECT value FROM metadata WHERE key='seeded_at'")
      .get().value,
    days,
    current,
    prior,
    changes,
    trend,
    categories,
    runs,
    checks,
    testsPassed,
    totalTests: checks.length,
    readiness: aiChecks.length
      ? Math.round((aiPassed / aiChecks.length) * 100)
      : 0,
    readinessChecks: aiChecks.length,
    totalRows: db.prepare("SELECT count(*) count FROM raw_orders").get().count,
    featureRows: db
      .prepare("SELECT count(*) count FROM customer_features")
      .get().count,
    documentRows: db
      .prepare("SELECT count(*) count FROM product_knowledge")
      .get().count,
    demandRows: db
      .prepare("SELECT count(*) count FROM daily_demand_features")
      .get().count,
    busy: pipeline.busy,
    models: catalog(pipeline),
    lastError: pipeline.lastError,
  };
}

export function preview(pipeline, name, limit = 12) {
  const model = pipeline.catalog.find((m) => m.name === name);
  if (!model) throw new Error("Model not found.");
  // Direct identifiers stay out of the browser and downloads, including derived models.
  const allColumns = pipeline.db
    .prepare(`PRAGMA table_info("${name}")`)
    .all()
    .map((c) => c.name);
  const columns = allColumns.filter(
    (c) => !["email", "age", "gender", "customer_id"].includes(c),
  );
  return {
    name,
    columns,
    rows: pipeline.db
      .prepare(
        `SELECT ${columns.map((c) => `"${c}"`).join(",")} FROM "${name}" LIMIT ?`,
      )
      .all(limit),
    redacted: allColumns.length - columns.length,
  };
}

export function insight(pipeline, question, days = 30) {
  const data = overview(pipeline, days);
  const money = (n) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(n);
  const text = question.toLowerCase();
  if (/forecast|predict|churn|train|model accuracy/.test(text))
    return {
      answer:
        "This workspace prepares features for training, but it does not contain a trained predictive model. Use daily_demand_features for a time-based demand backtest, or customer_features for a separately labeled customer model. A prediction would require training and evaluating that model first.",
      sources: ["daily_demand_features", "customer_features"],
      kind: "Model guidance",
    };
  if (/ready|readiness|quality|test|pii|feature/.test(text))
    return {
      answer: `${data.testsPassed} of ${data.totalTests} local data checks pass. ${data.featureRows.toLocaleString()} customer feature rows use pseudonymous keys and only purchases before ${data.asOf}. ${data.documentRows} product documents contain no direct customer identifiers. ${data.demandRows.toLocaleString()} demand rows include zero-sale days and lagged quantities. This is local dataset readiness; Snowflake execution, access controls, and model evaluation still need verification.`,
      sources: [
        "customer_features",
        "product_knowledge",
        "daily_demand_features",
      ],
      kind: "Readiness assessment",
    };
  if (/customer|segment|retention/.test(text)) {
    const segments = pipeline.db
      .prepare(
        "SELECT customer_segment,count(*) customers,round(sum(lifetime_value),2) revenue FROM customer_segmentation GROUP BY customer_segment ORDER BY revenue DESC",
      )
      .all();
    return {
      answer: `Across all available history, ${segments.map((s) => `${s.customer_segment}: ${s.customers.toLocaleString()} customers and ${money(s.revenue)} in revenue`).join("; ")}. These segments use observed lifetime spend, not a prediction of future customer value.`,
      sources: ["customer_segmentation", "customer_summary"],
      kind: "Customer analysis",
    };
  }
  if (/product|sell|best/.test(text)) {
    const rows = pipeline.db
      .prepare(
        "SELECT p.name,round(sum(o.total_amount),2) revenue FROM incremental_sales o JOIN product p USING(product_id) WHERE transaction_date>=date(?,?) AND transaction_date<? GROUP BY p.product_id ORDER BY revenue DESC LIMIT 3",
      )
      .all(data.asOf, `-${days} days`, data.asOf);
    return {
      answer: `The top products by revenue over the last ${days} days are ${rows.map((p, i) => `${i + 1}. ${p.name} (${money(p.revenue)})`).join(", ")}. Rankings are based on completed transactions in this sample dataset.`,
      sources: ["orders", "product"],
      kind: "Product analysis",
    };
  }
  if (/revenue|sale|category|perform|trend|order|business/.test(text)) {
    const top = data.categories[0];
    return {
      answer: `Revenue is ${money(data.current.revenue)} across ${data.current.orders.toLocaleString()} orders in the ${days} days before ${data.asOf}. That is ${Math.abs(data.changes.revenue ?? 0).toFixed(1)}% ${(data.changes.revenue ?? 0) >= 0 ? "above" : "below"} the preceding period. ${top.category} leads at ${money(top.revenue)} (${round((top.revenue / data.current.revenue) * 100)}% of revenue). Average order value is ${money(data.current.aov)}.`,
      sources: ["daily_sales", "category_sales", "orders"],
      kind: "Revenue analysis",
    };
  }
  return {
    answer:
      "I can answer grounded questions about revenue trends, top products, customer segments, and data readiness. Try “Which category leads revenue?” or “Is the data ready for AI?” This local insights engine uses predefined analytical queries and does not call a language model.",
    sources: [],
    kind: "Local insights guide",
  };
}
