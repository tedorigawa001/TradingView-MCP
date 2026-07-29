import test from "node:test";
import assert from "node:assert/strict";
import { parseOfficialPolicyRateCollectionCliArguments } from "../../build/officialPolicyRateCollectionCli.js";

test("official policy-rate collection requires explicit exploratory consent", () => {
  assert.throws(() => parseOfficialPolicyRateCollectionCliArguments([]), /confirm-exploratory-import/);
  assert.deepEqual(parseOfficialPolicyRateCollectionCliArguments(["--source", "ecb_deposit_facility", "--confirm-exploratory-import"]), { sourceId: "ecb_deposit_facility", confirmed: true });
  assert.deepEqual(parseOfficialPolicyRateCollectionCliArguments(["--source", "boc_target_overnight_rate", "--confirm-exploratory-import"]), { sourceId: "boc_target_overnight_rate", confirmed: true });
  assert.deepEqual(parseOfficialPolicyRateCollectionCliArguments(["--source", "fred_fed_target_range_midpoint", "--confirm-exploratory-import"]), { sourceId: "fred_fed_target_range_midpoint", confirmed: true });
  assert.deepEqual(parseOfficialPolicyRateCollectionCliArguments(["--source", "rba_cash_rate_target", "--confirm-exploratory-import"]), { sourceId: "rba_cash_rate_target", confirmed: true });
  assert.deepEqual(parseOfficialPolicyRateCollectionCliArguments(["--source", "snb_policy_rate_or_libor_target_midpoint", "--confirm-exploratory-import"]), { sourceId: "snb_policy_rate_or_libor_target_midpoint", confirmed: true });
  assert.deepEqual(parseOfficialPolicyRateCollectionCliArguments(["--source", "boj_mpm_policy_decisions", "--confirm-exploratory-import"]), { sourceId: "boj_mpm_policy_decisions", confirmed: true });
  assert.throws(() => parseOfficialPolicyRateCollectionCliArguments(["--source", "unknown", "--confirm-exploratory-import"]), /unsupported/);
});
