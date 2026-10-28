// Non-executing C-C1a entry. It can print a plan, but cannot build, create, read, sign or remove a fixture.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { inspectUnsignedHarness } from "../../test/helpers/jointUnsignedHarness.mjs";

export function inspectJointAdmissionArguments(args) { return inspectUnsignedHarness(args); }
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { process.stdout.write(`${JSON.stringify(inspectJointAdmissionArguments(process.argv.slice(2)))}\n`); }
  catch (e) { process.stderr.write(`${e instanceof Error && /^cc1a_[a-z_]+$/.test(e.message) ? e.message : "cc1a_invalid_arguments"}\n`); process.exitCode = 1; }
}
