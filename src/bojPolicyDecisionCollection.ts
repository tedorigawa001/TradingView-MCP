import { createHash } from "node:crypto";
import type { OfficialPolicyRateObservation, OfficialPolicyRateHistoryStore } from "./policyRateOfficialHistory.js";
import { OfficialPolicyRateRawArchive, resolvePolicyRateOfficialRawArchivePath } from "./policyRateOfficialRawArchive.js";

type BoJDecision = {
  observation_date: string;
  value: number | null;
  rate_status?: "no_single_rate_target";
  source_url: string;
};

export type BoJDecisionFetch = (url: string) => Promise<{
  ok: boolean;
  status: number;
  arrayBuffer: () => Promise<ArrayBuffer>;
  headers: { get(name: string): string | null };
}>;

// Each row is a policy-state change, not every meeting. Values and gap boundaries are reviewed
// against the linked primary decision. The 2013 QQE boundary intentionally prevents stale carry.
export const BOJ_POLICY_DECISIONS: readonly BoJDecision[] = [
  { observation_date: "2006-03-09", value: 0, source_url: "https://www.boj.or.jp/en/mopo/mpmdeci/mpr_2006/k060309.htm" },
  { observation_date: "2006-07-14", value: 0.25, source_url: "https://www.boj.or.jp/en/mopo/mpmsche_minu/minu_2006/g060714.pdf" },
  { observation_date: "2007-02-21", value: 0.5, source_url: "https://www.boj.or.jp/en/about/activities/act/data/ar0703.pdf" },
  { observation_date: "2008-10-31", value: 0.3, source_url: "https://www.boj.or.jp/en/mopo/mpmdeci/mpr_2008/k081031.pdf" },
  { observation_date: "2008-12-19", value: 0.1, source_url: "https://www.boj.or.jp/en/mopo/mpmdeci/mpr_2008/k081219.pdf" },
  { observation_date: "2010-10-05", value: 0.05, source_url: "https://www.boj.or.jp/en/mopo/mpmdeci/mpr_2010/k101005.pdf" },
  { observation_date: "2013-04-04", value: null, rate_status: "no_single_rate_target", source_url: "https://www.boj.or.jp/en/mopo/mpmdeci/mpr_2013/k130404a.pdf" },
  { observation_date: "2016-01-29", value: -0.1, source_url: "https://www.boj.or.jp/en/mopo/mpmdeci/mpr_2016/k160129a.pdf" },
  { observation_date: "2024-03-19", value: 0.05, source_url: "https://www.boj.or.jp/en/mopo/mpmdeci/state_2024/k240319a.htm" },
  { observation_date: "2024-07-31", value: 0.25, source_url: "https://www.boj.or.jp/en/mopo/mpmdeci/state_2024/k240731a.htm" },
  { observation_date: "2025-01-24", value: 0.5, source_url: "https://www.boj.or.jp/en/mopo/mpmdeci/mpr_2025/k250124a.pdf" },
  { observation_date: "2025-12-19", value: 0.75, source_url: "https://www.boj.or.jp/en/mopo/mpmdeci/mpr_2025/k251219a.pdf" },
];

/** Collect a reviewed BoJ decision manifest without conflating the realised call rate with policy. */
export async function collectBoJPolicyDecisionHistory(input: {
  store: Pick<OfficialPolicyRateHistoryStore, "observeMany" | "observeRawSnapshot">;
  archive?: Pick<OfficialPolicyRateRawArchive, "store">;
  fetch?: BoJDecisionFetch;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error("BoJ decision retrieval time must be valid");
  const retrievedAt = now.toISOString();
  const fetcher = input.fetch ?? fetch;
  const archive = input.archive ?? new OfficialPolicyRateRawArchive(resolvePolicyRateOfficialRawArchivePath());
  const observations: OfficialPolicyRateObservation[] = [];
  const rawSnapshots: Array<{ raw_sha256: string; raw_bytes: number; source_url: string }> = [];
  for (const decision of BOJ_POLICY_DECISIONS) {
    const response = await fetcher(decision.source_url);
    if (!response.ok) throw new Error(`BoJ decision source ${decision.observation_date} returned HTTP ${response.status}`);
    const body = Buffer.from(await response.arrayBuffer());
    assertBoJDecisionDocument(body, decision.observation_date);
    const rawSha256 = `sha256:${createHash("sha256").update(body).digest("hex")}`;
    await archive.store(rawSha256, body);
    rawSnapshots.push({ raw_sha256: rawSha256, raw_bytes: body.byteLength, source_url: decision.source_url });
    observations.push({
      currency: "JPY", source_symbol: "ECONOMICS:JPINTR", observation_date: decision.observation_date,
      value: decision.value, ...(decision.rate_status ? { rate_status: decision.rate_status } : {}), source_url: decision.source_url,
      source_vintage_at: toCanonicalTimestamp(response.headers.get("last-modified")), raw_sha256: rawSha256, retrieved_at: retrievedAt,
    });
  }
  // Snapshot every primary document before writing any derived state. A partial archive never becomes history.
  for (const raw of rawSnapshots) {
    await input.store.observeRawSnapshot({
      source_id: "boj_mpm_policy_decisions", source_url: raw.source_url, raw_sha256: raw.raw_sha256,
      source_observation_count: BOJ_POLICY_DECISIONS.length, source_first_observation_date: BOJ_POLICY_DECISIONS[0].observation_date,
      source_last_observation_date: BOJ_POLICY_DECISIONS.at(-1)!.observation_date, raw_bytes: raw.raw_bytes, retrieved_at: retrievedAt,
    });
  }
  const persisted = await input.store.observeMany(observations);
  return {
    source_id: "boj_mpm_policy_decisions", currency: "JPY" as const, retrieved_at: retrievedAt,
    documents: BOJ_POLICY_DECISIONS.length, numeric_observations: observations.filter((row) => row.value !== null).length,
    no_single_rate_target_boundaries: observations.filter((row) => row.value === null).length,
    first_seen: { recorded: persisted.recorded.length, unchanged: persisted.unchanged, revisions: persisted.revisions },
  };
}

function assertBoJDecisionDocument(body: Buffer, observationDate: string) {
  if (body.byteLength < 256 || body.byteLength > 32 * 1024 * 1024) throw new Error(`BoJ decision source ${observationDate} returned an unsafe payload size`);
  if (body.subarray(0, 5).equals(Buffer.from("%PDF-"))) return;
  const text = body.toString("utf8");
  if (!text.includes("Bank of Japan") || text.includes("Not Found")) throw new Error(`BoJ decision source ${observationDate} did not return a primary decision document`);
}

function toCanonicalTimestamp(value: string | null): string | null {
  if (value === null) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}
