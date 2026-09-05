import WebSocket from "ws";
import { redactSecrets } from "./redact.js";
import { cdpPortInspectionRemedy, tradingViewLaunchRemedy } from "./platformSupport.js";

export interface CdpClientOptions {
  /** CDP HTTP endpoint, e.g. http://localhost:9222 */
  baseUrl?: string;
  /** Per-command timeout in ms */
  timeoutMs?: number;
}

interface CdpTarget {
  type: string;
  url: string;
  title: string;
  webSocketDebuggerUrl: string;
}

interface CdpMessage {
  id?: number;
  result?: Record<string, unknown>;
  error?: { message: string };
}

interface Connection {
  ws: WebSocket;
  pending: Map<
    number,
    { resolve: (msg: CdpMessage) => void; reject: (err: Error) => void }
  >;
}

export class TradingViewNotAvailableError extends Error {
  /**
   * `remedy` replaces the launch instruction. Telling someone to start the app is wrong, and
   * costs real time, when the app is already running and something else answered on its port.
   */
  constructor(detail: string, remedy = tradingViewLaunchRemedy()) {
    super(`TradingView desktop app is not reachable via CDP (${detail}). ${remedy}`);
    this.name = "TradingViewNotAvailableError";
  }
}

/**
 * `localhost`, `127.0.0.1` and `[::1]` name the same machine, and which of them the
 * endpoint echoes back is not ours to decide — Chrome answers with whatever Host it was
 * asked on. Treating them as interchangeable keeps a working setup working; it does not
 * widen the check, because all three stay on this host.
 */
const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

const defaultPort = (protocol: string): string =>
  protocol === "wss:" || protocol === "https:" ? "443" : "80";

/**
 * The `/json` response is whatever answered the CDP port, so `webSocketDebuggerUrl` is
 * untrusted input. `findChartTarget` validates the *page* URL, but the socket opened next
 * is a separate address that nothing checked: an endpoint that squats the port can pass
 * the page check with a genuine-looking tradingview.com/chart URL and still point the
 * debugger session at a host of its choosing, carrying everything sent over it — Pine
 * source, alert payloads — off this machine. That defeats the operational rule of opening
 * the debug port only while the server is in use, since a closed port is exactly what
 * another process is free to take.
 */
export function assertDebuggerWebSocketUrl(candidate: string, baseUrl: string): string {
  let socket: URL;
  try {
    socket = new URL(candidate);
  } catch {
    throw new TradingViewNotAvailableError(
      "the chart target did not supply a usable webSocketDebuggerUrl",
    );
  }
  if (socket.protocol !== "ws:" && socket.protocol !== "wss:") {
    throw new TradingViewNotAvailableError(
      "the chart target's webSocketDebuggerUrl is not a WebSocket URL",
    );
  }
  // The candidate is never echoed: it is attacker-shaped by assumption and may carry a
  // query string of its own.
  const endpoint = new URL(baseUrl);
  const sameHost =
    socket.hostname === endpoint.hostname ||
    (LOOPBACK_HOSTNAMES.has(socket.hostname) && LOOPBACK_HOSTNAMES.has(endpoint.hostname));
  const samePort =
    (socket.port || defaultPort(socket.protocol)) === (endpoint.port || defaultPort(endpoint.protocol));
  if (!sameHost || !samePort) {
    throw new TradingViewNotAvailableError(
      "the chart target's webSocketDebuggerUrl points somewhere other than the CDP endpoint itself",
    );
  }
  return socket.href;
}

/**
 * Minimal CDP client bound to the TradingView chart page.
 * Connects lazily and reconnects automatically if the app restarts.
 */
