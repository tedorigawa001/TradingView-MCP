import test from "node:test";
import assert from "node:assert/strict";
import { CdpClient, TradingViewNotAvailableError } from "../../build/cdp.js";
import { startMockCdp } from "./helpers/mock-cdp.mjs";

test("evaluate returns the value produced by the page", async (t) => {
  const mock = await startMockCdp({
    onCommand: (msg) =>
      msg.method === "Runtime.evaluate"
        ? { result: { result: { value: { symbol: "EURUSD" } } } }
        : { result: {} },
  });
  t.after(() => mock.close());

  const cdp = new CdpClient({ baseUrl: mock.baseUrl });
  t.after(() => cdp.close());
  const value = await cdp.evaluate("whatever()");
  assert.deepEqual(value, { symbol: "EURUSD" });
});

test("evaluate passes returnByValue and awaitPromise", async (t) => {
  const mock = await startMockCdp();
  t.after(() => mock.close());
  const cdp = new CdpClient({ baseUrl: mock.baseUrl });
  t.after(() => cdp.close());

  await cdp.evaluate("1+1");
  const evalMsg = mock.state.received.find((m) => m.method === "Runtime.evaluate");
  assert.equal(evalMsg.params.returnByValue, true);
  assert.equal(evalMsg.params.awaitPromise, true);
});

test("evaluate surfaces page exceptions as errors", async (t) => {
  const mock = await startMockCdp({
    onCommand: () => ({
      result: {
        exceptionDetails: { exception: { description: "ReferenceError: boom" } },
      },
    }),
  });
  t.after(() => mock.close());
  const cdp = new CdpClient({ baseUrl: mock.baseUrl });
  t.after(() => cdp.close());

  await assert.rejects(() => cdp.evaluate("boom()"), /ReferenceError: boom/);
});

test("send surfaces CDP protocol errors", async (t) => {
  const mock = await startMockCdp({
    onCommand: () => ({ error: { message: "Not allowed" } }),
  });
  t.after(() => mock.close());
  const cdp = new CdpClient({ baseUrl: mock.baseUrl });
  t.after(() => cdp.close());

  await assert.rejects(() => cdp.send("Page.navigate"), /Not allowed/);
});

test("screenshot returns base64 data and passes jpeg quality", async (t) => {
  const mock = await startMockCdp();
  t.after(() => mock.close());
  const cdp = new CdpClient({ baseUrl: mock.baseUrl });
  t.after(() => cdp.close());

  const data = await cdp.screenshot("jpeg");
  assert.equal(Buffer.from(data, "base64").toString(), "fake-image-bytes");
  const msg = mock.state.received.find((m) => m.method === "Page.captureScreenshot");
  assert.equal(msg.params.format, "jpeg");
  assert.equal(typeof msg.params.quality, "number");
});

test("screenshot forwards the clip region with a default scale", async (t) => {
  const mock = await startMockCdp();
  t.after(() => mock.close());
  const cdp = new CdpClient({ baseUrl: mock.baseUrl });
  t.after(() => cdp.close());

  await cdp.screenshot("jpeg", undefined, { x: 10, y: 20, width: 300, height: 200, scale: 2 });
  const msg = mock.state.received.find((m) => m.method === "Page.captureScreenshot");
  assert.deepEqual(msg.params.clip, { x: 10, y: 20, width: 300, height: 200, scale: 2 });

  await cdp.screenshot("png", undefined, { x: 0, y: 0, width: 100, height: 100 });
  const msg2 = mock.state.received.filter((m) => m.method === "Page.captureScreenshot")[1];
  assert.equal(msg2.params.clip.scale, 1, "scale defaults to 1");
});

test("commands time out when the page never responds", async (t) => {
  const mock = await startMockCdp({ onCommand: () => null }); // swallow commands
  t.after(() => mock.close());
  const cdp = new CdpClient({ baseUrl: mock.baseUrl, timeoutMs: 200 });
  t.after(() => cdp.close());

  await assert.rejects(() => cdp.evaluate("1"), /timed out after 200ms/);
});

test("fails clearly when CDP endpoint is unreachable", async (t) => {
  const cdp = new CdpClient({ baseUrl: "http://127.0.0.1:1" });
  t.after(() => cdp.close());
  await assert.rejects(
    () => cdp.evaluate("1"),
    TradingViewNotAvailableError,
  );
});

