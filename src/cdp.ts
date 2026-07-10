import WebSocket from "ws";
import { redactSecrets } from "./redact.js";

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
  constructor(detail: string) {
    super(
      `TradingView desktop app is not reachable via CDP (${detail}). ` +
        `Launch it with: open -a TradingView --args --remote-debugging-port=9222`,
    );
    this.name = "TradingViewNotAvailableError";
  }
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
          ` (${err instanceof Error ? err.message : String(err)})`,
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
      throw new TradingViewNotAvailableError(
        "no tradingview.com/chart page found among CDP targets",
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
    const ws = new WebSocket(target.webSocketDebuggerUrl, {
      maxPayload: 256 * 1024 * 1024,
    });
    const pending = new Map<
      number,
      { resolve: (msg: CdpMessage) => void; reject: (err: Error) => void }
    >();

    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString()) as CdpMessage;
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
