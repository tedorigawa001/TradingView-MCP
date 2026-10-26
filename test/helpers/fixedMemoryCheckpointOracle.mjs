import { createHash, createPrivateKey, sign } from "node:crypto";
import { z } from "zod";

const base = process.env.NATIVE_BAR_B3BC_ISOLATED_TEST === "1" ? "../../build/b3bc-validation/" : process.env.NATIVE_BAR_B3BB_ISOLATED_TEST === "1" ? "../../build/b3bb-validation/" : "../../build/";
const { claimFixedMemoryCheckpointOracleOwner } = await import(new URL(`${base}nativeBarAdmissionOracleRegistry.js`, import.meta.url));
const { checkpointProbeParse } = await import(new URL(`${base}nativeBarAdmissionCheckpointContracts.js`, import.meta.url));
const { canonical, nativeBarHash } = await import(new URL(`${base}nativeBarEvidence.js`, import.meta.url));
const wallNow = Date.now, HostDate = Date, iso = Date.prototype.toISOString;
const stateSchema = z.strictObject({ sequence: z.string().regex(/^[1-9][0-9]{0,29}$/), tip_hash: nativeBarHash });
const modeSchema = z.enum(["normal", "hold", "wrong_pin", "wrong_challenge", "outside_bracket", "bad_signature", "replay_previous",
  "hold_c1", "changed_tip_at_c1", "bad_signature_c1", "replay_at_c1", "defer_pull"]);
const optionsSchema = z.strictObject({ mode: modeSchema.optional() });
const publicSpki = "302a300506032b6570032100d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a";
const fingerprint = createHash("sha256").update(Buffer.from(publicSpki, "hex")).digest("hex");

// RFC 8032 section 7.1 test 1. Published test material only; no arbitrary key, signer, body, path or time input.
export function enrollFixedMemoryCheckpointOracle(originalOwnerGrant, inventedState, options = {}) {
  const channel = claimFixedMemoryCheckpointOracleOwner(originalOwnerGrant);
  let state, privateKey, known = true, closed = false, signed = 0n, generation = 1n, mode, held, replay;
  try {
    state = checkpointProbeParse(stateSchema, inventedState, 4096);
    mode = checkpointProbeParse(optionsSchema, options, 4096).mode ?? "normal";
    if (channel.fixed.pins.public_key_spki_sha256 !== fingerprint) throw Error("b3bb_public_test_key_required");
    if (state.sequence === "1" && state.tip_hash !== channel.fixed.pins.enrollment_hash) throw Error("b3bb_enrollment_tip");
    privateKey = createPrivateKey({ key: Buffer.from("302e020100300506032b6570042204209d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60", "hex"), type: "pkcs8", format: "der" });
    channel.activate();
  } catch (error) { channel.close(); throw error; }
  function close() {
    if (!closed) generation++; known = false; closed = true; privateKey = undefined;
    if (replay) replay.fill(0); replay = undefined; channel.close();
    if (held) { const packet = held; held = undefined; try { channel.reject(packet.token, "oracle_unavailable"); } catch { /* Already terminal. */ } }
  }
  function deliver(packet) {
    if (channel.cancelled(packet.token)) { channel.reject(packet.token, "oracle_cancelled"); return; }
    if (!known || closed) { channel.reject(packet.token, "oracle_unavailable"); return; }
    if (mode === "replay_previous" || mode === "replay_at_c1" && packet.request.phase === "c1") {
      if (replay) channel.respond(packet.token, Buffer.from(replay)); else channel.reject(packet.token, "oracle_unavailable"); return;
    }
    const wall = wallNow(); if (!Number.isSafeInteger(wall) || wall < 0 || wall > 253402300799999) throw Error("b3bb_clock");
    const { public_key_spki_sha256: _publicFingerprint, ...pins } = channel.fixed.pins;
    const envelope = { schema: "native-bar-signed-read-checkpoint-v1", scope: "synthetic_fixture_only", algorithm: "ed25519", ...pins,
      challenge: packet.request.challenge, sequence: state.sequence, tip_hash: state.tip_hash,
      observed_at: iso.call(new HostDate(mode === "outside_bracket" ? wall - 600001 : wall)) };
    if (mode === "wrong_pin") envelope.fixture_id = pins.store_id;
    if (mode === "wrong_challenge") envelope.challenge = pins.authority_id;
    if (mode === "changed_tip_at_c1" && packet.request.phase === "c1") envelope.tip_hash = (state.tip_hash[0] === "0" ? "1" : "0") + state.tip_hash.slice(1);
    let signature_hex = sign(null, Buffer.from(canonical({ domain: "native-bar-eb-read-checkpoint-v1", envelope })), privateKey).toString("hex");
    if (mode === "bad_signature" || mode === "bad_signature_c1" && packet.request.phase === "c1") signature_hex = (signature_hex[0] === "0" ? "1" : "0") + signature_hex.slice(1);
    const bytes = Buffer.from(canonical({ ...envelope, signature_hex }));
    if (bytes.length > 4096) throw Error("b3bb_checkpoint_bytes"); signed++;
    if (mode === "normal" || mode === "replay_at_c1") { if (replay) replay.fill(0); replay = Buffer.from(bytes); }
    channel.respond(packet.token, bytes);
  }
  function arm() {
    if (closed || !known || mode === "defer_pull") return;
    channel.next().then((packet) => {
      if (!packet) { close(); return; }
      try {
        if ((mode === "hold" || mode === "hold_c1" && packet.request.phase === "c1") && !channel.cancelled(packet.token) && known && !closed) { held = packet; return; }
        deliver(packet);
      } catch { try { channel.reject(packet.token, "oracle_unavailable"); } catch { /* Already terminal. */ } close(); }
      arm();
    }, () => close());
  }
  arm();
  return Object.freeze({ close, loseState: close, advance(input) {
    channel.check(); if (!known || closed) throw Error("b3bb_oracle_unavailable");
    const next = checkpointProbeParse(stateSchema, input, 4096);
    if (BigInt(next.sequence) <= BigInt(state.sequence)) throw Error("b3bb_state_not_advanced");
    channel.changed(); state = next; generation++;
    if (held && channel.cancelled(held.token)) { const packet = held; held = undefined; channel.reject(packet.token, "oracle_cancelled"); arm(); }
  }, setMode(input) {
    channel.check(); if (channel.busy()) throw Error("b3bb_owner_busy");
    const next = checkpointProbeParse(modeSchema, input, 4096);
    if (mode === "defer_pull" || next === "defer_pull") throw Error("b3bb_initial_mode_only");
    mode = next;
  }, completePending() {
    if (mode === "defer_pull") { mode = "normal"; arm(); return true; }
    if (!held) return false; const packet = held; held = undefined;
    try { deliver(packet); } catch { try { channel.reject(packet.token, "oracle_unavailable"); } catch { /* Already terminal. */ } close(); }
    arm(); return true;
  }, describe() {
    let live = known && !closed; try { channel.check(); } catch { live = false; }
    return { schema: "native-bar-fixed-memory-checkpoint-oracle-result-v1", scope: "synthetic_memory_oracle_only", generation: String(generation), mode,
    state_known: live, sequence: live ? state.sequence : null, tip_hash: live ? state.tip_hash : null, pending_request: !!held, replay_available: !!replay,
    signed_requests: String(signed), authority_state_verified: false, checkpoint_requests_verified: false, view_verified: false, execution_available: false }; } });
}
