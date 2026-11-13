import { createHash } from "node:crypto";
import { isUtf8 } from "node:buffer";
import { existsSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { z } from "zod";
import { readBacktestLedgerFile } from "./backtestLedger.js";

export const relationSnapshotSchema = z.object({
  namespace: z.enum(["research_period_usage", "research_trials", "research_series_relations"]),
  sequence_end: z.number().int().min(0).max(8192),
  prefix_sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/),
}).strict();
export type RelationSnapshotAnchor = z.infer<typeof relationSnapshotSchema>;
export type RelationJournalSnapshot<T> = {
  anchor: RelationSnapshotAnchor;
  records: T[];
  checked_at: string;
};
export const relationDigest = (text: string): string => `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;

/** Lossless text only: decoding corrupt bytes into U+FFFD would hash a different physical prefix. */
export async function readRelationJournalText(path: string): Promise<string | null> {
  try {
    const bytes = await readBacktestLedgerFile(path, true);
    if (!isUtf8(bytes)) throw new Error("invalid relation snapshot UTF-8");
    return bytes.toString("utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export function assertRelationJournalDistinct(left: string, right: string): void {
  const key = (path: string) => {
    let existing = resolve(path);
    const rest: string[] = [];
    while (!existsSync(existing) && dirname(existing) !== existing) {
      rest.unshift(basename(existing)); existing = dirname(existing);
    }
    const result = join(realpathSync(existing), ...rest);
    return process.platform === "darwin" || process.platform === "win32" ? result.toLowerCase() : result;
  };
  if (key(left) === key(right)) throw new Error("relation registry must not share the target journal path");
  if (existsSync(left) && existsSync(right)) {
    const a = statSync(left), b = statSync(right);
    if (a.dev === b.dev && a.ino === b.ino) throw new Error("relation registry must not alias the target journal file");
  }
}

/** Called under the caller's file lock, after the journal's full native validation. No file is rewritten. */
export function relationSnapshot<T extends { sequence: number }>(namespace: RelationSnapshotAnchor["namespace"], records: T[], raw: string | null,
  checkedAt: string, selection?: RelationSnapshotAnchor, maximum = 4096): RelationJournalSnapshot<T> {
  if (records.length > maximum) throw new Error("relation target record limit exceeded");
  if (selection) selection = relationSnapshotSchema.parse(selection);
  if (selection && selection.namespace !== namespace) throw new Error("relation snapshot namespace mismatch");
  const lines = raw === null || raw === "" ? [] : raw.slice(0, -1).split("\n");
  if (lines.length !== records.length) throw new Error("relation snapshot framing mismatch");
  const end = selection?.sequence_end ?? records.length;
  if (end > records.length) throw new Error("requested relation snapshot prefix is missing");
  const prefix = end ? lines.slice(0, end).join("\n") + "\n" : "";
  const prefix_sha256 = relationDigest(prefix);
  if (selection && selection.prefix_sha256 !== prefix_sha256) throw new Error("requested relation snapshot hash mismatch");
  return { anchor: { namespace, sequence_end: end, prefix_sha256 }, records: records.slice(0, end), checked_at: checkedAt };
}
