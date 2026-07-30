export type BoundedResponse = {
  headers: { get(name: string): string | null };
  body?: ReadableStream<Uint8Array> | null;
  url?: string;
  text?: () => Promise<string>;
  arrayBuffer?: () => Promise<ArrayBuffer>;
};

const checkDeclaredLength = (response: BoundedResponse, maximumBytes: number, label: string) => {
  const raw = response.headers.get("content-length");
  if (raw === null) return;
  const length = Number(raw);
  if (Number.isFinite(length) && length > maximumBytes) throw new Error(`${label} response is too large`);
};

export function assertExpectedResponseHost(response: BoundedResponse, requestedUrl: string, label: string) {
  // Synthetic Response objects do not retain a URL. A real fetch response always does, including
  // after redirects; callers also request redirect: "manual" to avoid following host changes.
  if (!response.url) return;
  const expected = new URL(requestedUrl);
  const actual = new URL(response.url);
  if (actual.protocol !== expected.protocol || actual.host !== expected.host) {
    throw new Error(`${label} response URL did not match the requested host`);
  }
}

export async function readLimitedResponseBytes(response: BoundedResponse, maximumBytes: number, label: string): Promise<Uint8Array> {
  checkDeclaredLength(response, maximumBytes, label);
  if (response.body) {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > maximumBytes) {
          await reader.cancel().catch(() => undefined);
          throw new Error(`${label} response is too large`);
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const output = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
    return output;
  }
  if (response.arrayBuffer) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maximumBytes) throw new Error(`${label} response is too large`);
    return bytes;
  }
  if (response.text) {
    const bytes = new TextEncoder().encode(await response.text());
    if (bytes.byteLength > maximumBytes) throw new Error(`${label} response is too large`);
    return bytes;
  }
  throw new Error(`${label} response has no readable body`);
}

export async function readLimitedResponseText(response: BoundedResponse, maximumBytes: number, label: string): Promise<string> {
  return new TextDecoder().decode(await readLimitedResponseBytes(response, maximumBytes, label));
}
