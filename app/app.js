const shapes = {
  overview:
    '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  pipeline:
    '<rect x="3" y="3" width="6" height="6" rx="1.5"/><rect x="15" y="15" width="6" height="6" rx="1.5"/><path d="M6 9v6a3 3 0 0 0 3 3h6M12 6h6v4"/>',
  catalog:
    '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7"/>',
  analytics: '<path d="M4 3v17h17M8 15v-4M13 15V7M18 15v-6"/>',
  ai: '<path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4L12 3Z"/><path d="m20 2 .8 2.2L23 5l-2.2.8L20 8l-.8-2.2L17 5l2.2-.8Z"/>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  settings:
    '<path d="m9 3-.6 3-2.5 1.4-3 .9 1.2 3v2.9l-1.2 3 3 .8L8.4 19l.6 3h6l.6-3 2.5-1.4 3-.8-1.2-3v-2.9l1.2-3-3-.9L15.6 6 15 3H9Z"/><circle cx="12" cy="12.5" r="3"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  arrow: '<path d="M4 12h16m-5-5 5 5-5 5"/>',
  download: '<path d="M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4"/>',
  play: '<path d="m8 4 13 8-13 8V4Z"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  shield:
    '<path d="M12 3 4 6v6c0 4 8 9 8 9s8-5 8-9V6l-8-3Z"/><path d="m8 12 3 3 5-6"/>',
  money:
    '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 9h.01M18 15h.01"/>',
  orders:
    '<path d="m3 7 9-4 9 4v11l-9 4-9-4V7Z"/><path d="m3 7 9 4 9-4M12 11v11M8 5l9 4"/>',
  users:
    '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M17 5a3 3 0 0 1 0 6M18 15c2 0 3 2 3 4v2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6l4 2"/>',
  code: '<path d="m8 6-6 6 6 6m8-12 6 6-6 6M14 3l-4 18"/>',
  layers: '<path d="m12 3 10 5-10 5L2 8l10-5ZM2 12l10 5 10-5M2 16l10 5 10-5"/>',
  table:
    '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 10v10M15 10v10"/>',
  document: '<path d="M14 2H5v20h14V7l-5-5ZM14 2v6h5M8 12h8M8 16h8"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
  refresh:
    '<path d="M20 7V3l-4 4M4 17v4l4-4M20 7a8 8 0 0 0-14-2M4 17a8 8 0 0 0 14 2"/>',
};
const icon = (name, size = 18) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shapes[name] || shapes.table}</svg>`;
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const number = (n) => new Intl.NumberFormat("en-US").format(n ?? 0);
const money = (n, compact = false) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: compact ? 1 : 0,
    ...(compact ? { notation: "compact" } : {}),
  }).format(n ?? 0);
const humanDate = (v) =>
  new Date(v).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
const humanTime = (v) =>
  new Date(v).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
const duration = (ms) =>
  ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`;
const labels = {
  overview: "Overview",
  pipeline: "Pipeline",
  catalog: "Data catalog",
  analytics: "Analytics",
  ai: "AI workspace",
  activity: "Activity & runs",
  settings: "Settings",
};
let identity,
  data,
  days = 30,
  page = "overview",
  catalogFilter = "all",
  catalogSearch = "",
  pipelineTab = "lineage",
  running = false,
  chat = [],
  settingsData,
  modalOpener;
const main = document.querySelector("#main"),
  modal = document.querySelector("#modal");
