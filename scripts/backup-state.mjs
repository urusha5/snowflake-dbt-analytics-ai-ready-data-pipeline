import { DatabaseSync, backup } from "node:sqlite";
import { resolve, dirname } from "node:path";
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
const destination = process.argv[2];
if (!process.env.STATE_DIR || !destination)
  throw new Error(
    "Usage: STATE_DIR=<persistent-directory> node scripts/backup-state.mjs <absolute-backup-file>",
  );
const source = resolve(process.env.STATE_DIR, "operations.sqlite"),
  target = resolve(destination);
if (target === source || existsSync(target))
  throw new Error(
    "Choose a new backup destination; existing files are never overwritten.",
  );
mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
writeFileSync(target, "", { flag: "wx", mode: 0o600 });
const db = new DatabaseSync(source, { readOnly: true });
try {
  await backup(db, target);
  console.log(
    "Operational database backup completed. Protect and encrypt this backup: it contains sessions and audit records.",
  );
} finally {
  db.close();
}
