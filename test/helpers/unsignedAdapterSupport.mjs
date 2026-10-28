import { createHash } from "node:crypto";
import { z } from "zod";
import { describeUnsignedFixture } from "./jointUnsignedAcceptanceContracts.mjs";

const refuse = (code) => { throw Error(`cc1b2_${code}`); };
const flags = () => ({ execution_available: false, native_status: "NOT_RUN", ownership_verified: false, evidence_saved: false });
const freeze = (v) => { if (v && typeof v === "object") { Object.values(v).forEach(freeze); Object.freeze(v); } return v; };
function data(input) {
  let nodes = 0, bytes = 0;
  const visit = (v, depth) => {
    if (++nodes > 4096 || depth > 16) refuse("input_bound");
    if (v === null || typeof v === "boolean" || Number.isSafeInteger(v)) return v;
    if (typeof v === "string") { const n = Buffer.byteLength(v); bytes += n; if (n > 262144 || bytes > 524288) refuse("input_bound"); return v; }
    if (!v || typeof v !== "object") refuse("invalid_input");
    const array = Array.isArray(v), keys = Reflect.ownKeys(v), proto = Object.getPrototypeOf(v);
    if (array ? proto !== Array.prototype || v.length > 256 || keys.length !== v.length + 1 : proto !== Object.prototype && proto !== null) refuse("invalid_input");
    if (keys.length > 257) refuse("input_bound"); const out = array ? [] : Object.create(null);
    for (const k of keys) {
      if (array && k === "length") continue;
      if (typeof k !== "string" || ["__proto__", "prototype", "constructor"].includes(k)
        || array && (!/^(0|[1-9][0-9]*)$/.test(k) || Number(k) >= v.length)) refuse("invalid_input");
      bytes += Buffer.byteLength(k); if (Buffer.byteLength(k) > 128 || bytes > 524288) refuse("input_bound");
      const d = Object.getOwnPropertyDescriptor(v, k); if (!d?.enumerable || !("value" in d)) refuse("invalid_input");
      Object.defineProperty(out, k, { value: visit(d.value, depth + 1), enumerable: true });
    }
    return out;
  };
  return visit(input, 0);
}
const parse = (schema, input) => { const r = schema.safeParse(data(input)); if (!r.success) refuse("invalid_input"); return r.data; };
const typed = Object.getPrototypeOf(Uint8Array.prototype), size = Object.getOwnPropertyDescriptor(typed, "byteLength").get;
const backing = Object.getOwnPropertyDescriptor(typed, "buffer").get, byteOffset = Object.getOwnPropertyDescriptor(typed, "byteOffset").get;
function copyBytes(input, cap) {
  try {
    const n = size.call(input);
    if (![Buffer.prototype, Uint8Array.prototype].includes(Object.getPrototypeOf(input)) || n > cap) refuse("byte_bound");
    const out = Buffer.alloc(n); Uint8Array.prototype.set.call(out, input); return out;
  } catch { refuse("byte_bound"); }
}
export function createUnsignedProtocolDecoder() {
  let pending = Buffer.alloc(0), frames = 0, stopped = null, ended = false;
  const fail = (reason) => { stopped ??= reason; refuse(reason); };
  const describe = () => freeze({ ...flags(), frames, pending_bytes: pending.length, stopped, ended });
  return Object.freeze({
    push(input) {
      if (stopped || ended) refuse("decoder_stopped");
      try {
        const data = copyBytes(input, 32 * 65536), out = []; let start = 0, count = frames, tail = pending;
        for (let i = 0; i < data.length; i++) {
          if (tail.length + i - start + 1 > 65536) fail("frame_bound");
          if (data[i] !== 10) continue;
          if (++count > 32) fail("frame_count");
          const line = Buffer.concat([tail, data.subarray(start, i + 1)]);
          out.push(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(line)); tail = Buffer.alloc(0); start = i + 1;
        }
        pending = Buffer.concat([tail, data.subarray(start)]); frames = count; return Object.freeze(out);
      } catch (e) { stopped ??= /^cc1b2_[a-z_]+$/.test(e?.message) ? e.message.slice(6) : "frame_encoding"; refuse(stopped); }
    },
    end() { if (stopped || ended) refuse("decoder_stopped"); if (pending.length) fail("truncated_frame"); ended = true; return describe(); },
    describe,
  });
}

export function createUnsignedWriteCursor(input) {
  const d = parse(z.object({ text: z.string(), cap_bytes: z.union([z.literal(16384), z.literal(262144), z.literal(5290)]) }).strict(), input);
  const expected = Buffer.from(d.text); if (!expected.length || expected.length > d.cap_bytes) refuse("write_bound");
  const digest = (b) => createHash("sha256").update(b).digest("hex"), expectedHash = digest(expected);
  let offset = 0, stopped = false, confirmed = false;
  const fail = (reason) => { stopped = true; refuse(reason); };
  const describe = () => freeze({ ...flags(), offset, remaining: expected.length - offset, model_consistent: confirmed, stopped, sha256: expectedHash });
  return Object.freeze({
    advance(n) {
      if (stopped || confirmed) refuse("writer_stopped");
      if (!Number.isSafeInteger(n) || n < 1 || n > expected.length - offset) fail("write_progress");
      offset += n; return describe();
    },
    confirmReadback(value) {
      if (stopped || confirmed) refuse("writer_stopped");
      try { const actual = copyBytes(value, d.cap_bytes);
        if (offset !== expected.length || actual.length !== expected.length || digest(actual) !== expectedHash) fail("readback_mismatch");
      } catch { fail("readback_mismatch"); }
      confirmed = true; return describe();
    }, describe,
  });
}

