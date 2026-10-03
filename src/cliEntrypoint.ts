import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Whether the module at `moduleUrl` is the script node was started with, compared by real path. npm installs a bin as
 * a symlink, so process.argv[1] is the link while import.meta.url is the file it points to; comparing the two as
 * strings (or by file name) made a linked CLI exit 0 without doing anything, even on an argument it would reject
 * (BACKLOG 102-01). Imported as a module, or with no script (node -e), it is not the entry point.
 */
export function isCliEntrypoint(moduleUrl: string, scriptPath: string | undefined = process.argv[1]): boolean {
  if (!scriptPath) return false;
  try {
    return realpathSync(scriptPath) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}
