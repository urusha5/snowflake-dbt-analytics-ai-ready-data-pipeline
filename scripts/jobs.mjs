import { resolve } from "node:path";
import { StateStore } from "../server/state.mjs";
if (!process.env.STATE_DIR)
  throw new Error(
    "Set STATE_DIR to the same persistent directory used by the app and worker.",
  );
const state = new StateStore(
  resolve(process.env.STATE_DIR, "operations.sqlite"),
);
try {
  const [command, id] = process.argv.slice(2);
  if (command === "queue")
    console.log(JSON.stringify(state.enqueue("deployment_operator")));
  else if (command === "status")
    console.log(JSON.stringify(state.jobs(), null, 2));
  else if (command === "rollback" && id) {
    state.rollback(id, "deployment_operator");
    console.log("Published release pointer rolled back.");
  } else if (command === "revoke-sessions") {
    state.db.exec("DELETE FROM sessions");
    state.audit("deployment_operator", "revoke_sessions", "all", "success");
    console.log("Workspace sessions revoked.");
  } else
    throw new Error(
      "Usage: node scripts/jobs.mjs queue | status | rollback <successful-release-id> | revoke-sessions",
    );
} finally {
  state.close();
}