export function describeUnsignedObserverRequest(input) {
  const d = parse(z.object({ fixture: z.unknown(), operation: z.enum(["anchor", "entry", "inventory", "absence"]),
    entry_index: z.number().int().min(0).max(15).nullable() }).strict(), input);
  const recipe = describeUnsignedFixture(d.operation === "anchor" ? { ...d.fixture, fixture_name: "native-bar-fs-synthetic-Plan00" } : d.fixture);
  if (d.operation === "entry" ? d.entry_index === null || d.entry_index >= recipe.entries.length : d.entry_index !== null) refuse("selector");
  // The observer emits the same digest of its own fixed recipe, so a C++/JS recipe drift refuses every response.
  const recipe_sha256 = createHash("sha256").update(recipe.entries.map((e) => `${e.kind === "directory" ? "d" : "f"} ${e.path}\n`).join("")).digest("hex");
  return freeze({ ...flags(), relative_program: `build/b3cc-validation/${recipe.declaration.mode}/admission-unsigned-observer`,
    argv: ["--observer-v1", d.operation, recipe.declaration.case_id, d.operation === "anchor" ? "-" : recipe.declaration.fixture_name,
      recipe.declaration.ids.extra, d.entry_index === null ? "-" : String(d.entry_index)], maximum_response_bytes: 65536,
    maximum_work_bytes: 4194304, maximum_calls: 64, recipe_paths: recipe.entries.map((e) => e.path),
    recipe_kinds: recipe.entries.map((e) => e.kind), recipe_sha256 });
}
// A failed observer writes exactly one bounded `observer_<code>` line to stderr and exits 1; anything else stays generic.
export function classifyUnsignedObserverExit(input) {
  const d = parse(z.object({ exit_code: z.number().int().min(0).max(255).nullable(), signal: z.string().regex(/^SIG[A-Z0-9]{1,12}$/).nullable(),
    stdout_bytes: z.number().int().min(0), stderr: z.string().max(64) }).strict(), input);
  if (d.exit_code === 0 && d.signal === null && d.stderr === "") return freeze({ ...flags(), decision: "response", code: null });
  const refused = d.exit_code === 1 && d.signal === null && d.stdout_bytes === 0 && /^observer_[a-z_]{1,56}\n$/.test(d.stderr);
  return freeze({ ...flags(), decision: "refused", code: refused ? `cc1b2_${d.stderr.slice(0, -1)}` : d.stderr ? "cc1b2_child_stderr" : "cc1b2_child_exit" });
}

const uint = z.string().regex(/^(0|[1-9][0-9]{0,29})$/), hash = z.string().regex(/^[a-f0-9]{64}$/);
const canonicalNames = (names) => JSON.stringify([...names].sort());
const proof = z.object({ kind: z.enum(["directory", "file"]), device: uint, inode: uint, uid: uint, gid: uint, mode: uint, flags: uint,
  birthtime_ns: uint, mtime_ns: uint, ctime_ns: uint, nlink: uint, size: uint, allocated_bytes: uint,
  acl: z.enum(["none", "deny_only"]), acl_hash: hash, sha256: hash.nullable() }).strict();
