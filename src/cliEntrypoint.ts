import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The node options that run code instead of a script: -e, -p, -pe and their long forms. */
const EVAL = /^(?:-(?:e|p|pe|ep)|--eval|--print)(?:=|$)/;

/**
 * Whether the module at `moduleUrl` is the script node was started with, compared by real path. npm installs a bin as
 * a symlink, so process.argv[1] is the link while import.meta.url is the file it points to; comparing the two as
 * strings (or by file name) made a linked CLI exit 0 without doing anything, even on an argument it would reject
 * (BACKLOG 102-01). argv[1] is resolved as node resolved the main script, so `node build/x` (no extension) counts too.
 * Imported as a module, or with no script (node -e or -p, whose argv[1] is the first argument after the code), it is
 * not the entry point. A module URL that is not a file URL is a programming error and throws; only a script path that
 * does not resolve means "not the entry point".
 */
export function isCliEntrypoint(moduleUrl: string, scriptPath?: string): boolean {
  const modulePath = fileURLToPath(moduleUrl);
  const path = scriptPath ?? (process.execArgv.some((arg) => EVAL.test(arg)) ? undefined : process.argv[1]);
  if (!path) return false;
  let script: string;
  try {
    script = realpathSync(createRequire(moduleUrl).resolve(resolve(path)));
  } catch {
    return false;
  }
  return script === realpathSync(modulePath);
}
