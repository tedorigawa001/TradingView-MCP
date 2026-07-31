import { createHash } from "node:crypto";

export type CanonicalJson = null | boolean | number | string | CanonicalJson[] | { [key: string]: CanonicalJson };

/**
 * Key-sorted JSON projection. Two definitions that differ only in property order hash identically,
 * so a recorded hash pins the configuration rather than the order it happened to be written in.
 * Array order is preserved because it carries meaning here (fold sequence).
 */
export function canonicalJson(value: unknown): CanonicalJson {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("canonical definition must contain only finite JSON numbers");
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!value || typeof value !== "object") throw new Error("canonical definition must be JSON data");
  const result: { [key: string]: CanonicalJson } = {};
  for (const key of Object.keys(value).sort()) {
    const entry = (value as Record<string, unknown>)[key];
    if (entry !== undefined) result[key] = canonicalJson(entry);
  }
  return result;
}

export function canonicalDefinitionHash(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(canonicalJson(value)), "utf8").digest("hex")}`;
}
