import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
const db = new DatabaseSync(
  resolve(process.env.STATE_DIR, "operations.sqlite"),
  { readOnly: true },
);
db.exec("PRAGMA busy_timeout=1000");
try {
  const row = db.prepare("SELECT at FROM worker_heartbeat WHERE id=1").get();
  process.exitCode = row && Date.now() - row.at < 45000 ? 0 : 1;
} finally {
  db.close();
}