function setDrawer(open) {
  const side = document.querySelector("#sidebar"),
    mobile = matchMedia("(max-width:700px)").matches;
  side.classList.toggle("open", open && mobile);
  side.inert = mobile && !open;
  document
    .querySelector("#menu-toggle")
    .setAttribute("aria-expanded", String(open && mobile));
}
setDrawer(false);
matchMedia("(max-width:700px)").addEventListener("change", () =>
  setDrawer(false),
);
window.addEventListener("resize", () => {
  if (data)
    document
      .querySelectorAll(".chart-container")
      .forEach((el) => (el.innerHTML = chart()));
});
async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(identity?.csrf ? { "X-CSRF-Token": identity.csrf } : {}),
      ...options.headers,
    },
  });
  const result = await res.json();
  if (res.status === 401 && result.code === "AUTHENTICATION_REQUIRED") {
    location.assign("/auth/login");
    throw new Error("Your session expired. Sign in again.");
  }
  if (!res.ok)
    throw new Error(
      (result.error || "Request failed.") +
        (result.requestId ? " Reference: " + result.requestId : ""),
    );
  return result;
}
function toast(message, error = false) {
  const el = document.createElement("div");
  el.className = `toast${error ? " error" : ""}`;
  el.textContent = message;
  document.querySelector("#toasts").append(el);
  setTimeout(() => el.remove(), 5500);
}
function navigation() {
  document.querySelector("#navigation").innerHTML = Object.entries(labels)
    .map(
      ([key, label], i) =>
        `${i === 6 ? '<div class="nav-divider"></div>' : ""}<a href="#${key}" class="nav-item ${page === key ? "active" : ""}" ${page === key ? 'aria-current="page"' : ""}>${icon(key)}<span>${label}</span>${key === "ai" ? '<span class="nav-tag">LAB</span>' : ""}</a>`,
    )
    .join("");
  document.querySelector("#breadcrumb").textContent = labels[page];
  document.querySelector("#crumb-icon").innerHTML = icon(page, 14);
  document.title = `${labels[page]} · ${data?.project || "Snowflake + dbt Analytics and AI-Ready Data Pipeline"}`;
}
function dateSelect() {
  return `<label><span class="sr-only">Reporting period</span><select class="select period-select">${[7, 30, 90].map((n) => `<option value="${n}" ${days === n ? "selected" : ""}>Last ${n} days</option>`).join("")}</select></label>`;
}
function runButton() {
  const unavailable =
    data?.mode === "snowflake" && data.workerAvailable === false;
  const enabled = identity?.canRun && !unavailable;
  return `<button class="button primary" data-action="run" ${running || !enabled ? "disabled" : ""}>${icon(running ? "refresh" : "play")}<span>${running ? "Running pipeline…" : !identity?.canRun ? "View only" : unavailable ? "Worker unavailable" : "Run pipeline"}</span></button>`;
}
function heading(
  title,
  subtitle,
  eyebrow = "YOUR DATA, CONNECTED",
  actions = true,
) {
  return `<div class="page-heading"><div><div class="eyebrow"><span class="tiny-dot"></span>${eyebrow}</div><h1>${title}</h1><p class="page-subtitle">${subtitle}</p></div>${actions ? `<div class="page-actions"><button class="button secondary-action" data-action="export-overview" ${identity.role === "operator" && identity.exportsEnabled ? "" : "hidden"}>${icon("download")}Export report</button>${runButton()}</div>` : ""}</div>`;
}
function delta(n) {
  return n === null
    ? '<span class="change">No prior data</span>'
    : `<span class="change ${n < 0 ? "negative" : ""}">${n < 0 ? "↘" : "↗"} ${Math.abs(n).toFixed(1)}%</span>`;
}
function spark(values, id) {
  const max = Math.max(...values, 1),
    min = Math.min(...values);
  const pts = values
    .map(
      (n, i) =>
        `${(i / (values.length - 1 || 1)) * 80},${28 - ((n - min) / (max - min || 1)) * 22}`,
    )
    .join(" ");
  return `<svg class="spark" viewBox="0 0 80 34" aria-hidden="true"><defs><linearGradient id="spark${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#ff8a3d" stop-opacity=".3"/><stop offset="100%" stop-color="#ff8a3d" stop-opacity="0"/></linearGradient></defs><polygon points="0,34 ${pts} 80,34" fill="url(#spark${id})"/><polyline points="${pts}" fill="none" stroke="#ff9f60" stroke-width="1.5"/></svg>`;
}
function metrics() {
  const list = [
    [
      "money",
      "Total revenue",
      money(data.current.revenue),
      data.changes.revenue,
      data.trend.map((t) => t.total_revenue),
    ],
    [
      "orders",
      "Orders processed",
      number(data.current.orders),
      data.changes.orders,
      data.trend.map((t) => t.total_orders),
    ],
    [
      "users",
      "Active customers",
      number(data.current.customers),
      data.changes.customers,
      data.trend.map((t) => t.unique_customers),
    ],
    [
      "shield",
      "Data quality",
      `${Math.round((data.testsPassed / data.totalTests) * 100)}<span style="font-size:17px;color:#a4a5b0">%</span>`,
      undefined,
      [],
    ],
  ];
  return `<div class="metrics-grid">${list.map(([ico, title, value, change, values], i) => `<div class="metric-card"><div class="metric-top">${icon(ico)}<span>${title}</span><span class="metric-info" title="Computed from the active dataset">ⓘ</span></div><div class="metric-value">${value}</div><div class="metric-bottom">${i === 3 ? `<span class="change">${icon("check", 9)} Checks ${data.testsPassed === data.totalTests ? "passed" : "evaluated"}</span><span>${data.testsPassed}/${data.totalTests} tests</span>` : `${delta(change)}<span>vs. previous ${days} days</span>`}</div>${values.length ? spark(values, i) : icon("shield", 35).replace("<svg ", '<svg class="spark" ')}</div>`).join("")}</div>`;
}
function chart() {
  if (!data.trend.length)
    return '<div class="empty-state">No transactions in this reporting period.</div>';
  const rows = data.trend,
    w = Math.max(300, Math.min(650, innerWidth - 70)),
    h = 200,
    left = 43,
    right = 10,
    top = 9,
    bottom = 30,
    max =
      Math.ceil(Math.max(...rows.map((r) => r.total_revenue), 1) / 5000) * 5000,
    cw = w - left - right,
    ch = h - top - bottom;
  const pts = rows.map((r, i) => [
    left + (i / (rows.length - 1 || 1)) * cw,
    top + (1 - r.total_revenue / max) * ch,
  ]);
  const line = pts
    .map((p, i) => `${i ? "L" : "M"} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`)
    .join(" ");
  return `<svg class="revenue-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Daily revenue over the last ${days} days. Total ${esc(money(data.current.revenue))}."><defs><linearGradient id="revenueFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#ff8a3d" stop-opacity=".5"/><stop offset="100%" stop-color="#ff8a3d" stop-opacity=".08"/></linearGradient></defs>${Array.from(
    { length: 5 },
    (_, i) => (max * i) / 4,
  )
    .map((t) => {
      const y = top + (1 - t / max) * ch;
      return `<line class="chart-grid" x1="${left}" y1="${y}" x2="${w - right}" y2="${y}"/><text class="chart-label" x="${left - 10}" y="${y + 3}" text-anchor="end">${t === 0 ? "$0" : `$${t / 1000}k`}</text>`;
    })
    .join(
      "",
    )}<path d="${line} L ${w - right} ${h - bottom} L ${left} ${h - bottom} Z" fill="url(#revenueFill)"/><path d="${line}" fill="none" stroke="#ff944d" stroke-width="2" stroke-linejoin="round"/>${pts.map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="5" fill="transparent"><title>${humanDate(rows[i].transaction_date)}: ${money(rows[i].total_revenue)} · ${number(rows[i].total_orders)} orders</title></circle>`).join("")}${[
    0, 0.2, 0.4, 0.6, 0.8, 1,
  ]
    .map((f) => {
      const i = Math.round(f * (rows.length - 1));
      return rows[i]
        ? `<text class="chart-label" x="${left + f * cw}" y="${h - 7}" text-anchor="middle">${humanDate(rows[i].transaction_date)}</text>`
        : "";
    })
    .join("")}</svg>`;
}
function revenueCard(extra = "") {
  return `<section class="card"><div class="card-header"><div><h2>Revenue overview</h2><p class="card-subtitle">A clearer picture of your business performance</p></div><div class="card-tools"><span class="legend"><i></i>Revenue</span>${dateSelect()}</div></div><div class="chart-container ${extra}">${chart()}</div><div class="chart-foot"><span><i class="chart-dot"></i>Total revenue<strong>${money(data.current.revenue)}</strong></span><span>Avg. order value<strong>${money(data.current.aov)}</strong></span><span>Currency<strong>USD</strong></span></div></section>`;
}
function readiness() {
  return `<section class="card readiness-card"><div class="card-header"><h2>${icon("ai", 15)} &nbsp; AI readiness</h2><span class="badge ${data.readiness === 100 ? "green" : "amber"}">${icon(data.readiness === 100 ? "check" : "info", 9)}${data.readiness === 100 ? "Checks passed" : "Review checks"}</span></div><div class="score-wrap"><div class="score-ring"><svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="43" fill="none" stroke="#30313a" stroke-width="6"/><circle cx="50" cy="50" r="43" fill="none" stroke="#ff944d" stroke-width="6" stroke-linecap="round" stroke-dasharray="${(data.readiness / 100) * 270.18} 270.18"/></svg><div class="score-number">${data.readiness}<span>%</span></div></div><div class="score-text"><h3>${data.readiness === 100 ? "Dataset checks passed." : "Some checks need attention."}</h3><p>${data.readinessChecks} checks across feature and knowledge datasets.</p></div></div><div class="check-list"><div class="check-line"><span>${icon("check")}Pseudonymous customer features</span><span class="value">${number(data.featureRows)}</span></div><div class="check-line"><span>${icon("check")}Product knowledge documents</span><span class="value">${data.documentRows}</span></div><div class="check-line"><span>${icon("check")}Demand history & lag features</span><span class="value">${number(data.demandRows)}</span></div></div><div class="readiness-footer"><span>Dataset checks · No trained model</span><a href="#ai" class="text-link">Explore AI workspace ${icon("arrow")}</a></div></section>`;
}
function stages() {
  const list = [
    ["bronze", "catalog", "Bronze", "Sources", 3, data.totalRows + 1230],
    ["silver", "layers", "Silver", "Clean & refine", 3, data.totalRows],
    ["gold", "analytics", "Gold", "Analytics", 9, data.totalRows],
    [
      "ai",
      "ai",
      "AI-ready",
      "Feature & knowledge",
      3,
      data.featureRows + data.documentRows + data.demandRows,
    ],
  ];
  return `<div class="pipeline-visual">${list.map(([cls, ico, title, sub, count, rows], i) => `${i ? `<span class="flow-arrow">${icon("arrow")}</span>` : ""}<button class="stage ${cls}" data-action="stage" data-layer="${cls}"><span class="stage-top"><span class="stage-icon">${icon(ico)}</span><span class="stage-healthy">✓</span></span><span class="stage-title">${title}<small>· ${count} ${cls === "bronze" ? "sources" : "models"}</small></span><span class="stage-bottom"><span>${sub}</span><span>${cls === "ai" ? number(rows) + " rows" : "Healthy"}</span></span></button>`).join("")}</div>`;
}
function pipelineCard() {
  return `<section class="card pipeline-card"><div class="card-header"><div><h2>One pipeline. Endless possibilities.</h2><p class="card-subtitle">From raw data to reliable analytics and AI-ready datasets</p></div><a class="text-link" href="#pipeline">View pipeline ${icon("arrow")}</a></div>${stages()}</section>`;
}
function categories(limit = 5) {
  const max = Math.max(...data.categories.map((c) => c.revenue), 1);
  return `<section class="card"><div class="card-header"><h2>Revenue by category</h2><span class="card-subtitle">Last ${days} days</span></div><div class="category-list">${data.categories
    .slice(0, limit)
    .map(
      (c) =>
        `<div class="category-row"><span>${esc(c.category)}</span><strong>${money(c.revenue, true)}</strong><div class="category-bar"><span style="width:${(c.revenue / max) * 100}%"></span></div></div>`,
    )
    .join(
      "",
    )}</div><div class="category-summary"><span>${data.categories.length} categories in your catalog</span><strong>By total revenue</strong></div></section>`;
}
function layerBadge(layer) {
  return `<span class="badge ${{ staging: "gray", silver: "blue", gold: "amber", ai: "purple" }[layer] || "gray"}">${layer === "ai" ? "AI-ready" : layer.charAt(0).toUpperCase() + layer.slice(1)}</span>`;
}
function modelsTable(models) {
  const details = Array.isArray(data.runs[0]?.details)
    ? data.runs[0].details
    : [];
  return `<div class="table-scroll"><table class="data-table"><thead><tr><th>MODEL NAME</th><th>LAYER</th><th>STATUS</th><th>ROWS</th><th>BUILD TIME</th></tr></thead><tbody>${models.map((m) => `<tr><td><button class="model-cell" data-action="model" data-name="${m.name}">${icon("table")}${m.name}</button></td><td>${layerBadge(m.layer)}</td><td><span class="badge ${m.status === "healthy" ? "green" : "red"}">${icon(m.status === "healthy" ? "check" : "info", 8)}${m.status === "healthy" ? "Healthy" : "Failed"}</span></td><td>${number(m.rows)}</td><td>${duration(details.find((r) => r.name === m.name)?.duration_ms || 0)}</td></tr>`).join("")}</tbody></table></div>`;
}
function dataSculpture() {
  const plate = (y, name, accent = false) => `<g class="data-plate ${name}">
    <path d="M280 ${y - 70} 422 ${y} 280 ${y + 70} 138 ${y}Z" fill="url(#${accent ? "plateAccent" : "plateSurface"})" stroke="${accent ? "#ff8d46" : "#59504b"}"/>
    <path d="M138 ${y} 280 ${y + 70}V${y + 85}L138 ${y + 15}Z" fill="${accent ? "#6e321b" : "#25252a"}" stroke="#68412c" stroke-width=".7"/>
    <path d="M280 ${y + 70} 422 ${y}V${y + 15}L280 ${y + 85}Z" fill="${accent ? "#3c2017" : "#131418"}" stroke="#493126" stroke-width=".7"/>
    <path d="M153 ${y} 280 ${y + 62} 407 ${y}" fill="none" stroke="${accent ? "#ffad70" : "#c27542"}" stroke-opacity=".8"/>
    <path d="M280 ${y - 54} 390 ${y} 280 ${y + 54} 170 ${y}Z" fill="none" stroke="#ff9c5b" stroke-opacity=".18"/>
    <path d="M280 ${y - 54}V${y + 54}M170 ${y}H390" stroke="#ff9c5b" stroke-opacity=".1"/>
  </g>`;
  return `<div class="hero-visual" aria-hidden="true"><div class="sculpture-halo"></div><svg class="data-sculpture" viewBox="0 0 560 350" fill="none">
    <defs>
      <linearGradient id="plateSurface" x1="138" y1="80" x2="422" y2="280" gradientUnits="userSpaceOnUse"><stop stop-color="#424048"/><stop offset=".55" stop-color="#25242a"/><stop offset="1" stop-color="#17191f"/></linearGradient>
      <linearGradient id="plateAccent" x1="160" y1="50" x2="400" y2="180" gradientUnits="userSpaceOnUse"><stop stop-color="#ffb36e"/><stop offset=".45" stop-color="#d2672e"/><stop offset="1" stop-color="#5e2f20"/></linearGradient>
      <linearGradient id="coreFace" x1="238" y1="40" x2="324" y2="116" gradientUnits="userSpaceOnUse"><stop stop-color="#ff9d53"/><stop offset="1" stop-color="#c74b18"/></linearGradient>
      <radialGradient id="floorLight"><stop stop-color="#ff721f" stop-opacity=".3"/><stop offset="1" stop-color="#ff721f" stop-opacity="0"/></radialGradient>
    </defs>
    <ellipse cx="280" cy="270" rx="190" ry="70" fill="url(#floorLight)"/>
    <g class="sculpture-floor" stroke="#68606b" stroke-opacity=".2"><path d="m62 236 218-106 218 106-218 106Z"/><path d="m98 254 218-106M134 272 352 166M170 290 388 184M206 308 424 202M242 326 460 220M98 218l218 106M134 200l218 106M170 182l218 106M206 164l218 106M242 146l218 106"/></g>
    <g class="sculpture-links" stroke="#f28343" stroke-opacity=".4" stroke-dasharray="3 6"><path d="M142 216H89q-20 0-20-20v-40M420 173h49q20 0 20-20V98M280 298v24"/></g>
    <g class="sculpture-stack">${plate(216, "plate-source")}${plate(170, "plate-refine")}${plate(124, "plate-intelligence", true)}
      <g class="data-core"><path d="m280 23 44 22-44 22-44-22Z" fill="#ffc38c" stroke="#ffcfaa"/><path d="m236 45 44 22v49l-44-23Z" fill="url(#coreFace)" stroke="#ffad6b"/><path d="m280 67 44-22v48l-44 23Z" fill="#a5411a" stroke="#ed7c38"/><path d="m247 62 22 11v24l-22-11Z" fill="#ffbf81" fill-opacity=".23"/><path d="m289 76 25-13M289 84l25-13M289 92l17-9" stroke="#ffb777" stroke-opacity=".6"/><path d="m263 45 17-8 17 8-17 8Z" fill="#fff1d2"/></g>
    </g>
    <g class="sculpture-nodes"><rect x="49" y="126" width="40" height="40" rx="11" fill="#242126" stroke="#9d5b36"/><path d="m69 136 10 5-10 5-10-5Zm-10 12 10 5 10-5m-20 7 10 5 10-5" stroke="#ffad70" stroke-width="1.3"/>
      <rect x="469" y="63" width="40" height="40" rx="11" fill="#322017" stroke="#c56d34"/><path d="m489 72 3 8 8 3-8 3-3 8-3-8-8-3 8-3Z" stroke="#ffb174" stroke-width="1.3"/>
      <circle cx="280" cy="322" r="4" fill="#ffa159"/><circle class="data-particle" cx="103" cy="216" r="3" fill="#ffa159"/><circle class="data-particle" cx="462" cy="173" r="3" fill="#ffa159"/>
    </g>
    <g class="sculpture-labels" fill="#b8a99e" font-size="9" font-family="Consolas,monospace" letter-spacing="1.5"><text x="28" y="188">INGEST</text><text x="455" y="124">AI-READY</text><text x="352" y="294" fill="#e0a16f">DATA IN MOTION</text></g>
  </svg><span class="visual-caption"><i></i> THE CONNECTED DATA CORE</span></div>`;
}
function overviewPage() {
  return `${heading('Snowflake + dbt <span class="greeting">✳</span>', "Analytics and AI-Ready Data Pipeline", "YOUR ANALYTICS & AI WORKSPACE")}<section class="command-hero"><div class="hero-copy"><div class="hero-eyebrow"><span></span> BUILT FOR WHAT COMES NEXT</div><h2>Raw data.<br><span>Real possibilities.</span></h2><p>One connected pipeline. Turn your Snowflake data into trusted analytics and a stronger foundation for AI.</p><div class="hero-actions"><a href="#pipeline" class="button primary">Explore the pipeline ${icon("arrow")}</a><a href="#ai" class="text-link">AI workspace ${icon("arrow")}</a></div><div class="hero-facts"><span><strong>${data.models.length}</strong> connected models</span><span><strong>03</strong> AI-ready datasets</span><span><strong>${data.testsPassed}/${data.totalTests}</strong> checks passed</span></div></div>${dataSculpture()}</section><div class="section-kicker"><span>Your workspace at a glance</span><span class="subtle">As of ${humanDate(data.asOf)} · ${data.models.length} models connected</span></div>${metrics()}<div class="dashboard-grid">${revenueCard()}${readiness()}</div>${pipelineCard()}<div class="bottom-grid"><section class="card table-card"><div class="card-header"><div><h2>Your data, ready to work</h2><p class="card-subtitle">A few of the models powering your workspace</p></div><a href="#catalog" class="text-link">View all models ${icon("arrow")}</a></div>${modelsTable(["customer_features", "daily_sales", "customer_summary", "product_performance"].map((n) => data.models.find((m) => m.name === n)).filter(Boolean))}</section>${categories()}</div>`;
}
function lineage() {
  return `<section class="card"><div class="card-header"><div><h2>Model lineage</h2><p class="card-subtitle">Select a model to inspect its upstream dependencies and SQL</p></div><span class="badge green">Read from dbt source</span></div><div class="lineage-board">${[
    ["staging", "Staging · 3"],
    ["silver", "Silver · 3"],
    ["gold", "Gold · 9"],
    ["ai", "AI-ready · 3"],
  ]
    .map(
      ([layer, label]) =>
        `<div class="lineage-column"><h3>${label}</h3>${data.models
          .filter((m) => m.layer === layer)
          .map(
            (m) =>
              `<button class="lineage-node" data-action="model" data-name="${m.name}"><strong>${m.name}</strong><span>${m.dependencies.length ? `← ${m.dependencies.join(", ")}` : m.sources.join(", ")}</span></button>`,
          )
          .join("")}</div>`,
    )
    .join(
      "",
    )}</div><div class="lineage-note">Dependencies are parsed from dbt ref() and source() calls. Local execution uses equivalent SQLite transformations.</div></section>`;
}
function quality() {
  return `<div class="health-summary"><div class="card health-item"><span>Checks passed</span><strong>${data.testsPassed}<span> / ${data.totalTests}</span></strong><small>Active dataset validation</small></div><div class="card health-item"><span>AI dataset checks</span><strong>${data.readiness}%</strong><small>${data.readinessChecks} readiness checks</small></div><div class="card health-item"><span>Failed checks</span><strong>${data.totalTests - data.testsPassed}</strong><small>Evaluated on transformed data</small></div></div><section class="card"><div class="card-header" style="padding-bottom:18px"><div><h2>Trust starts with a check.</h2><p class="card-subtitle">Integrity, reconciliation, privacy, and time-aware feature validation</p></div><span class="badge green">SQL assertions</span></div><div class="quality-list">${data.checks.map((c) => `<div class="quality-item"><div class="quality-name"><span>${esc(c.name)}</span><small>${c.model}</small></div><span class="badge ${c.status === "pass" ? "green" : "red"}">${icon(c.status === "pass" ? "check" : "info", 10)}${c.status === "pass" ? "Passed" : `${c.failures} failures`}</span></div>`).join("")}</div></section>`;
}
function pipelinePage() {
  return `${heading("From source to possibility.", "A transparent view of every layer, model, and quality check.", "PIPELINE OPERATIONS")}<div class="notice">${icon("info")}<span><strong>${data.mode === "snowflake" ? "Validated warehouse releases." : "Local demonstration."}</strong> ${data.mode === "snowflake" ? "New builds are published only after freshness and quality checks pass. The current release stays available during a build." : "Run the sample transformations and local quality checks. Production runs use the separate Snowflake worker."}</span></div>${pipelineCard()}<div class="toolbar"><div class="tabs">${[
    ["lineage", "Model lineage"],
    ["models", "All models"],
    ["quality", "Data quality"],
  ]
    .map(
      ([key, label]) =>
        `<button class="tab ${pipelineTab === key ? "active" : ""}" data-action="pipeline-tab" data-tab="${key}">${label}</button>`,
    )
    .join(
      "",
    )}</div><span class="catalog-result-count">Last build ${humanTime(data.runs[0].started_at)} · ${data.runs[0].finished_at ? duration(data.runs[0].duration_ms) : "In progress"}</span></div>${pipelineTab === "lineage" ? lineage() : pipelineTab === "quality" ? quality() : `<section class="card">${modelsTable(data.models)}</section>`}`;
}
function catalogCards() {
  const list = data.models.filter(
    (m) =>
      (catalogFilter === "all" || m.layer === catalogFilter) &&
      (m.name + " " + m.description)
        .toLowerCase()
        .includes(catalogSearch.toLowerCase()),
  );
  return `<div class="catalog-result-count">${list.length} ${list.length === 1 ? "model" : "models"} · Select a model to explore its data and SQL</div><div class="catalog-grid">${list.length ? list.map((m) => `<button class="card model-card" data-action="model" data-name="${m.name}"><span class="model-card-top"><span class="stage-icon">${icon(m.layer === "ai" ? "ai" : "table", 20)}</span>${layerBadge(m.layer)}</span><h3>${m.name}</h3><p>${esc(m.description)}</p><span class="model-card-meta"><span><strong>${number(m.rows)}</strong> rows</span><span>${m.columns.length} columns</span><span class="model-pulse" title="Healthy"></span></span></button>`).join("") : '<div class="card empty-state">No models match your search. Try a different name or layer.</div>'}</div>`;
}
function catalogPage() {
  return `${heading("Meet your data.", "Discover the models that connect raw information to real insight.", "DATA CATALOG")}<div class="toolbar"><div class="tabs" role="group" aria-label="Filter models by layer">${[
    ["all", "All models"],
    ["staging", "Staging"],
    ["silver", "Silver"],
    ["gold", "Gold"],
    ["ai", "AI-ready"],
  ]
    .map(
      ([key, label]) =>
        `<button class="tab ${catalogFilter === key ? "active" : ""}" data-action="filter" data-filter="${key}" aria-pressed="${catalogFilter === key}">${label}</button>`,
    )
    .join(
      "",
    )}</div><label><span class="sr-only">Search the data catalog</span><input class="search-input" id="catalog-search" placeholder="Search models..." value="${esc(catalogSearch)}"></label></div><div id="catalog-results">${catalogCards()}</div>`;
}
function analyticsPage() {
  const top = data.categories[0] || { category: "No category", revenue: 0 };
  return `${heading("See the story in your data.", "Explore revenue, customer activity, and what drives your business.", "BUSINESS ANALYTICS")}<div class="section-kicker"><span>${humanDate(data.trend[0]?.transaction_date || data.asOf)} – ${humanDate(data.trend.at(-1)?.transaction_date || data.asOf)}</span>${dateSelect()}</div>${metrics()}<div class="analytics-grid">${revenueCard("analytics-chart")}${categories(6)}</div><div class="two-column"><section class="card detail-block"><h2>${icon("analytics", 16)} &nbsp; What stands out</h2><p class="details-text">${esc(top.category)} contributes <strong>${(data.current.revenue ? (top.revenue / data.current.revenue) * 100 : 0).toFixed(1)}%</strong> of revenue. Average order value is <strong>${money(data.current.aov)}</strong>, with <strong>${number(data.current.customers)}</strong> active customers in this period.</p><a class="text-link" href="#ai">Ask more about your data ${icon("arrow")}</a></section><section class="card detail-block"><h2>${icon("table", 16)} &nbsp; Explore the source models</h2><p class="details-text">Every metric is computed from the local orders and product models. Inspect the rows and the equivalent Snowflake SQL.</p><div class="dependency-list">${["orders", "daily_sales", "category_sales", "customer_segmentation"].map((n) => `<button class="source-tag" data-action="model" data-name="${n}">${n}</button>`).join("")}</div></section></div>`;
}
function messages() {
  return chat
    .map((m) =>
      m.role === "user"
        ? `<div class="chat-question">${esc(m.text)}</div>`
        : `<div class="chat-answer"><div class="answer-label">${esc(m.kind || "Local analytical insight")}</div>${esc(m.text)}${m.sources?.length ? `<div class="source-tags">${m.sources.map((n) => `<button class="source-tag" data-action="model" data-name="${n}">${n} ↗</button>`).join("")}</div>` : ""}</div>`,
    )
    .join("");
}
function aiPage() {
  return `${heading("A strong foundation for AI.", "Bring context to your analytics. Prepare trusted data for what comes next.", "AI WORKSPACE")}<div class="notice">${icon("shield")}<span><strong>Grounded data insights.</strong> Supported questions use approved SQL. Readiness reflects dataset checks, not predictive performance. Model training and retrieval evaluation are separate workloads.</span></div><div class="ai-layout"><section class="card assistant-card"><div class="assistant-intro"><div class="assistant-symbol" aria-hidden="true"><span class="mini-core"><i class="mini-face front"></i><i class="mini-face back"></i><i class="mini-face left"></i><i class="mini-face right"></i><i class="mini-face top"></i><i class="mini-face bottom"></i></span></div><h2>Your data has a story. Ask away.</h2><p>Find the signals in your retail data, with answers linked to the models behind them.</p></div><div class="suggestions">${["Which category leads revenue?", "What are our top selling products?", "How are customers segmented?", "Is the data ready for AI?"].map((q) => `<button class="suggestion" data-action="ask" data-question="${q}">${q} ↗</button>`).join("")}</div><div class="chat-messages" id="chat-messages" aria-live="polite">${messages()}</div><form class="chat-form" id="chat-form"><label class="sr-only" for="question">Ask a question about your data</label><input id="question" name="question" maxlength="500" placeholder="Ask about revenue, customers, or data readiness..." required autocomplete="off"><button class="button primary" type="submit" aria-label="Send question">${icon("arrow", 16)}</button></form><p class="assistant-caption">Approved SQL insights · Last ${days} days for revenue and products · All history for segments</p></section><div class="ai-side">${readiness()}<section class="card asset-card"><h2>Built for the next step</h2>${[
    [
      "customer_features",
      "users",
      "Customer features",
      `${number(data.featureRows)} pseudonymous profiles`,
    ],
    [
      "product_knowledge",
      "document",
      "Product knowledge",
      `${data.documentRows} retrieval-ready documents`,
    ],
    [
      "daily_demand_features",
      "analytics",
      "Demand features",
      `${number(data.demandRows)} historical feature rows`,
    ],
  ]
    .map(
      ([name, ico, title, sub]) =>
        `<div class="asset-row"><span class="asset-icon">${icon(ico, 15)}</span><span><strong>${title}</strong><small>${sub}</small></span><button class="text-link" aria-label="Explore ${title}" data-action="model" data-name="${name}">${icon("arrow")}</button></div>`,
    )
    .join("")}</section></div></div>`;
}
function activityPage() {
  return `${heading("Every run tells a story.", "Execution history, timings, and validation results from your pipeline.", "ACTIVITY & RUNS")}<div class="health-summary"><div class="card health-item"><span>Recorded runs</span><strong>${data.runs.length}${data.runs.length === 30 ? "+" : ""}</strong><small>Up to 30 latest runs shown</small></div><div class="card health-item"><span>Latest duration</span><strong>${data.runs[0].finished_at ? duration(data.runs[0].duration_ms) : "In progress"}</strong><small>Transforms and tests</small></div><div class="card health-item"><span>Latest status</span><strong style="font-size:23px">${{ success: "Succeeded", failed: "Failed", queued: "Queued", running: "Running" }[data.runs[0].status] || "Unknown"}</strong><small>${humanDate(data.runs[0].started_at)} at ${humanTime(data.runs[0].started_at)}</small></div></div><section class="card table-card"><div class="card-header"><h2>Pipeline run history</h2><span class="badge gray">${esc(data.engine)} execution</span></div><div class="table-scroll"><table class="data-table"><thead><tr><th>RUN ID</th><th>STARTED</th><th>STATUS</th><th>MODELS</th><th>TESTS</th><th>DURATION</th><th></th></tr></thead><tbody>${data.runs.map((r) => `<tr><td><span class="run-id">${esc(r.id.slice(0, 21))}</span></td><td>${humanDate(r.started_at)} · ${humanTime(r.started_at)}</td><td><span class="badge ${r.status === "success" ? "green" : r.status === "failed" ? "red" : "gray"}">${icon(r.status === "success" ? "check" : "info", 8)}${{ success: "Success", failed: "Failed", queued: "Queued", running: "Running" }[r.status] || "Unknown"}</span></td><td>${r.models}</td><td>${r.tests ? `${r.tests - r.failed}/${r.tests}` : "Not recorded"}</td><td>${duration(r.duration_ms)}</td><td><button class="run-detail" data-action="run-detail" data-id="${r.id}">Details ↗</button></td></tr>`).join("")}</tbody></table></div></section>`;
}
function settingsPage() {
  const s = settingsData,
    warehouse = data.mode === "snowflake";
  return (
    heading(
      "Make it your workspace.",
      "Access, runtime details, and the active data release.",
      "WORKSPACE SETTINGS",
      false,
    ) +
    `<div class="setting-grid"><section class="card setting-card"><h2>${warehouse ? "Snowflake workspace" : "Local demonstration"}</h2><span class="badge ${warehouse ? "green" : "amber"}">${warehouse ? "Authenticated warehouse mode" : "Synthetic data"}</span><p>${esc(s.snowflake.message)}</p>${[
      ["Access role", identity.role],
      ["Identity", identity.name],
      [
        "Data source",
        warehouse
          ? "Validated Snowflake release"
          : "Reproducible SQLite sample",
      ],
      ["Release", data.releaseId || "Local build"],
      [
        "Published",
        data.publishedAt
          ? new Date(data.publishedAt).toLocaleString()
          : "Local runtime",
      ],
      ["Model as-of date", data.asOf],
      [
        "Exports",
        identity.role === "operator" && s.exportsEnabled
          ? "Enabled · bounded and audited"
          : "Disabled",
      ],
      ["External language model", "None"],
    ]
      .map(
        ([label, value]) =>
          `<div class="setting-row"><span>${label}</span><strong>${esc(value)}</strong></div>`,
      )
      .join(
        "",
      )}</section><section class="card setting-card"><h2>Operational controls</h2><p>${warehouse ? "Company SSO verifies identity. Viewer and operator permissions are enforced by the API. Builds run in a separate worker; a failed build preserves the last successful release." : "The local demonstration remains bound to loopback. Production requires Snowflake, company SSO, a worker, and persistent operational storage."}</p><ul class="readme-list"><li>Source snapshots and tests precede publication.</li><li>Only approved views are readable by the dashboard role.</li><li>CSV exports require operator access and an explicit production setting.</li><li>Deployment, backups, rollback, and incident procedures are in docs/production.md.</li></ul>${
      warehouse
        ? `<p class="details-text">Worker: ${data.workerAvailable ? "available" : "unavailable"}. Runtime: Node.js ${esc(s.node)}. Deployment readiness is checked separately at /readyz.</p>`
        : `<pre class="code-block">npm ci
npm start</pre>`
    }</section></div>`
  );
}
async function render() {
  navigation();
  if (data.setupRequired) {
    main.innerHTML =
      heading(
        "Prepare your first release.",
        "Snowflake mode is configured. Build and validate a release before serving business data.",
        "WAREHOUSE SETUP",
        false,
      ) +
      `<section class="card detail-block"><h2>No validated release is published yet.</h2><p class="details-text">The worker freezes source data, builds the dbt models, checks freshness and quality, and publishes only a successful release.</p><p class="details-text">${data.workerAvailable ? "The pipeline worker is available." : "Start the pipeline worker before requesting a build."}</p>${runButton()}<button class="button" data-action="refresh">Refresh status</button></section>`;
    return;
  }
  if (page === "settings" && !settingsData)
    settingsData = await api("/api/settings");
  main.innerHTML = {
    overview: overviewPage,
    pipeline: pipelinePage,
    catalog: catalogPage,
    analytics: analyticsPage,
    ai: aiPage,
    activity: activityPage,
    settings: settingsPage,
  }[page]();
  if (data.stale)
    main.insertAdjacentHTML(
      "afterbegin",
      '<div class="notice">The published release is older than the configured freshness objective. Review pipeline activity before relying on these metrics.</div>',
    );
}
async function refresh() {
  data = await api(`/api/overview?days=${days}`);
  const isWarehouse = data.mode === "snowflake";
  document.querySelector(".demo-label").innerHTML =
    `<i></i>${isWarehouse ? "Snowflake" : "Demo data"}`;
  document.querySelector(".local-status").innerHTML =
    `<i class="status-dot"></i><span>${isWarehouse ? "Warehouse environment" : "Local environment"}<span>${isWarehouse ? "Snowflake · published release" : "SQLite · Sample retail data"}</span></span>`;
  const initials = identity.name
    .split(/\s+/)
    .filter(Boolean)
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  document
    .querySelectorAll(".avatar")
    .forEach((el) => (el.textContent = initials));
  const profile = document.querySelector(".profile");
  profile.setAttribute("aria-label", identity.name + " · " + identity.role);
  profile.innerHTML = `<span class="avatar">${esc(initials)}</span><span>${esc(identity.name)}<span>${esc(identity.role)} workspace access</span></span><span class="profile-arrow">↗</span>`;
  if (isWarehouse && !document.querySelector("#logout-button")) {
    const button = document.createElement("button");
    button.id = "logout-button";
    button.className = "button";
    button.textContent = "Sign out";
    button.addEventListener("click", async () => {
      try {
        await api("/api/logout", { method: "POST", body: "{}" });
        location.assign("/signed-out");
      } catch (e) {
        toast(e.message, true);
      }
    });
    document.querySelector(".top-actions").append(button);
  }
  await render();
}
function openModal(title, html) {
  modalOpener = document.activeElement;
  document.querySelector("#modal-title").textContent = title;
  document.querySelector("#modal-body").innerHTML = html;
  modal.hidden = false;
  document.querySelector(".app-shell").inert = true;
  document.body.style.overflow = "hidden";
  modal.querySelector("input,button")?.focus();
}
function closeModal() {
  modal.hidden = true;
  document.querySelector(".app-shell").inert = false;
  document.body.style.overflow = "";
  modalOpener?.focus();
}
function previewTable(p) {
  return `<div class="table-scroll"><table class="data-table"><thead><tr>${p.columns.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${p.rows.map((row) => `<tr>${p.columns.map((c) => `<td title="${esc(row[c])}">${row[c] === null ? '<span style="color:#9295a3">null</span>' : esc(String(row[c]).length > 75 ? String(row[c]).slice(0, 75) + "…" : row[c])}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}
async function showModel(name) {
  const m = data.models.find((m) => m.name === name);
  if (!m) return;
  openModal(
    name,
    `<p class="modal-description">${esc(m.description)}</p><div class="model-meta-grid">${layerBadge(m.layer)}<span><strong>${number(m.rows)}</strong> rows</span><span><strong>${m.materialization}</strong> in dbt</span><span>${esc(m.owner)}</span></div><div class="dependency-list">${[...m.dependencies, ...m.sources].map((n) => `<span class="source-tag">← ${esc(n)}</span>`).join("")}</div><h3 class="modal-section-title">SCHEMA · ${m.columns.length} COLUMNS</h3><div class="schema-grid">${m.columns.map((c) => `<div class="schema-item"><span>${esc(c.name)}</span><small>${esc(c.type)}</small></div>`).join("")}</div><div class="toolbar" style="margin-top:22px;margin-bottom:12px"><h3 class="modal-section-title" style="margin:0">DATA PREVIEW</h3><button class="button" data-action="download-model" data-name="${m.name}" ${identity.role === "operator" && identity.exportsEnabled ? "" : "disabled"}>${icon("download")}Download CSV</button></div><div id="model-preview" class="details-text">Loading data…</div><h3 class="modal-section-title">SNOWFLAKE SQL · ${m.path}</h3><pre class="code-block">${esc(m.sql)}</pre>`,
  );
  try {
    const p = await api(`/api/models?name=${encodeURIComponent(name)}`),
      target = document.querySelector("#model-preview");
    if (
      target &&
      !modal.hidden &&
      document.querySelector("#modal-title").textContent === name
    )
      target.innerHTML = `${p.redacted ? `<p class="details-text">${p.redacted} direct identifier or demographic columns excluded from previews and exports.</p>` : ""}${previewTable(p)}<p class="details-text">Showing ${p.rows.length} of ${number(m.rows)} rows. The schema reflects the current execution mode; Snowflake SQL is shown below.</p>`;
  } catch (error) {
    toast(error.message, true);
  }
}
function downloadCSV(name, columns, rows) {
  const cell = (v) =>
    `"${String(typeof v === "string" && /^[=+@-]/.test(v) ? `'${v}` : (v ?? "")).replaceAll('"', '""')}"`;
  const content =
      "\ufeff" +
      [
        columns.map(cell).join(","),
        ...rows.map((r) => columns.map((c) => cell(r[c])).join(",")),
      ].join("\r\n"),
    url = URL.createObjectURL(
      new Blob([content], { type: "text/csv;charset=utf-8;" }),
    ),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}
async function run() {
  if (running || !identity.canRun) return;
  running = true;
  document.querySelectorAll('[data-action="run"]').forEach((b) => {
    b.disabled = true;
    b.textContent = "Running pipeline…";
  });
  try {
    let job = await api("/api/run", { method: "POST", body: "{}" });
    if (["queued", "running"].includes(job.status)) {
      toast(
        job.deduplicated
          ? "Following the existing pipeline run."
          : "Pipeline queued. Source data and dbt tests will be validated before publication.",
      );
      const until = Date.now() + 60 * 60000;
      while (["queued", "running"].includes(job.status) && Date.now() < until) {
        await new Promise((r) => setTimeout(r, 3000));
        job = await api("/api/jobs/" + encodeURIComponent(job.id));
      }
      if (job.status === "failed")
        throw new Error(
          "Pipeline failed: " +
            job.error_code +
            ". The previous release remains available.",
        );
      if (job.status !== "success") {
        toast("The run is still active. Follow it in Activity & runs.");
        return;
      }
    }
    data = await api("/api/overview?days=" + days);
    toast(
      `${data.models.length} models validated. ${data.testsPassed}/${data.totalTests} checks passed.`,
    );
  } catch (error) {
    toast(error.message, true);
  } finally {
    running = false;
    await refresh();
  }
}
async function ask(question) {
  if (!question.trim()) return;
  chat.push({ role: "user", text: question });
  document.querySelector("#chat-messages").innerHTML = messages();
  const form = document.querySelector("#chat-form");
  form.querySelector("input").value = "";
  form.querySelector("button").disabled = true;
  try {
    const r = await api("/api/insights", {
      method: "POST",
      body: JSON.stringify({ question, days }),
    });
    chat.push({
      role: "assistant",
      text: r.answer,
      sources: r.sources,
      kind: r.kind,
    });
  } catch (error) {
    chat.push({
      role: "assistant",
      text: error.message,
      kind: "Unable to answer",
    });
  } finally {
    if (page === "ai") {
      document.querySelector("#chat-messages").innerHTML = messages();
      document.querySelector("#chat-form button").disabled = false;
      document.querySelector("#chat-form input").focus();
    }
  }
}
function showSearch() {
  if (!data.models)
    return toast("Publish a validated release before searching models.");
  openModal(
    "Find your next insight",
    '<label class="sr-only" for="model-search">Search all models</label><input class="search-input modal-search" id="model-search" placeholder="Search models, features, or descriptions..." autocomplete="off"><div class="search-results" id="search-results"></div>',
  );
  updateSearch("");
  document.querySelector("#model-search").focus();
}
function updateSearch(value) {
  const list = data.models.filter((m) =>
    (m.name + " " + m.description).toLowerCase().includes(value.toLowerCase()),
  );
  document.querySelector("#search-results").innerHTML = list.length
    ? list
        .map(
          (m) =>
            `<button class="search-result" data-action="model" data-name="${m.name}">${icon(m.layer === "ai" ? "ai" : "table", 17)}<span><strong>${m.name}</strong><small>${esc(m.description)}</small></span>${layerBadge(m.layer)}</button>`,
        )
        .join("")
    : '<p class="empty-state">No models found.</p>';
}
function showRun(id) {
  const r = data.runs.find((r) => r.id === id);
  if (!r) return;
  const list = Array.isArray(r.details) ? r.details : r.details.models || [];
  openModal(
    "Pipeline run details",
    `<div class="model-meta-grid"><span class="run-id">${esc(r.id)}</span><span class="badge ${r.status === "success" ? "green" : r.status === "failed" ? "red" : "gray"}">${r.status}</span><span>${duration(r.duration_ms)}</span></div><p class="modal-description">Started ${new Date(r.started_at).toLocaleString()} · Finished ${r.finished_at ? new Date(r.finished_at).toLocaleString() : "In progress"}</p>${r.details.error ? `<div class="notice">${esc(r.details.error)}</div>` : ""}<div class="table-scroll"><table class="data-table"><thead><tr><th>MODEL</th><th>ROWS</th><th>DURATION</th><th>STATUS</th></tr></thead><tbody>${list.map((d) => `<tr><td>${esc(d.name)}</td><td>${number(d.rows)}</td><td>${duration(d.duration_ms)}</td><td><span class="badge green">Built</span></td></tr>`).join("")}</tbody></table></div><p class="details-text">${r.tests - r.failed} of ${r.tests} SQL quality checks passed. A validated release becomes active only after all checks pass.</p>`,
  );
}
function about() {
  openModal(
    "About your data workspace",
    `<p class="modal-description"><strong>${esc(data.project)}</strong></p><p class="details-text">Execution mode: ${esc(data.mode)}. ${data.mode === "snowflake" ? "Metrics and previews read the last validated, immutable Snowflake release." : "Metrics come from a reproducible synthetic retail dataset."}</p><p class="details-text">Analytical answers use approved SQL. This workspace does not train a model or invent predictions. Customer hashes remain pseudonymous data.</p><p class="details-text">See docs/production.md for deployment, access control, backup, and recovery procedures. Ctrl / ⌘ + K searches models; Escape closes dialogs.</p>`,
  );
}
document.addEventListener("click", async (event) => {
  const b = event.target.closest("[data-action]");
  if (!b) return;
  try {
    const a = b.dataset.action;
    if (a === "run") await run();
    if (a === "refresh") await refresh();
    if (a === "model") await showModel(b.dataset.name);
    if (a === "filter") {
      catalogFilter = b.dataset.filter;
      await render();
    }
    if (a === "pipeline-tab") {
      pipelineTab = b.dataset.tab;
      await render();
    }
    if (a === "stage") {
      if (b.dataset.layer === "bronze")
        openModal(
          "Bronze · source data",
          `<p class="modal-description">${data.mode === "demo" ? "Three synthetic sources in the local demonstration." : "Three source tables frozen with the published release."}</p><div class="quality-list">${[
            ["raw_customer", data.sourceCounts?.raw_customer || 1200],
            ["raw_product", data.sourceCounts?.raw_product || 30],
            ["raw_orders", data.totalRows],
          ]
            .map(
              ([n, c]) =>
                `<div class="quality-item"><span>${n}</span><strong>${number(c)} rows</strong></div>`,
            )
            .join(
              "",
            )}</div><p class="details-text">${data.mode === "demo" ? "Timestamps reflect sample generation." : "Source freshness was checked before this release was published."}</p>`,
        );
      else {
        catalogFilter = b.dataset.layer;
        catalogSearch = "";
        if (page === "catalog") await render();
        else location.hash = "catalog";
      }
    }
    if (a === "ask") await ask(b.dataset.question);
    if (a === "run-detail") showRun(b.dataset.id);
    if (a === "download-model") {
      const p = await api(
        `/api/models?name=${encodeURIComponent(b.dataset.name)}&download=1`,
      );
      downloadCSV(`${p.name}.csv`, p.columns, p.rows);
      toast(`${number(p.rows.length)} rows exported.`);
    }
    if (a === "export-overview") {
      downloadCSV(
        `pipeline-report-${data.asOf}.csv`,
        ["metric", "value", "period_days", "as_of_date"],
        [
          ["revenue_usd", data.current.revenue],
          ["orders", data.current.orders],
          ["active_customers", data.current.customers],
          ["average_order_value_usd", data.current.aov],
          ["quality_checks_passed", data.testsPassed],
          ["quality_checks_total", data.totalTests],
          ["ai_readiness_percent", data.readiness],
        ].map(([metric, value]) => ({
          metric,
          value,
          period_days: days,
          as_of_date: data.asOf,
        })),
      );
      toast("Your workspace report was exported.");
    }
    if (a === "copy-commands") {
      await navigator.clipboard.writeText(
        "python -m pip install -r requirements.txt\ndbt deps\ndbt debug --profiles-dir config\ndbt build --profiles-dir config",
      );
      toast("dbt commands copied.");
    }
  } catch (error) {
    toast(error.message, true);
  }
});
document.addEventListener("input", (event) => {
  if (event.target.id === "catalog-search") {
    catalogSearch = event.target.value;
    document.querySelector("#catalog-results").innerHTML = catalogCards();
  }
  if (event.target.id === "model-search") updateSearch(event.target.value);
});
document.addEventListener("change", async (event) => {
  if (event.target.matches(".period-select")) {
    days = Number(event.target.value);
    try {
      await refresh();
    } catch (error) {
      toast(error.message, true);
    }
  }
});
document.addEventListener("submit", (event) => {
  if (event.target.id === "chat-form") {
    event.preventDefault();
    ask(new FormData(event.target).get("question"));
  }
});
document.querySelector("#global-search").addEventListener("click", () => {
  if (data) showSearch();
});
document.querySelector("#search-icon").innerHTML = icon("search", 15);
document.querySelector("#help-button").addEventListener("click", () => {
  if (data) about();
});
document.querySelector("#close-modal").addEventListener("click", closeModal);
modal.addEventListener("click", (event) => {
  if (event.target === modal) closeModal();
});
document
  .querySelector("#menu-toggle")
  .addEventListener("click", () =>
    setDrawer(!document.querySelector("#sidebar").classList.contains("open")),
  );
document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "k") {
    event.preventDefault();
    if (data) showSearch();
  }
  if (event.key === "Escape") {
    closeModal();
    setDrawer(false);
  }
  if (event.key === "Tab" && !modal.hidden) {
    const list = [
        ...modal.querySelectorAll(
          'button,input,a,select,textarea,[tabindex="0"]',
        ),
      ].filter((el) => !el.disabled),
      first = list[0],
      last = list.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }
});
window.addEventListener("hashchange", async () => {
  page = Object.hasOwn(labels, location.hash.slice(1))
    ? location.hash.slice(1)
    : "overview";
  setDrawer(false);
  if (data)
    try {
      await render();
      window.scrollTo(0, 0);
      main.focus({ preventScroll: true });
    } catch (error) {
      toast(error.message, true);
    }
});
page = Object.hasOwn(labels, location.hash.slice(1))
  ? location.hash.slice(1)
  : "overview";
try {
  identity = await api("/api/session");
  await refresh();
} catch (error) {
  navigation();
  main.innerHTML = `<div class="error-panel"><h2>The workspace could not load.</h2><p>${esc(error.message)} Refresh this page or contact your workspace operator.</p></div>`;
}
