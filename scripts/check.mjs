import { readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
const files = [];
for (const dir of ["app", "server", "scripts", "tests"])
  for (const item of readdirSync(dir, { withFileTypes: true }))
    if (item.isFile() && /\.(mjs|js)$/.test(item.name))
      files.push(join(dir, item.name));
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], {
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`Syntax checked ${files.length} application and test files.`);
