/**
 * An error's message followed by its causes', outermost first, joined by ": " (BACKLOG 102-30). A first-seen store wraps
 * the filesystem's error in its own ("unable to acquire … history lock"), so only the chain says whether the disk was
 * full, a permission was missing or the device failed. The walk is bounded and stops at a cause seen before, and a
 * message the chain already holds is not repeated.
 */
export function describeErrorChain(error: unknown, maxDepth = 8): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  for (let depth = 0; depth < maxDepth && current !== undefined && current !== null && !seen.has(current); depth++) {
    seen.add(current);
    const message = current instanceof Error ? current.message : String(current);
    if (message !== "" && !parts.some((part) => part.includes(message))) parts.push(message);
    current = current instanceof Error ? current.cause : undefined;
  }
  return parts.join(": ");
}
