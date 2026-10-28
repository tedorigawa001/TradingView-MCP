// C-C1b-2 source-only entry. No argument, environment variable or configuration packet unlocks it.
import { pathToFileURL } from "node:url";
export async function runUnsignedWorker() { throw Error("cc1b2_execution_not_approved"); }
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) throw Error("cc1b2_execution_not_approved");
