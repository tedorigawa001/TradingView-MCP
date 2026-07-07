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
