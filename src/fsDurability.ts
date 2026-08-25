import { constants } from "node:fs";
import { open } from "node:fs/promises";

/**
 * Persist a newly-created directory entry where the host exposes directory
 * fsync. Windows cannot open directories through Node's fs API, while the file
 * handle itself is still synced by each caller before reaching this helper.
 */
/**
 * O_NOFOLLOW where the host defines it, and zero where it does not.
 *
 * Node does not define O_NOFOLLOW on Windows, so `constants.O_RDONLY |
 * constants.O_NOFOLLOW` evaluates there to `O_RDONLY | undefined`, which
 * JavaScript reduces to plain O_RDONLY. The symlink protection disappears with
 * no error raised and nothing in the call site admitting it. This changes what
 * no platform does - it gives the loss a name, so it is visible at every call
 * and a test can hold it in place.
 */
export function noFollowFlag(platform = process.platform): number {
  return platform === "win32" ? 0 : (constants.O_NOFOLLOW ?? 0);
}

export async function syncDirectoryEntry(directory: string, platform = process.platform): Promise<void> {
  if (platform === "win32") return;
  const handle = await open(directory, constants.O_RDONLY | noFollowFlag(platform));
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
