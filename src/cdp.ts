import WebSocket from "ws";

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
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (msg: CdpMessage) => void; reject: (err: Error) => void }
  >();

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
    } catch {
      throw new TradingViewNotAvailableError(`cannot reach ${this.baseUrl}`);
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

  private async ensureConnected(): Promise<WebSocket> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return this.ws;

    const target = await this.findChartTarget();
    const ws = new WebSocket(target.webSocketDebuggerUrl, {
      maxPayload: 256 * 1024 * 1024,
    });

    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString()) as CdpMessage;
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        this.pending.get(msg.id)!.resolve(msg);
        this.pending.delete(msg.id);
      }
    });
    ws.on("close", () => {
      for (const { reject } of this.pending.values()) {
        reject(new Error("CDP connection closed"));
      }
      this.pending.clear();
      if (this.ws === ws) this.ws = null;
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

    this.ws = ws;
    return ws;
  }

  async send(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    const ws = await this.ensureConnected();
    const id = this.nextId++;
    const msg = await new Promise<CdpMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(`CDP call ${method} timed out after ${this.timeoutMs}ms`),
        );
      }, this.timeoutMs);
      this.pending.set(id, {
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
      throw new Error(`Page evaluation failed: ${detail}`);
    }
    return result.result?.value as T;
  }

  /** Capture a screenshot of the chart window. Returns base64 image data. */
  async screenshot(
    format: "png" | "jpeg" = "png",
    quality?: number,
  ): Promise<string> {
    const params: Record<string, unknown> = { format };
    if (format === "jpeg") params.quality = quality ?? 80;
    const result = (await this.send("Page.captureScreenshot", params)) as {
      data?: string;
    };
    if (!result.data) throw new Error("Page.captureScreenshot returned no data");
    return result.data;
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
  }
}
