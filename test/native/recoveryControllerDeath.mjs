import { writeSync } from "node:fs";
import { fixture } from "./recoveryProcessFixture.mjs";

const x = fixture({ after() {} }); let sent = false;
const p = await x.open({ hook(phase, _path, workerPid) {
  if (phase === "before_move" && !sent) {
    sent = true; writeSync(4, JSON.stringify({ base: x.base, root: x.root, source: x.inputs[0].source_path, workerPid }) + "\n");
    process.kill(process.pid, "SIGSTOP");
  }
} });
const a = (await p.prepare()).attempt_plan;
await p.begin(a.plan_id, a.plan_hash, await p.approveForSyntheticTest(a.plan_id, a.plan_hash));
for (let i = 0; i < 30; ++i) await p.step();
throw new Error("controller-death fixture unexpectedly continued");
