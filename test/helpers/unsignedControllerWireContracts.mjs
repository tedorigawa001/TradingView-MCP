import { z } from "zod";
import { label, code, digestSchema as hash, count, parse, decode, resourcesSchema, freeze, refuse, LIMITS } from "./unsignedControllerData.mjs";

export const artifactSchema = z.object(Object.fromEntries(["js_set_sha256", "addon_sha256", "observer_sha256", "controller_sha256", "worker_sha256",
  "runtime_closure_sha256", "node_binary_sha256", "build_record_sha256", "reader_source_sha256", "reader_js_sha256"].map((k) => [k, hash]))).strict();
export const setupSchema = z.object({ fixture_name: z.string().regex(/^native-bar-fs-synthetic-[A-Za-z0-9]{6}$/), recipe_sha256: hash,
  registration_sha256: hash, envelope_sha256: hash }).strict();
export const readySchema = z.object({ addon_protocol: z.literal(6), mode: z.literal("synthetic_only"), pins_sha256: hash, worker_clock_domain: label }).strict();
export const failureSchema = z.object({ phase: z.enum(["launch", "prepare", "go", "settlement", "finalize"]), primary_code: code, close_errors: z.array(code).max(8),
  diagnostic_sha256: hash.nullable(), resources: resourcesSchema.nullable(), query_created: z.boolean(), instrumentation_overflow: z.boolean() }).strict();
const bindingSchema = z.object({ protocol: z.literal("native-bar-unsigned-execution-v2"), stage: z.literal("C-C1b-4"),
  run_id: label, case_id: label, mode: z.enum(["normal", "ubsan"]), source_commit: z.string().regex(/^[a-f0-9]{40}$/),
  patch_sha256: hash, source_tree_sha256: hash, plan_sha256: hash, template_sha256: hash,
  exchange_id: label, launch_nonce: label, signature_profile: z.literal("linker_adhoc"), ...artifactSchema.shape, setup: setupSchema.nullable() }).strict();
const frameSchema = z.object({ binding: z.unknown(), direction: z.enum(["parent", "worker"]), ordinal: count(32, 1),
  kind: z.enum(["LAUNCH", "READY", "PREPARE", "BASELINED", "GO", "TRACE_CHUNK", "OBSERVED", "RELEASED", "FAILED", "CANCEL", "FINALIZE"]), payload: z.unknown() }).strict();

// Parent keeps its allocation-derived binding equality and lifecycle checks unchanged.
export function readUnsignedControllerFrame(raw) {
  if (typeof raw !== "string") refuse("encoding");
  if (raw.length > LIMITS.frame_bytes) refuse("byte_bound");
  if (!raw.isWellFormed()) refuse("encoding");
  return parse(frameSchema, decode(raw, LIMITS.frame_bytes));
}

export function validateUnsignedWireBinding(input) { return freeze(parse(bindingSchema, input)); }
