import assert from "node:assert/strict";
import test from "node:test";
import { assertExpectedResponseHost, readLimitedResponseBytes } from "../../build/boundedResponse.js";

test("bounded response reader stops a streamed body before it exceeds its limit", async () => {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2]));
      controller.enqueue(new Uint8Array([3, 4]));
      controller.close();
    },
  });
  await assert.rejects(
    () => readLimitedResponseBytes({ body, headers: { get: () => null } }, 3, "test response"),
    /test response response is too large/,
  );
});

test("bounded response reader rejects a redirect that changes the expected host", () => {
  assert.throws(
    () => assertExpectedResponseHost({ url: "https://untrusted.example/data", headers: { get: () => null } }, "https://official.example/data", "official source"),
    /official source response URL did not match the requested host/,
  );
});
