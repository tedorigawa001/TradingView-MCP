// A fake CDP endpoint: HTTP /json target listing + WebSocket command handler.
// Mimics the surface the TradingView desktop app exposes on port 9222.
import http from "node:http";
import { WebSocketServer } from "ws";

export async function startMockCdp({
  targets,
  onCommand,
} = {}) {
  const server = http.createServer();
  const wss = new WebSocketServer({ server, path: "/page" });
  const state = { connections: 0, received: [] };

  wss.on("connection", (ws) => {
    state.connections++;
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      state.received.push(msg);
      const reply = onCommand ? onCommand(msg, ws) : defaultHandler(msg);
      if (reply !== null && reply !== undefined) {
        ws.send(JSON.stringify({ id: msg.id, ...reply }));
      }
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  server.on("request", () => {}); // requests handled below via explicit listener
  server.removeAllListeners("request");
  server.on("request", (req, res) => {
    if (req.url === "/json") {
      const list = targets ?? [
        {
          type: "page",
          title: "chart",
          url: "https://www.tradingview.com/chart/abc/",
          webSocketDebuggerUrl: `ws://127.0.0.1:${port}/page`,
        },
      ];
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(list));
    } else {
      res.statusCode = 404;
      res.end();
    }
  });

  return {
    baseUrl,
    port,
    state,
    close: () =>
      new Promise((resolve) => {
        for (const client of wss.clients) client.terminate();
        wss.close(() => server.close(resolve));
      }),
  };
}

export function defaultHandler(msg) {
  if (msg.method === "Runtime.evaluate") {
    return { result: { result: { value: { echo: msg.params.expression } } } };
  }
  if (msg.method === "Page.captureScreenshot") {
    return { result: { data: Buffer.from("fake-image-bytes").toString("base64") } };
  }
  return { result: {} };
}
