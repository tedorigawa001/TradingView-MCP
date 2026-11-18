/** Pure v3 entry; limits and observable diagnostic phases are unchanged. */
import { z } from "zod";
import { COMMITTED_MAINTENANCE_LIMITS, CommittedMaintenanceBudget,
  collect, decode, digest, parse, headerSchema, schemas, type Row, type RecordRow } from "./internal/nativeBarCommittedKernel.js";
import { verifyCommittedLogical, rejectCommittedLogical } from "./internal/nativeBarCommittedSemantic.js";
export { COMMITTED_MAINTENANCE_LIMITS, CommittedMaintenanceBudget } from "./internal/nativeBarCommittedKernel.js";
export function inspectCommittedMaintenance(input: unknown) {
  const b = new CommittedMaintenanceBudget();
  try {
    b.charge(256); // Bounded terminal diagnostic/statistics reserve; no history on failure.
    const bytes = collect(input, b), head = decode(bytes[0], b);
    if (["native-bar-committed-input-v1","native-bar-committed-input-v2"].includes(head.value.schema)) b.stop("unsupported_input_version");
    const header = parse(headerSchema, { ...head, bytes: bytes[0].length }, b);
    if (header.records.length !== bytes.length - 1) b.stop("record_directory");
    const records: RecordRow[] = [];
    for (let i = 0; i < header.records.length; i++) {
      b.charge(); const d = header.records[i];
      if (d.index !== i + 1) b.stop("record_directory");
      const raw = bytes[i + 1], sha = digest(raw, b);
      if (sha !== d.hash) b.stop("record_hash");
      const decoded = decode(raw, b), r = { ...decoded, index: i + 1, role: d.role, hash: sha, bytes: raw.length };
      const schema = schemas[r.role];
      if (!schema) b.stop("unsupported_role");
      r.value = parse(schema as z.ZodType<Row>, r, b); records.push(r);
    }
    return verifyCommittedLogical(records,header,b);
  } catch (error) { return rejectCommittedLogical(error,b); }
}
