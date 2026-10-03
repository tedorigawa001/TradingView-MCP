#!/usr/bin/env node
import { parseArgs } from "node:util";
import { isAbsolute } from "node:path";
import { openExclusiveFile } from "./fsDurability.js";
import { ProxySetStore } from "./proxySet.js";
import { isCliEntrypoint } from "./cliEntrypoint.js";

/** Writes a stored proxy set to a new file. Never overwrites; the output path must be absolute. */
export async function exportProxySet(args: string[], store: Pick<ProxySetStore, "get"> = new ProxySetStore()) {
  const { values } = parseArgs({ args, options: {
    artifact: { type: "string" }, output: { type: "string" }, "confirm-local-write": { type: "boolean" },
  }, strict: true, allowPositionals: false });
  if (!values.artifact || !values.output || !values["confirm-local-write"]) {
    throw new Error("--artifact, --output and --confirm-local-write are required");
  }
  if (!isAbsolute(values.output)) throw new Error("--output must be an absolute path");
  const set = await store.get(values.artifact);
  const handle = await openExclusiveFile(values.output, "proxy set export");
  try { await handle.writeFile(JSON.stringify(set)); await handle.sync(); } finally { await handle.close(); }
  return { artifact_id: values.artifact, output: values.output, dates: set.dates.length };
}


if (isCliEntrypoint(import.meta.url)) {
  exportProxySet(process.argv.slice(2)).then((result) => console.log(JSON.stringify(result)))
    .catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
