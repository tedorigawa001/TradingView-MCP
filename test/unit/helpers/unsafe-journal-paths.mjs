import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, stat, symlink, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

/**
 * Journal paths that read as empty or report size zero but are not an empty regular owner-only file, so the strict
 * journals must refuse them without waiting (BACKLOG 102-43). POSIX only: mkfifo and mode bits.
 */
export const UNSAFE_EMPTY_JOURNAL_PATHS = [
  // A FIFO reports size zero too; opening it to read without O_NONBLOCK waits for a writer forever.
  ['fifo', (path) => promisify(execFile)('mkfifo', ['-m', '600', path])],
  ['symbolic link to an empty file', async (path) => {
    await writeFile(`${path}.target`, '', { mode: 0o600 });
    await symlink(`${path}.target`, path);
  }],
  ['directory', (path) => mkdir(path, { mode: 0o700 })],
  ['empty file others can read', async (path) => {
    await writeFile(path, '', { mode: 0o644 });
    await chmod(path, 0o644);
  }],
];

/** The path and, through a symbolic link, its target: what a refused call must leave as it was. */
export async function describePath(path) {
  const fields = (s) => [s.ino, s.mode, s.size, s.mtimeMs];
  return { entry: fields(await lstat(path)), target: fields(await stat(path)) };
}

/**
 * How a call on a journal path ended: 'resolved', 'rejected', or 'waited' when it was still pending after `ms`. A
 * waiting call is released by opening the FIFO for writing, so the test fails instead of hanging the run.
 */
export async function settle(call, path, ms = 5000) {
  const pending = call();
  let timer;
  const deadline = new Promise((resolve) => { timer = setTimeout(resolve, ms, 'waited'); });
  const outcome = await Promise.race([pending.then(() => 'resolved', () => 'rejected'), deadline]);
  clearTimeout(timer);
  if (outcome === 'waited') {
    const writer = await open(path, constants.O_WRONLY | constants.O_NONBLOCK).catch(() => null);
    await writer?.close();
    await pending.catch(() => {});
  }
  return outcome;
}
