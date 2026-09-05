import { cdpPortInspectionRemedy, tradingViewLaunchRemedy } from "../../build/platformSupport.js";
import test from "node:test";
import assert from "node:assert/strict";
import { WebSocketServer } from "ws";
import { CdpClient, TradingViewNotAvailableError, assertDebuggerWebSocketUrl } from "../../build/cdp.js";
import { startMockCdp, defaultHandler } from "./helpers/mock-cdp.mjs";

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
  // MCP client sees must not contain any part of it, and the local stderr
  // log must mask credentials too (fetch errors can echo the full URL).
  const logged = [];
  const origError = console.error;
  console.error = (...args) => logged.push(args.join(" "));
  t.after(() => (console.error = origError));

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

  const log = logged.join("\n");
  assert.match(log, /CDP endpoint unreachable/, "the failure must be logged locally");
  assert.ok(!log.includes("hunter2"), "the local log must mask credentials too");
  assert.ok(log.includes("***@10.11.12.13"), "the log keeps the masked endpoint for diagnostics");
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
  const receivedDeadline = Date.now() + 2_000;
  while (!mock.state.received.some((msg) => msg.params?.expression === "hang")) {
    if (Date.now() >= receivedDeadline) assert.fail("hanging command was not received before the deadline");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
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

test("a port answered by something else names what replied instead of blaming the app", async (t) => {
  // What actually happened: the desktop app was running on 127.0.0.1 while another process held
  // [::1] on the same port, macOS resolved localhost to IPv6, and the error kept advising a
  // relaunch that could never help.
  const mock = await startMockCdp({
    targets: [
      { type: "page", url: "https://samurai-dash.web.app/daily-threads.html?token=secret", title: "", webSocketDebuggerUrl: "" },
      { type: "page", url: "https://samurai-dash.web.app/other.html", title: "", webSocketDebuggerUrl: "" },
    ],
  });
  t.after(() => mock.close());
  const cdp = new CdpClient({ baseUrl: mock.baseUrl });
  const error = await cdp.evaluate("1").then(() => null, (err) => err);
  assert.ok(error instanceof TradingViewNotAvailableError);
  assert.match(error.message, /2 CDP targets/);
  assert.match(error.message, /https:\/\/samurai-dash\.web\.app/);
  assert.match(error.message, /Something other than the desktop app is answering/);
  // The advice must name the port actually in use, not a hard-coded default, and
  // must be the advice for this host: the wording differs per platform, so
  // asserting the macOS text made this fail on every Linux and Windows runner.
  const port = new URL(mock.baseUrl).port;
  assert.ok(error.message.includes(cdpPortInspectionRemedy(port)),
    `expected this host's port advice naming ${port}, got: ${error.message}`);
  assert.match(error.message, new RegExp(port));
  // This endpoint is already IPv4, so the IPv6 explanation does not apply and is withheld.
  assert.doesNotMatch(error.message, /IPv6/);
  // Origins only: a query string from whatever the other process has open must not travel.
  assert.doesNotMatch(error.message, /token=secret/);
  assert.doesNotMatch(error.message, /daily-threads/);
  // The relaunch advice is wrong here and must not be offered, on any host.
  assert.ok(!error.message.includes(tradingViewLaunchRemedy()),
    "a port answered by another process must not suggest relaunching the app");
});

test("an endpoint with no pages at all still advises launching the app", async (t) => {
  const mock = await startMockCdp({ targets: [] });
  t.after(() => mock.close());
  const cdp = new CdpClient({ baseUrl: mock.baseUrl });
  const error = await cdp.evaluate("1").then(() => null, (err) => err);
  assert.ok(error instanceof TradingViewNotAvailableError);
  assert.match(error.message, /returned no page targets/);
  assert.ok(error.message.includes(tradingViewLaunchRemedy()),
    `expected this host's launch advice, got: ${error.message}`);
});

// --- the socket the client actually opens, not just the page it checked ---

test("refuses a chart target whose debugger socket points off the CDP endpoint", async (t) => {
  // findChartTarget validates the page URL, so this target passes that check with a real
  // tradingview.com/chart URL. What it advertises as its socket is a different listener
  // entirely — everything the client then sends, Pine source and alert payloads included,
  // would leave for a host of the endpoint's choosing.
  const elsewhere = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise((resolve) => elsewhere.on("listening", resolve));
  let elsewhereConnections = 0;
  elsewhere.on("connection", () => { elsewhereConnections += 1; });
  // close() alone waits on live clients forever, which would hang this file rather than
  // fail it the day the check is removed.
  t.after(() => new Promise((resolve) => {
    for (const client of elsewhere.clients) client.terminate();
    elsewhere.close(resolve);
  }));

  const mock = await startMockCdp({
    targets: [{
      type: "page",
      title: "chart",
      url: "https://www.tradingview.com/chart/abc/",
      webSocketDebuggerUrl: `ws://127.0.0.1:${elsewhere.address().port}/devtools/page/X?tok=secret`,
    }],
  });
  t.after(() => mock.close());
  // A short timeout so removing the check fails this test promptly instead of parking on
  // the socket it should never have opened.
  const cdp = new CdpClient({ baseUrl: mock.baseUrl, timeoutMs: 500 });
  t.after(() => cdp.close());

  const error = await cdp.evaluate("1").then(() => null, (err) => err);
  assert.ok(error instanceof TradingViewNotAvailableError, `expected a refusal, got: ${error}`);
  assert.match(error.message, /webSocketDebuggerUrl points somewhere other than/);
  assert.equal(elsewhereConnections, 0, "the client must not have opened the advertised socket");
  // The advertised URL is attacker-shaped by assumption and may carry a query string.
  assert.doesNotMatch(error.message, /tok=secret/);
});

test("refuses a debugger socket that is not a WebSocket URL", async (t) => {
  const mock = await startMockCdp({
    targets: [{
      type: "page",
      title: "chart",
      url: "https://www.tradingview.com/chart/abc/",
      webSocketDebuggerUrl: "https://www.tradingview.com/chart/abc/",
    }],
  });
  t.after(() => mock.close());
  const cdp = new CdpClient({ baseUrl: mock.baseUrl });
  t.after(() => cdp.close());

  await assert.rejects(() => cdp.evaluate("1"), /not a WebSocket URL/);
});

test("loopback spellings of the same machine stay interchangeable", () => {
  // Chrome answers with whatever Host it was asked on, so a working setup must keep
  // working: these all name this host.
  for (const [socket, endpoint] of [
    ["ws://localhost:9222/devtools/page/A", "http://127.0.0.1:9222"],
    ["ws://127.0.0.1:9222/devtools/page/A", "http://localhost:9222"],
    ["ws://[::1]:9222/devtools/page/A", "http://localhost:9222"],
  ]) {
    assert.equal(assertDebuggerWebSocketUrl(socket, endpoint), new URL(socket).href);
  }
  // A different port on this host is still a different listener.
  assert.throws(() => assertDebuggerWebSocketUrl("ws://127.0.0.1:9333/x", "http://127.0.0.1:9222"),
    TradingViewNotAvailableError);
  // And an off-host destination is the case that matters.
  assert.throws(() => assertDebuggerWebSocketUrl("ws://attacker.example:9222/x", "http://127.0.0.1:9222"),
    TradingViewNotAvailableError);
  assert.throws(() => assertDebuggerWebSocketUrl("not a url", "http://127.0.0.1:9222"),
    TradingViewNotAvailableError);
});

test("a frame that is not JSON is dropped instead of killing the process", async (t) => {
  // The message handler is synchronous, so a throw inside it is an unhandled listener
  // exception and the server exits — there is no uncaughtException handler anywhere.
  let misbehaved = false;
  const mock = await startMockCdp({
    onCommand: (msg, ws) => {
      if (misbehaved) return defaultHandler(msg);
      misbehaved = true;
      ws.send("this is not json");
      ws.send("null"); // valid JSON, but not a message object
      return null;
    },
  });
  t.after(() => mock.close());
  const cdp = new CdpClient({ baseUrl: mock.baseUrl, timeoutMs: 300 });
  t.after(() => cdp.close());

  await assert.rejects(() => cdp.evaluate("1"), /timed out after 300ms/);
  // Still alive, and still able to serve the next call once the peer behaves.
  const recovered = await cdp.evaluate("2");
  assert.deepEqual(recovered, { echo: "2" });
});
