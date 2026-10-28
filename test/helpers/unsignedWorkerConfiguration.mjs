import { createHash } from "node:crypto";
import { z } from "zod";
import { describeUnsignedFixture, describeUnsignedAcceptanceRun } from "./jointUnsignedAcceptanceContracts.mjs";

const refuse = () => { throw Error("cc1b2_worker_configuration"); };
const uint = z.string().regex(/^(0|[1-9][0-9]{0,29})$/), hash = z.string().regex(/^[a-f0-9]{64}$/);
const uuid = z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
const canonical = (v) => Array.isArray(v) ? `[${v.map(canonical).join(",")}]` : v && typeof v === "object"
  ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}` : JSON.stringify(v);
const sha = (b) => createHash("sha256").update(b).digest("hex");
const proof = z.object({ device: uint, inode: uint, uid: uint, gid: uint, mode: uint, flags: uint, birthtime_ns: uint,
  acl: z.enum(["none", "deny_only"]), acl_hash: hash }).strict();
const directory = proof.extend({ mode: z.literal("16832"), flags: z.literal("0") }).strict();
const marker = proof.extend({ mode: z.literal("33152"), flags: z.literal("0"), nlink: z.literal("1"), size: uint, sha256: hash }).strict();
const bounded = (n) => uint.refine((v) => BigInt(v) <= BigInt(n));
const inventory = z.object({ entries: bounded(512), inventory_bytes: bounded(1073741824), metadata_bytes: bounded(16777216) }).strict();
const configuration = z.object({ schema: z.literal("native-bar-unsigned-worker-configuration-v1"),
  binding: z.object({ schema: z.literal("native-bar-joint-read-binding-v1"), scope: z.literal("synthetic_joint_read_model_only"), registration_hash: hash,
    registration: z.object({ schema: z.literal("native-bar-admission-read-registration-v1"), scope: z.literal("synthetic_fixture_only"),
      temp_anchor: z.literal("/private/tmp"), fixture_name: z.string().regex(/^native-bar-fs-synthetic-[A-Za-z0-9]{6}$/), policy_hash: hash, authority_reference: uuid,
      pins: z.object({ fixture_id: uuid, store_id: uuid, epoch_id: uuid, authority_id: uuid, key_id: uuid, enrollment_hash: hash, public_key_spki_sha256: hash }).strict(),
      bindings: z.object({ ancestors: z.array(z.object({ path: z.enum(["/", "/private", "/private/tmp"]), proof }).strict()).length(3),
        fixture_parent: directory, data: directory, witness: directory, markers: z.object({ base: marker, admission: marker }).strict() }).strict(),
      volume: z.object({ filesystem: z.literal("apfs"), local: z.literal(true), ownership_enforced: z.literal(true), case_preserving: z.literal(true),
        case_sensitive: z.boolean(), read_only_mount: z.literal(false) }).strict() }).strict() }).strict(),
  work_envelope: z.object({ schema: z.literal("native-bar-joint-read-work-envelope-v1"), inventory: z.object({ data: inventory, witness: inventory, common: inventory }).strict(),
    objects: z.object({ witness_records: bounded(512), producer_mirrors: bounded(512), payloads: bounded(512), receipts: bounded(512), maintenance_metadata: bounded(512) }).strict(),
    selected_bytes: bounded(16777216), decoded_bytes: bounded(16777216), interpretation_bytes: bounded(8388608) }).strict(),
}).strict();
function copy(input) {
  let nodes = 0, bytes = 0;
  const visit = (v, depth) => {
    if (++nodes > 8192 || depth > 16) refuse();
    if (v === null || typeof v === "boolean" || Number.isSafeInteger(v)) return v;
    if (typeof v === "string") { bytes += Buffer.byteLength(v); if (bytes > 131072) refuse(); return v; }
    if (!v || typeof v !== "object") refuse();
    const a = Array.isArray(v), proto = Object.getPrototypeOf(v), keys = Reflect.ownKeys(v);
    if (a ? proto !== Array.prototype || v.length > 32 || keys.length !== v.length + 1 : proto !== Object.prototype && proto !== null) refuse();
    if (keys.length > 64) refuse(); const out = a ? [] : Object.create(null);
    for (const k of keys) {
      if (a && k === "length") continue;
      if (typeof k !== "string" || ["__proto__", "prototype", "constructor"].includes(k) || a && (!/^(0|[1-9][0-9]*)$/.test(k) || Number(k) >= v.length)) refuse();
      bytes += Buffer.byteLength(k); if (bytes > 131072) refuse();
      const d = Object.getOwnPropertyDescriptor(v, k); if (!d?.enumerable || !("value" in d)) refuse();
      Object.defineProperty(out, k, { value: visit(d.value, depth + 1), enumerable: true });
    }
    return out;
  };
  return visit(input, 0);
}
const freeze = (v) => { if (v && typeof v === "object") { Object.values(v).forEach(freeze); Object.freeze(v); } return v; };
export function validateUnsignedWorkerConfiguration(input) {
  const q = z.object({ fixture: z.unknown(), registration_sha256: hash, envelope_sha256: hash, configuration }).strict().safeParse(copy(input));
  if (!q.success) refuse(); const d = q.data, c = d.configuration, r = c.binding.registration, e = c.work_envelope, recipe = describeUnsignedFixture(d.fixture);
  const planned = describeUnsignedAcceptanceRun(recipe.declaration.request).cases.find((v) => v.case_id === recipe.declaration.case_id && v.mode === recipe.declaration.mode);
  if (Buffer.byteLength(canonical(c)) > 60000 || sha(canonical(r)) !== d.registration_sha256 || c.binding.registration_hash !== d.registration_sha256
    || sha(canonical(e)) !== d.envelope_sha256 || r.fixture_name !== recipe.declaration.fixture_name
    || r.authority_reference !== recipe.declaration.ids.reference || r.policy_hash !== recipe.entries.find((v) => v.path === "store/policy.json").sha256) refuse();
  for (const [role, key] of [["fixture", "fixture_id"], ["store", "store_id"], ["epoch", "epoch_id"], ["authority", "authority_id"], ["key", "key_id"]])
    if (r.pins[key] !== recipe.declaration.ids[role]) refuse();
  const spki = "302a300506032b6570032100d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a";
  if (r.pins.public_key_spki_sha256 !== sha(Buffer.from(spki, "hex")) || r.bindings.ancestors.map((a) => a.path).join(",") !== "/,/private,/private/tmp") refuse();
  const roots = [r.bindings.fixture_parent, r.bindings.data, r.bindings.witness, ...Object.values(r.bindings.markers)], p = roots[0];
  if (roots.some((v) => v.uid !== p.uid || v.gid !== p.gid || v.device !== p.device)) refuse();
  const all = [...roots, ...r.bindings.ancestors.map((a) => a.proof)]; if (new Set(all.map((v) => `${v.device}:${v.inode}`)).size !== all.length) refuse();
  for (const a of r.bindings.ancestors) { const m = BigInt(a.proof.mode);
    if ((m & 61440n) !== 16384n || m > 65535n || !["0", p.uid].includes(a.proof.uid) || (m & 18n) !== 0n && (m & 512n) === 0n) refuse(); }
  for (const [key, path] of [["base", ".native-bar-fs-synthetic"], ["admission", ".native-bar-admission-synthetic"]]) {
    const known = recipe.entries.find((v) => v.path === path); if (r.bindings.markers[key].size !== known.size || r.bindings.markers[key].sha256 !== known.sha256) refuse();
  }
  if (e.objects.witness_records !== String(planned.witness_slots) || e.objects.maintenance_metadata !== String(planned.maintenance_slots)
    || ["producer_mirrors", "payloads", "receipts"].some((k) => e.objects[k] !== "0")
    || [e.selected_bytes, e.decoded_bytes, e.interpretation_bytes].includes("0")
    || Object.values(e.inventory).some((v) => BigInt(v.metadata_bytes) > BigInt(v.inventory_bytes))) refuse();
  return freeze({ schema: "native-bar-unsigned-worker-configuration-model-v1", configuration: c, supplied_binding_consistent: true,
    execution_available: false, native_status: "NOT_RUN", ownership_verified: false, signing_available: false });
}
