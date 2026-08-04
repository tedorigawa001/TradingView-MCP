import test from "node:test";
import assert from "node:assert/strict";
import {
  VOLUME_PROFILE_CONTEXT_NAME,
  VOLUME_PROFILE_CONTEXT_PLOTS,
  assertVolumeProfileContextStudy,
  parseVolumeProfileContext,
} from "../../build/volumeProfileContext.js";

const inputs = [{
  id: "vp",
  name: VOLUME_PROFILE_CONTEXT_NAME,
  title: VOLUME_PROFILE_CONTEXT_NAME,
  inputs: [
    { id: "in_0", name: "Rows", value: 24 },
    { id: "in_1", name: "Value Area %", value: 70 },
    { id: "in_2", name: "Volume Type", value: "exchange_reported_volume" },
    { id: "in_3", name: "Maximum Session Bars", value: 500 },
  ],
}];

function values(overrides = {}) {
  return [{
    id: "vp",
    name: VOLUME_PROFILE_CONTEXT_NAME,
    plots: VOLUME_PROFILE_CONTEXT_PLOTS.map((title) => ({ id: title, title, type: "line" })),
    bars: [{
      time: 1_720_000_000,
      values: {
        "Prior POC": 1.084,
        "Prior VAH": 1.09,
        "Prior VAL": 1.08,
        "Profile Start": 1_720_000_000_000,
        "Profile End": 1_720_086_400_000,
        "Trading Day": 1_720_051_200_000,
        "Profile Complete": 1,
        "Bars Included": 96,
        ...overrides,
      },
    }],
  }];
}

test("volume-profile context accepts only ordered levels from a completed profile", () => {
  const study = assertVolumeProfileContextStudy(inputs, "vp");
  const result = parseVolumeProfileContext(study, values());
  assert.equal(result.status, "ready");
  assert.deepEqual(result.levels, { poc: 1.084, vah: 1.09, val: 1.08 });
  assert.equal(result.profile.rows, 24);
  assert.equal(result.profile.valueAreaPercent, 70);
  assert.equal(result.profile.barsIncluded, 96);
  assert.deepEqual(result.qualityIssues, []);
});

test("volume-profile context reports an uncompleted profile without inventing levels", () => {
  const study = assertVolumeProfileContextStudy(inputs, "vp");
  const result = parseVolumeProfileContext(study, values({ "Prior POC": null }));
  assert.equal(result.status, "unavailable");
  assert.equal(result.levels, null);
  assert.ok(result.qualityIssues.includes("no_completed_session_profile"));
});

test("volume-profile context refuses a profile whose session-bar capacity was exhausted", () => {
  const study = assertVolumeProfileContextStudy(inputs, "vp");
  const result = parseVolumeProfileContext(study, values({ "Profile Complete": 0 }));
  assert.equal(result.status, "unavailable");
  assert.equal(result.levels, null);
  assert.ok(result.qualityIssues.includes("profile_is_incomplete_or_truncated"));
});

test("volume-profile context rejects invalid level ordering and undeclared volume types", () => {
  const study = assertVolumeProfileContextStudy(inputs, "vp");
  assert.throws(
    () => parseVolumeProfileContext(study, values({ "Prior POC": 1.07 })),
    /VAL <= POC <= VAH/,
  );
  const undeclared = structuredClone(inputs);
  undeclared[0].inputs[2].value = "unknown";
  const result = parseVolumeProfileContext(assertVolumeProfileContextStudy(undeclared, "vp"), values());
  assert.ok(result.qualityIssues.includes("volume_type_not_declared"));
});

test("volume-profile context refuses malformed input contracts and timestamp windows", () => {
  const malformed = structuredClone(inputs);
  malformed[0].inputs[1].name = "Value Area";
  assert.throws(
    () => assertVolumeProfileContextStudy(malformed, "vp"),
    /does not match volume-profile input contract/,
  );
  const study = assertVolumeProfileContextStudy(inputs, "vp");
  assert.throws(
    () => parseVolumeProfileContext(study, values({ "Profile End": 1_720_000_000_000 })),
    /Profile Start must precede Profile End/,
  );
});
