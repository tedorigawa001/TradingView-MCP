import test from "node:test";
import assert from "node:assert/strict";
import { describeErrorChain } from "../../build/errorChain.js";

test("an error is described with its causes, outermost first (BACKLOG 102-30)", () => {
  const disk = Object.assign(new Error("ENOSPC: no space left on device, open '/x/cot.jsonl.lock'"), { code: "ENOSPC" });
  assert.equal(describeErrorChain(new Error("unable to acquire COT history lock", { cause: disk })),
    "unable to acquire COT history lock: ENOSPC: no space left on device, open '/x/cot.jsonl.lock'");
  assert.equal(describeErrorChain(new Error("a", { cause: new Error("b", { cause: new Error("c") }) })), "a: b: c");
  // A cause that is not an Error, or none, or a plain value thrown.
  assert.equal(describeErrorChain(new Error("a", { cause: "EIO" })), "a: EIO");
  assert.equal(describeErrorChain(new Error("a")), "a");
  assert.equal(describeErrorChain("thrown string"), "thrown string");
  // A message the chain already holds is not repeated, nor is an empty one.
  assert.equal(describeErrorChain(new Error("lock failed: EACCES", { cause: new Error("EACCES") })), "lock failed: EACCES");
  assert.equal(describeErrorChain(new Error("a", { cause: new Error("") })), "a");
  assert.equal(describeErrorChain(new Error("", { cause: new Error("EIO") })), "EIO");
});

test("the walk stops at a cycle and after a bounded depth", () => {
  const first = new Error("first");
  const second = new Error("second", { cause: first });
  first.cause = second;
  assert.equal(describeErrorChain(first), "first: second");
  let deep = new Error("e0");
  for (let index = 1; index < 20; index++) deep = new Error(`e${index}`, { cause: deep });
  assert.equal(describeErrorChain(deep), "e19: e18: e17: e16: e15: e14: e13: e12");
});
