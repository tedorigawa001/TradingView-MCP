import test from "node:test";
import assert from "node:assert/strict";
import { BOJ_POLICY_DECISIONS, collectBoJPolicyDecisionHistory } from "../../build/bojPolicyDecisionCollection.js";

const pdfArrayBuffer = () => new Uint8Array(Buffer.from("%PDF-1.7\n".padEnd(300, "x"))).buffer;

test("BoJ decision collector archives every primary document and preserves the QQE no-rate boundary", async () => {
  const rows = [];
  const snapshots = [];
  const archived = [];
  const result = await collectBoJPolicyDecisionHistory({
    now: new Date("2026-07-29T12:00:00.000Z"),
    store: {
      observeRawSnapshot: async (snapshot) => { snapshots.push(snapshot); return { recorded: true }; },
      observeMany: async (observations) => { rows.push(...observations); return { recorded: observations, unchanged: 0, revisions: 0 }; },
    },
    archive: { store: async (hash, body) => { archived.push({ hash, body }); return { stored: true, bytes: body.byteLength }; } },
    fetch: async () => ({ ok: true, status: 200, arrayBuffer: async () => pdfArrayBuffer(), headers: { get: () => null } }),
  });
  assert.equal(result.documents, BOJ_POLICY_DECISIONS.length);
  assert.equal(archived.length, BOJ_POLICY_DECISIONS.length);
  assert.equal(snapshots.length, BOJ_POLICY_DECISIONS.length);
  assert.equal(rows.length, BOJ_POLICY_DECISIONS.length);
  assert.deepEqual(rows.find((row) => row.observation_date === "2013-04-04"), {
    currency: "JPY", source_symbol: "ECONOMICS:JPINTR", observation_date: "2013-04-04", value: null,
    rate_status: "no_single_rate_target", source_url: "https://www.boj.or.jp/en/mopo/mpmdeci/mpr_2013/k130404a.pdf",
    source_vintage_at: null, raw_sha256: rows.find((candidate) => candidate.observation_date === "2013-04-04").raw_sha256,
    retrieved_at: "2026-07-29T12:00:00.000Z",
  });
});

test("BoJ decision collector fails before writing derived history when any primary document is absent", async () => {
  let writes = 0;
  await assert.rejects(collectBoJPolicyDecisionHistory({
    store: { observeRawSnapshot: async () => { writes += 1; }, observeMany: async () => { writes += 1; return { recorded: [], unchanged: 0, revisions: 0 }; } },
    archive: { store: async () => ({ stored: true, bytes: 300 }) },
    fetch: async (url) => url === BOJ_POLICY_DECISIONS[2].source_url
      ? { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0), headers: { get: () => null } }
      : { ok: true, status: 200, arrayBuffer: async () => pdfArrayBuffer(), headers: { get: () => null } },
  }), /returned HTTP 404/);
  assert.equal(writes, 0);
});
