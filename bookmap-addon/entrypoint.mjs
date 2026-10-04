import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The node options that run code instead of a script: -e, -p, -pe and their long forms. */
const EVAL = /^(?:-(?:e|p|pe|ep)|--eval|--print)(?:=|$)/;

/**
 * Whether the module at `moduleUrl` is the script node was started with, by real path, so a symlinked checkout or a
 * Windows junction still runs it (BACKLOG 102-01). With -e or -p argv[1] is the first argument after the code, and with
 * node - (stdin) it is "-": no script either way, so importing build.mjs from such code never runs its build, which
 * starts by deleting the existing artifacts, even when that argument names or links to this file.
 */
export function isEntrypoint(moduleUrl, script = process.argv[1], execArgv = process.execArgv) {
  if (!script || script === "-" || execArgv.some((arg) => EVAL.test(arg))) return false;
  try { return realpathSync(resolve(script)) === realpathSync(fileURLToPath(moduleUrl)); }
  catch { return false; }
}