test("unreachable-endpoint errors never echo the CDP URL", async (t) => {
  // TV_CDP_URL may carry credentials or internal host names; the error the
  // MCP client sees must not contain any part of it.
  const cdp = new CdpClient({ baseUrl: "http://user:hunter2@10.11.12.13:1" });
  t.after(() => cdp.close());
  await assert.rejects(
    () => cdp.evaluate("1"),
    (err) => {
      assert.ok(err instanceof TradingViewNotAvailableError);
      assert.ok(!err.message.includes("hunter2"), "must not leak credentials");
      assert.ok(!err.message.includes("10.11.12.13"), "must not leak the host");
      assert.match(err.message, /TV_CDP_URL/, "must still point at the knob to fix");
      return true;
    },
  );
});

test("page exceptions are stripped of stack frames and URL secrets", async (t) => {
  const mock = await startMockCdp({
    onCommand: () => ({
      result: {
        exceptionDetails: {
          exception: {
            description:
              "Error: study st1 not found\n" +
              "    at run (https://user:pw@internal.corp/bundle.js?session=tok123:1:2)",
          },
        },
      },
    }),
  });
  t.after(() => mock.close());
  const cdp = new CdpClient({ baseUrl: mock.baseUrl });
  t.after(() => cdp.close());

  await assert.rejects(
    () => cdp.evaluate("x()"),
    (err) => {
      assert.match(err.message, /study st1 not found/, "the thrown message must survive");
      assert.ok(!err.message.includes("tok123"), "must not leak query tokens");
      assert.ok(!err.message.includes("internal.corp"), "must not leak stack-frame URLs");
      assert.ok(!err.message.includes("pw@"), "must not leak credentials");
      return true;
    },
  );
});

test("fails clearly when no chart page target exists", async (t) => {
  const mock = await startMockCdp({
    targets: [
      {
        type: "page",
        title: "settings",
        url: "file:///app/settings.html",
        webSocketDebuggerUrl: "ws://127.0.0.1:1/none",
      },
    ],
  });
  t.after(() => mock.close());
  const cdp = new CdpClient({ baseUrl: mock.baseUrl });
  t.after(() => cdp.close());

  await assert.rejects(
    () => cdp.evaluate("1"),
    /no tradingview.com\/chart page found/,
  );
});

test("concurrent calls on a cold client share one connection", async (t) => {
  const mock = await startMockCdp();
  t.after(() => mock.close());
  const cdp = new CdpClient({ baseUrl: mock.baseUrl });
  t.after(() => cdp.close());

  const results = await Promise.all([
    cdp.evaluate("1"),
    cdp.evaluate("2"),
    cdp.evaluate("3"),
  ]);
  assert.equal(results.length, 3);
  assert.equal(mock.state.connections, 1, "must not open one socket per caller");
});

test("a closing socket only rejects its own in-flight requests", async (t) => {
  // Handler that never responds to "hang", responds normally otherwise.
  const mock = await startMockCdp({
    onCommand: (msg, ws) => {
      if (msg.params?.expression === "hang") return null; // swallow, then we kill the socket
      return { result: { result: { value: "ok" } } };
    },
  });
  t.after(() => mock.close());
  const cdp = new CdpClient({ baseUrl: mock.baseUrl, timeoutMs: 5000 });
  t.after(() => cdp.close());

  const hanging = cdp.evaluate("hang");
  await new Promise((r) => setTimeout(r, 50));
  cdp.close(); // drops socket 1 — must reject only the hanging call

  const [hangResult, fresh] = await Promise.all([
    hanging.then(
      () => "resolved",
      (e) => e.message,
    ),
    cdp.evaluate("fresh"), // runs on socket 2
  ]);
  assert.match(hangResult, /connection closed/);
  assert.equal(fresh, "ok");
  assert.equal(mock.state.connections, 2);
});

test("reconnects after the connection drops", async (t) => {
  const mock = await startMockCdp();
  t.after(() => mock.close());
  const cdp = new CdpClient({ baseUrl: mock.baseUrl });
  t.after(() => cdp.close());

  await cdp.evaluate("first");
  cdp.close(); // simulate the connection dropping (app restart)
  await cdp.evaluate("second");
  assert.equal(mock.state.connections, 2);
});
