import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import { release } from "node:os";
import { z } from "zod";
import { noFollowFlag } from "./fsDurability.js";
import { researchEvidenceManifestSchema } from "./researchEvidenceComparison.js";
import { ResearchEvidenceError } from "./researchEvidenceErrors.js";

const axes = ["data", "code", "runner", "candidate_rule", "parameters"] as const;
const path = z.string().min(1).max(4096).refine(isAbsolute, "paths must be absolute");
const files = z.array(z.object({
  id: z.string().regex(/^[A-Za-z0-9_.:-]{1,120}$/), path,
}).strict()).min(1).max(20).refine(items => new Set(items.map(item => item.id)).size === items.length,
  "file IDs must be unique within each axis").optional();
export const researchEvidenceGenerationSchema = z.object({
  data: files, code: files, runner: files, candidate_rule: files, parameters: files,
  dependency_lockfile: path.optional(),
}).strict();

export const RESEARCH_EVIDENCE_MAX_FILE_BYTES = 128 * 1024 * 1024;
export const RESEARCH_EVIDENCE_MAX_TOTAL_BYTES = 512 * 1024 * 1024;
const recipe = "explicit_file_bytes_sha256_v1";
const sha = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
type Snapshot = { sha256: string; bytes: number; dev: bigint; ino: bigint; mtimeNs: bigint; ctimeNs: bigint };

async function fingerprint(filePath: string, budget: { bytes: number }): Promise<Snapshot> {
  try { return await fingerprintFile(filePath, budget); }
  catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT" || code === "ENOTDIR") throw new ResearchEvidenceError("EVIDENCE_INPUT_MISSING");
    if (code === "EACCES" || code === "EPERM") throw new ResearchEvidenceError("EVIDENCE_INPUT_ACCESS_DENIED");
    if (code === "ELOOP") throw new ResearchEvidenceError("EVIDENCE_INPUT_NOT_REGULAR");
    throw error;
  }
}

async function fingerprintFile(filePath: string, budget: { bytes: number }): Promise<Snapshot> {
  const before = await lstat(filePath, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink()) throw new ResearchEvidenceError("EVIDENCE_INPUT_NOT_REGULAR");
  const handle = await open(filePath, constants.O_RDONLY | noFollowFlag()
    | (process.platform === "win32" ? 0 : constants.O_NONBLOCK));
  try {
    const initial = await handle.stat({ bigint: true });
    if (!initial.isFile() || initial.dev !== before.dev || initial.ino !== before.ino
      || initial.size !== before.size || initial.mtimeNs !== before.mtimeNs || initial.ctimeNs !== before.ctimeNs) {
      throw new ResearchEvidenceError("EVIDENCE_INPUT_CHANGED");
    }
    if (initial.size > BigInt(RESEARCH_EVIDENCE_MAX_FILE_BYTES)) throw new ResearchEvidenceError("EVIDENCE_FILE_LIMIT");
    const digest = createHash("sha256");
    const buffer = Buffer.alloc(64 * 1024);
    let bytes = 0;
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      bytes += bytesRead;
      budget.bytes += bytesRead;
      if (bytes > RESEARCH_EVIDENCE_MAX_FILE_BYTES || budget.bytes > RESEARCH_EVIDENCE_MAX_TOTAL_BYTES) {
        throw new ResearchEvidenceError("EVIDENCE_BYTE_BUDGET");
      }
      digest.update(buffer.subarray(0, bytesRead));
    }
    const after = await handle.stat({ bigint: true });
    const named = await lstat(filePath, { bigint: true });
    for (const stat of [after, named]) {
      if (!stat.isFile() || stat.isSymbolicLink() || stat.dev !== initial.dev || stat.ino !== initial.ino
        || stat.size !== initial.size || stat.mtimeNs !== initial.mtimeNs || stat.ctimeNs !== initial.ctimeNs) {
        throw new ResearchEvidenceError("EVIDENCE_INPUT_CHANGED");
      }
    }
    if (BigInt(bytes) !== initial.size) throw new ResearchEvidenceError("EVIDENCE_INPUT_CHANGED");
    return { sha256: `sha256:${digest.digest("hex")}`, bytes,
      dev: initial.dev, ino: initial.ino, mtimeNs: initial.mtimeNs, ctimeNs: initial.ctimeNs };
  } finally { await handle.close(); }
}

export async function generateResearchEvidence(input: unknown) {
  const config = researchEvidenceGenerationSchema.parse(input);
  const selected = axes.flatMap(axis => (config[axis] ?? []).map(file => ({ axis, ...file })));
  const lock = config.dependency_lockfile;
  const sources = [...selected, ...(lock ? [{ axis: "environment" as const, id: "dependency_lockfile", path: lock }] : [])];
  const first: Snapshot[] = [];
  const budget = { bytes: 0 };
  for (const file of sources) first.push(await fingerprint(file.path, budget));
  const verificationBudget = { bytes: 0 };
  for (const [index, file] of sources.entries()) {
    const verified = await fingerprint(file.path, verificationBudget);
    if (Object.keys(verified).some(key => verified[key as keyof Snapshot] !== first[index][key as keyof Snapshot])) {
      throw new ResearchEvidenceError("EVIDENCE_INPUT_CHANGED");
    }
  }
  const descriptors = sources.map((file, index) => ({ axis: file.axis, id: file.id,
    sha256: first[index].sha256, bytes: first[index].bytes }));
  const environment = {
    node_version: process.version,
    versions: Object.fromEntries(Object.entries(process.versions).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)),
    platform: process.platform, architecture: process.arch, os_release: release(),
    dependency_lockfile: descriptors.find(file => file.axis === "environment") ?? null,
  };
  const manifest: Record<string, string | null> = {};
  for (const axis of axes) {
    const group = descriptors.filter(file => file.axis === axis).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    manifest[`${axis}_sha256`] = group.length ? sha(JSON.stringify({ recipe, axis, files: group })) : null;
  }
  manifest.environment_sha256 = lock ? sha(JSON.stringify({ recipe, environment })) : null;
  return {
    schema_version: "1.0", recipe, generated_at: new Date().toISOString(),
    manifest: researchEvidenceManifestSchema.parse(manifest),
    files: descriptors.sort((a, b) => a.axis < b.axis ? -1 : a.axis > b.axis ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    environment, candidateEligible: false, source_authenticated: false,
    limitations: ["only_explicit_files_hashed_no_dependency_discovery", "two_pass_observation_not_atomic_snapshot",
      "files_can_change_after_verification", "parent_directory_symlinks_and_same_user_races_not_fully_prevented",
      "environment_describes_this_node_process_not_a_past_or_remote_run",
      "lockfile_does_not_verify_installed_dependencies_or_execution_settings",
      "omitted_environment_variables_flags_and_external_dependencies_are_not_captured",
      "hashes_do_not_prove_execution_preregistration_or_statistical_calibration"],
  };
}