export function inspectUnsignedObserverResponse(request, line) {
  const expected = describeUnsignedObserverRequest(request);
  if (typeof line !== "string" || Buffer.byteLength(line) > 65536) refuse("observer_response_bound");
  let raw; try { raw = JSON.parse(line); } catch { refuse("observer_response"); }
  if (JSON.stringify(raw) + "\n" !== line) refuse("observer_response");
  const schema = z.object({ schema: z.literal("native-bar-unsigned-observer-v1"), case_id: z.literal(expected.argv[2]),
    operation: z.literal(expected.argv[1]), fixture_name: expected.argv[1] === "anchor" ? z.null() : z.literal(expected.argv[3]), extra: z.literal(expected.argv[4]),
    recipe_sha256: z.literal(expected.recipe_sha256),
    ancestors: z.array(z.object({ path: z.enum(["/", "/private", "/private/tmp"]), proof }).strict()).length(3),
    entries: z.array(z.object({ index: z.number().int().min(0).max(15), proof, children: z.array(z.string().max(128)).max(16).nullable() }).strict()).max(16),
    missing: z.array(z.number().int().min(0).max(15)).max(16), absent: z.boolean(),
    volume: z.object({ filesystem: z.literal("apfs"), local: z.literal(true), ownership_enforced: z.literal(true),
      case_preserving: z.literal(true), case_sensitive: z.boolean(), read_only_mount: z.boolean() }).strict(), nodes: uint, content_bytes: uint, work_bytes: uint }).strict();
  const d = parse(schema, raw), operation = expected.argv[1], recipe = expected.recipe_paths;
  if (d.ancestors.map((a) => a.path).join(",") !== "/,/private,/private/tmp" || BigInt(d.nodes) > 19n || BigInt(d.work_bytes) > 4194304n
    || BigInt(d.content_bytes) > 262144n || new Set(d.entries.map((e) => e.index)).size !== d.entries.length
    || new Set(d.missing).size !== d.missing.length || d.entries.some((e) => e.index >= recipe.length || d.missing.includes(e.index))
    || d.missing.some((i) => i >= recipe.length) || d.entries.some((e) => e.proof.kind !== expected.recipe_kinds[e.index])) refuse("observer_response");
  // What the C++ walk can emit: an entry operation opens only the selected path's chain, and a missing parent hides its children.
  const indexOf = (path) => recipe.indexOf(path), parentOf = (p) => p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
  const chain = (i) => { const out = [i]; for (let p = recipe[i]; p !== ""; ) { p = parentOf(p); out.push(indexOf(p)); } return out; };
  const present = new Set(d.entries.map((e) => e.index));
  if (operation === "entry" && (d.entries.some((e) => !chain(Number(expected.argv[5])).includes(e.index))
    || d.missing.some((i) => i !== Number(expected.argv[5])))) refuse("observer_response");
  if (operation === "inventory") for (const e of d.entries) {
    if (e.index !== 0 && !present.has(indexOf(parentOf(recipe[e.index])))) refuse("observer_response");
    if (e.children) {
      const listed = recipe.map((p, i) => [p, i]).filter(([p, i]) => p !== "" && parentOf(p) === recipe[e.index] && present.has(i)).map(([p]) => p.slice(p.lastIndexOf("/") + 1));
      if (canonicalNames(e.children) !== canonicalNames(listed)) refuse("observer_response");
    }
  }
  if (BigInt(d.nodes) !== BigInt(d.entries.length + 3) || BigInt(d.work_bytes) < BigInt(d.content_bytes) + 65536n
    || d.ancestors.some((a) => a.proof.kind !== "directory" || a.proof.sha256 !== null)
    || BigInt(d.content_bytes) !== d.entries.filter((e) => e.proof.kind === "file").reduce((n, e) => n + 2n * BigInt(e.proof.size), 0n)) refuse("observer_response");
  const ids = [...d.ancestors.map((a) => `${a.proof.device}:${a.proof.inode}`), ...d.entries.map((e) => `${e.proof.device}:${e.proof.inode}`)];
  if (new Set(ids).size !== ids.length) refuse("observer_response");
  for (const e of d.entries) {
    if (e.proof.flags !== "0" || (e.proof.kind === "file" ? e.children !== null || e.proof.mode !== "33152" || e.proof.nlink !== "1" || e.proof.sha256 === null
      : e.children === null || e.proof.mode !== "16832" || e.proof.sha256 !== null)) refuse("observer_response");
    if (e.children && (new Set(e.children).size !== e.children.length || e.children.some((name) => !recipe.some((p) => p
      && p.slice(0, Math.max(0, p.lastIndexOf("/"))) === recipe[e.index] && p.slice(p.lastIndexOf("/") + 1) === name)))) refuse("observer_response");
  }
  if (operation === "anchor" || operation === "absence") {
    if (d.entries.length || d.missing.length || d.absent !== (operation === "absence")) refuse("observer_response");
  } else {
    if (d.absent) refuse("observer_response");
    if (operation === "inventory" && recipe.some((_, i) => !d.entries.some((e) => e.index === i) && !d.missing.includes(i))) refuse("observer_response");
    const index = Number(expected.argv[5]);
    if (operation === "entry" && !d.entries.some((e) => e.index === index) && !d.missing.includes(index)) refuse("observer_response");
  }
  return freeze({ ...flags(), supplied_observation: d });
}

export function createUnsignedOutputSummary() {
  let prefix = Buffer.alloc(0), total = 0n;
  const describe = () => freeze({ ...flags(), observed_bytes: String(total), prefix_bytes: prefix.length, overflow: total > 8192n,
    prefix_sha256: createHash("sha256").update(prefix).digest("hex"), complete_sha256: total <= 8192n ? createHash("sha256").update(prefix).digest("hex") : null });
  return Object.freeze({ push(input) {
    let n; try { n = size.call(input); if (![Buffer.prototype, Uint8Array.prototype].includes(Object.getPrototypeOf(input)) || n > 2097152) refuse("byte_bound"); }
    catch { refuse("byte_bound"); }
    if (total + BigInt(n) > 999999999999999999999999999999n) refuse("output_count_bound");
    const wanted = Math.min(n, 8192 - prefix.length), copy = Buffer.alloc(wanted);
    Uint8Array.prototype.set.call(copy, new Uint8Array(backing.call(input), byteOffset.call(input), wanted));
    prefix = Buffer.concat([prefix, copy]); total += BigInt(n); return describe();
  }, describe });
}
