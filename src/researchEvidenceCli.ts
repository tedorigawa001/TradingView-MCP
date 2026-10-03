#!/usr/bin/env node
import { lstat } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import { parseArgs } from "node:util";
import { readBacktestLedgerFile } from "./backtestLedger.js";
import { openExclusiveFile, syncDirectoryEntry } from "./fsDurability.js";
import { generateResearchEvidence } from "./researchEvidenceGeneration.js";
import { researchEvidenceDiagnostic } from "./researchEvidenceErrors.js";
import { isCliEntrypoint } from "./cliEntrypoint.js";

export async function runResearchEvidenceCli(args: string[]) {
  const { values } = parseArgs({ args, options: {
    input: { type: "string" }, output: { type: "string" },
    "confirm-local-read": { type: "boolean" },
  }, strict: true, allowPositionals: false });
  if (!values.input || !values["confirm-local-read"]) {
    throw new Error("--input and --confirm-local-read are required");
  }
  if (values.output !== undefined) {
    if (!isAbsolute(values.output)) throw new Error("--output must be an absolute path");
    const directory = await lstat(dirname(values.output));
    if (!directory.isDirectory() || directory.isSymbolicLink()) {
      throw new Error("--output requires an existing regular directory");
    }
  }
  const config = JSON.parse((await readBacktestLedgerFile(values.input)).toString("utf8"));
  const report = await generateResearchEvidence(config);
  if (values.output === undefined) return report;

  const handle = await openExclusiveFile(values.output, "research evidence output");
  try {
    await handle.writeFile(`${JSON.stringify(report, null, 2)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncDirectoryEntry(dirname(values.output));
  return { written: true, manifest: report.manifest };
}


if (isCliEntrypoint(import.meta.url)) {
  runResearchEvidenceCli(process.argv.slice(2)).then((result) => console.log(JSON.stringify(result)))
    .catch((error) => {
      // Parser and schema errors may contain source text. Never echo them.
      console.error(researchEvidenceDiagnostic(error));
      process.exitCode = 1;
    });
}
