import { readSync, writeSync, fstatSync } from "node:fs";
import { canonical } from "./nativeBarEvidence.js";
import { qualifySyntheticNativeBarRecoveryChannel } from "./nativeBarFs.js";

export const RECOVERY_CHANNEL_LIMIT = 8 * 1024 * 1024;
export function recoveryFrame(value: unknown) {
  const bytes = Buffer.from(canonical(value));
  if (!bytes.length || bytes.length > RECOVERY_CHANNEL_LIMIT) throw new Error("recovery_ipc_limit");
  const header = Buffer.alloc(4); header.writeUInt32BE(bytes.length); return Buffer.concat([header, bytes]);
}
export function decodeRecoveryFrame(bytes: Buffer): unknown {
  if (!bytes.length || bytes.length > RECOVERY_CHANNEL_LIMIT) throw new Error("recovery_ipc_limit");
  const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  const stack: [unknown, number][] = [[value, 0]];
  while (stack.length) {
    const [node, depth] = stack.pop()!;
    if (node === null || typeof node !== "object") continue;
    if (depth >= 64) throw new Error("recovery_ipc_depth");
    const children = Object.values(node); if (children.length > 65536) throw new Error("recovery_ipc_limit");
    for (const child of children) stack.push([child, depth + 1]);
  }
  if (!bytes.equals(Buffer.from(canonical(value)))) throw new Error("recovery_ipc_noncanonical"); return value;
}
/** Only the inherited duplex descriptor is read/written. No filesystem path is accepted. */
export function inheritedRecoveryChannel(nonce: string, parent: number) {
  if (!process.send || !process.connected || process.ppid !== parent || !fstatSync(4).isSocket()) throw new Error("recovery_inherited_channel_required");
  qualifySyntheticNativeBarRecoveryChannel();
  let sequence = 0; const opened = performance.now(), pause = new Int32Array(new SharedArrayBuffer(4));
  function transfer(bytes: Buffer, writing: boolean) {
    let offset = 0;
    while (offset < bytes.length) {
      if (process.ppid !== parent || performance.now() >= opened + 600000) throw new Error("recovery_controller_channel_lost_or_expired");
      try {
        const count = writing ? writeSync(4, bytes, offset, bytes.length - offset) : readSync(4, bytes, offset, bytes.length - offset, null);
        if (!count) throw new Error("recovery_controller_channel_closed"); offset += count;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EAGAIN" && (error as NodeJS.ErrnoException).code !== "EINTR") throw error;
        Atomics.wait(pause, 0, 0, 1);
      }
    }
  }
  return (operation: string, args: unknown[] = []): any => {
    const id = ++sequence; if (id > 65536) throw new Error("recovery_ipc_budget");
    transfer(recoveryFrame({ nonce, id, operation, args }), true);
    const header = Buffer.alloc(4); transfer(header, false); const length = header.readUInt32BE();
    if (!length || length > RECOVERY_CHANNEL_LIMIT) throw new Error("recovery_ipc_limit");
    const bytes = Buffer.alloc(length); transfer(bytes, false);
    const response = decodeRecoveryFrame(bytes) as { nonce: string; id: number; ok: boolean; value: unknown; error: string };
    if (response.nonce !== nonce || response.id !== id) throw new Error("recovery_ipc_response_binding");
    if (!response.ok) throw new Error(response.error); return response.value;
  };
}
