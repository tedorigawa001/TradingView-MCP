import { createHash, createPublicKey } from "node:crypto";
const base = process.env.NATIVE_BAR_B3BC_ISOLATED_TEST === "1" ? "../../../build/b3bc-validation/" : process.env.NATIVE_BAR_B3BB_ISOLATED_TEST === "1" ? "../../../build/b3bb-validation/" : process.env.NATIVE_BAR_B3BA_ISOLATED_TEST === "1" ? "../../../build/b3ba-validation/" : "../../../build/";
const { canonical } = await import(new URL(`${base}nativeBarEvidence.js`, import.meta.url));

export const publicKey = () => createPublicKey({ key: Buffer.from("302a300506032b6570032100d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a", "hex"), type: "spki", format: "der" });
export const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hash = (s) => createHash("sha256").update(s).digest("hex");
export function binding(n = 1) {
  const p = (offset) => id(n * 100 + offset);
  const pins = { fixture_id: p(1), store_id: p(2), epoch_id: p(3), authority_id: p(4), key_id: p(5),
    enrollment_hash: hash("invented enrollment"), public_key_spki_sha256: hash(publicKey().export({ format: "der", type: "spki" })) };
  const proof = (inode, uid = "501", mode = "16832") => ({ device: "1", inode: String(n * 100 + inode), uid, gid: "20", mode,
    flags: "0", birthtime_ns: "1", acl: "none", acl_hash: hash("invented ACL") });
  const policy_hash = hash(canonical({ schema: "native-bar-synthetic-admission-profile-v6" }));
  const marker = { schema: "native-bar-admission-fixture-marker-v1", fixture_id: pins.fixture_id, store_id: pins.store_id,
    epoch_id: pins.epoch_id, policy_hash, data_root: "store", witness_root: "admission-witness" };
  const file = (inode, body) => ({ ...proof(inode, "501", "33152"), nlink: "1", size: String(Buffer.byteLength(body)), sha256: hash(body) });
  const registration = { schema: "native-bar-admission-read-registration-v1", scope: "synthetic_fixture_only", pins,
    authority_reference: p(6), temp_anchor: "/private/tmp", fixture_name: "native-bar-fs-synthetic-Ab123Z", policy_hash,
    bindings: { ancestors: [{ path: "/", proof: proof(10, "0", "16877") }, { path: "/private", proof: proof(11, "0", "16877") },
      { path: "/private/tmp", proof: proof(12, "0", "17407") }], fixture_parent: proof(13), data: proof(14), witness: proof(15),
      markers: { base: file(16, "synthetic-fixture-v1\n"), admission: file(17, canonical(marker)) } },
    volume: { filesystem: "apfs", local: true, ownership_enforced: true, case_preserving: true, case_sensitive: false, read_only_mount: false } };
  return { schema: "native-bar-checkpoint-oracle-binding-v1", scope: "synthetic_checkpoint_probe_only", registration,
    registration_hash: hash(canonical(registration)) };
}
