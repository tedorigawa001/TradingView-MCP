import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, symlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OfficialPolicyRateRawArchive } from "../../build/policyRateOfficialRawArchive.js";

const raw = "KEY,TIME_PERIOD,OBS_VALUE\nFM.D.U2.EUR.4F.KR.DFR.LEV,2025-01-01,3\n";
const hash = `sha256:${createHash("sha256").update(raw, "utf8").digest("hex")}`;

test("official raw archive writes content-addressed owner-only evidence and verifies reuse", async () => {
  const directory = join(await mkdtemp(join(tmpdir(), "tv-mcp-policy-rate-raw-")), "archive");
  const archive = new OfficialPolicyRateRawArchive(directory);
  assert.deepEqual(await archive.store(hash, raw), { stored: true, bytes: Buffer.byteLength(raw, "utf8") });
  assert.equal(await readFile(join(directory, `${hash.slice(7)}.raw`), "utf8"), raw);
  assert.deepEqual(await archive.store(hash, raw), { stored: false, bytes: Buffer.byteLength(raw, "utf8") });
});

test("official raw archive refuses a mismatched hash and unsafe existing symlink", async () => {
  const directory = join(await mkdtemp(join(tmpdir(), "tv-mcp-policy-rate-raw-")), "archive");
  const archive = new OfficialPolicyRateRawArchive(directory);
  await assert.rejects(archive.store("sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", raw), /does not match/);
  await archive.store(hash, raw);
  const raw2 = `${raw}next\n`;
  const hash2 = `sha256:${createHash("sha256").update(raw2, "utf8").digest("hex")}`;
  const other = join(await mkdtemp(join(tmpdir(), "tv-mcp-policy-rate-raw-other-")), "other.raw");
  await symlink(other, join(directory, `${hash2.slice(7)}.raw`));
  await assert.rejects(archive.store(hash2, raw2), /unable to write|unsafe|regular/);
});

test("official raw archive preserves binary PDF evidence without text decoding", async () => {
  const directory = join(await mkdtemp(join(tmpdir(), "tv-mcp-policy-rate-raw-")), "archive");
  const archive = new OfficialPolicyRateRawArchive(directory);
  const pdf = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x0a, 0xff, 0x00]);
  const pdfHash = `sha256:${createHash("sha256").update(pdf).digest("hex")}`;
  await archive.store(pdfHash, pdf);
  assert.deepEqual(await readFile(join(directory, `${pdfHash.slice(7)}.raw`)), pdf);
});