export class CdpClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private conn: Connection | null = null;
  private connecting: Promise<Connection> | null = null;
  private nextId = 1;

  constructor(options: CdpClientOptions = {}) {
    this.baseUrl =
      options.baseUrl ?? process.env.TV_CDP_URL ?? "http://localhost:9222";
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  private async findChartTarget(): Promise<CdpTarget> {
    let targets: CdpTarget[];
    try {
      const res = await fetch(`${this.baseUrl}/json`);
      targets = (await res.json()) as CdpTarget[];
    } catch (err) {
      // The endpoint URL may carry credentials or internal host names (via
      // TV_CDP_URL) — keep it out of the client-facing error, log it here.
      console.error(
        `[tradingview-mcp] CDP endpoint unreachable: ${redactSecrets(this.baseUrl)}` +
          ` (${redactSecrets(err instanceof Error ? err.message : String(err))})`,
      );
      throw new TradingViewNotAvailableError(
        "cannot reach the CDP endpoint configured via TV_CDP_URL",
      );
    }
    const chart = targets.find((t) => {
      if (t.type !== "page") return false;
      try {
        const u = new URL(t.url);
        return (
          u.protocol === "https:" &&
          (u.hostname === "tradingview.com" || u.hostname.endsWith(".tradingview.com")) &&
          u.pathname.startsWith("/chart")
        );
      } catch {
        return false;
      }
    });
    if (!chart) {
      // Origins only. A target URL carries whatever the answering browser has open, including
      // query strings, and this message reaches the client.
      const origins = [...new Set(targets
        .filter((t) => t.type === "page")
        .map((t) => { try { return new URL(t.url).origin; } catch { return null; } })
        .filter((origin): origin is string => origin !== null))].sort();
      const answered = origins.length === 0
        ? "it returned no page targets"
        : `its open page origins are ${origins.slice(0, 5).join(", ")}`;
      // The endpoint answering with unrelated pages means something other than the desktop app is
      // listening. On macOS localhost resolves to IPv6 first, so a second process bound to [::1]
      // on the same port answers while the app sits on 127.0.0.1 and is never consulted.
      const collided = origins.length > 0;
      const localhost = /^https?:\/\/localhost(:|\/|$)/i.test(this.baseUrl);
      const port = (() => { try { return new URL(this.baseUrl).port || "9222"; } catch { return "9222"; } })();
      // Naming the port is useful either way. The IPv6 explanation only applies to a localhost
      // endpoint, where the name resolves to [::1] first and can reach a different listener.
      const remedy = collided
        ? cdpPortInspectionRemedy(port)
          + (localhost
            ? ` If localhost resolves to another listener while the app sits on 127.0.0.1, set TV_CDP_URL=http://127.0.0.1:${port} to reach it.`
            : "")
        : undefined;
      throw new TradingViewNotAvailableError(
        `no tradingview.com/chart page found among ${targets.length} CDP targets at ${redactSecrets(this.baseUrl)}; ${answered}`,
        remedy,
      );
    }
    return chart;
  }

  /**
   * Establish a fresh connection. Each connection owns its pending map, so a
   * closing socket only rejects its own in-flight requests — never those of
   * a newer connection.
   */
  private async connect(): Promise<Connection> {
    const target = await this.findChartTarget();
    const socketUrl = assertDebuggerWebSocketUrl(target.webSocketDebuggerUrl, this.baseUrl);
    const ws = new WebSocket(socketUrl, {
      maxPayload: 256 * 1024 * 1024,
    });
    const pending = new Map<
      number,
      { resolve: (msg: CdpMessage) => void; reject: (err: Error) => void }
    >();

    ws.on("message", (data) => {
      // This handler is synchronous, so a throw here is an unhandled listener exception
      // and the process exits — there is no uncaughtException handler. A frame that is
      // not JSON is not a reply to anything we sent, so drop it and let the request it
      // would have answered fail on its own timeout.
      let msg: CdpMessage;
      try {
        const parsed: unknown = JSON.parse(data.toString());
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("frame is not a CDP message object");
        }
        msg = parsed as CdpMessage;
      } catch (err) {
        console.error(
          `[tradingview-mcp] ignoring unparsable CDP frame: ` +
            redactSecrets(err instanceof Error ? err.message : String(err)),
        );
        return;
      }
      if (msg.id !== undefined && pending.has(msg.id)) {
        pending.get(msg.id)!.resolve(msg);
        pending.delete(msg.id);
      }
    });
    ws.on("close", () => {
      for (const { reject } of pending.values()) {
        reject(new Error("CDP connection closed"));
      }
      pending.clear();
      if (this.conn?.ws === ws) this.conn = null;
    });
    ws.on("error", () => {
      /* surfaced via close */
    });

    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", (err) =>
        reject(new TradingViewNotAvailableError(String(err))),
      );
    });

    const conn: Connection = { ws, pending };
    this.conn = conn;
    return conn;
  }

  /** Single-flight: concurrent callers share one connection attempt. */
  private ensureConnected(): Promise<Connection> {
    if (this.conn && this.conn.ws.readyState === WebSocket.OPEN) {
      return Promise.resolve(this.conn);
    }
    if (!this.connecting) {
      this.connecting = this.connect().finally(() => {
        this.connecting = null;
      });
    }
    return this.connecting;
  }

  async send(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    const { ws, pending } = await this.ensureConnected();
    const id = this.nextId++;
    const msg = await new Promise<CdpMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(
          new Error(`CDP call ${method} timed out after ${this.timeoutMs}ms`),
        );
      }, this.timeoutMs);
      pending.set(id, {
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      ws.send(JSON.stringify({ id, method, params }));
    });
    if (msg.error) throw new Error(`CDP ${method}: ${msg.error.message}`);
    return msg.result ?? {};
  }

  /**
   * Evaluate a JS expression in the chart page. The expression must produce
   * a JSON-serializable value (promises are awaited).
   */
  async evaluate<T>(expression: string): Promise<T> {
    const result = (await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })) as {
      result?: { value?: T };
      exceptionDetails?: { text?: string; exception?: { description?: string } };
    };
    if (result.exceptionDetails) {
      const detail =
        result.exceptionDetails.exception?.description ??
        result.exceptionDetails.text ??
        "unknown page error";
      // Keep the thrown message but drop the page stack frames — their
      // script URLs can carry session tokens — and redact what remains.
      const message = redactSecrets(detail.split(/\n\s+at /)[0]);
      if (message !== detail) {
        console.error(`[tradingview-mcp] page exception: ${redactSecrets(detail)}`);
      }
      throw new Error(`Page evaluation failed: ${message}`);
    }
    return result.result?.value as T;
  }

  /**
   * Capture a screenshot of the chart window, optionally clipped to a region
   * (CSS pixels; scale multiplies the output resolution, e.g. devicePixelRatio
   * for a retina-sharp crop). Returns base64 image data.
   */
  async screenshot(
    format: "png" | "jpeg" = "png",
    quality?: number,
    clip?: { x: number; y: number; width: number; height: number; scale?: number },
  ): Promise<string> {
    const params: Record<string, unknown> = { format };
    if (format === "jpeg") params.quality = quality ?? 80;
    if (clip) params.clip = { scale: 1, ...clip };
    const result = (await this.send("Page.captureScreenshot", params)) as {
      data?: string;
    };
    if (!result.data) throw new Error("Page.captureScreenshot returned no data");
    return result.data;
  }

  close(): void {
    this.conn?.ws.close();
    this.conn = null;
  }
}
