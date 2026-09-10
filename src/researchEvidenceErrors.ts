const messages = {
  EVIDENCE_INPUT_NOT_REGULAR: "evidence input must be a regular non-symlink file",
  EVIDENCE_INPUT_MISSING: "evidence input is missing or its parent is not a directory",
  EVIDENCE_INPUT_ACCESS_DENIED: "evidence input access was denied",
  EVIDENCE_INPUT_CHANGED: "evidence input changed during read or verification",
  EVIDENCE_FILE_LIMIT: "evidence file exceeds byte limit",
  EVIDENCE_BYTE_BUDGET: "evidence byte budget exceeded",
} as const;

export class ResearchEvidenceError extends Error {
  constructor(readonly code: keyof typeof messages) { super(messages[code]); }
}

export function researchEvidenceDiagnostic(error: unknown): string {
  // Never trust an arbitrary error's code or message, including filesystem errors.
  if (error instanceof ResearchEvidenceError && Object.hasOwn(messages, error.code)) {
    return `research evidence failed [${error.code}]: ${messages[error.code]}`;
  }
  return "research evidence failed: check --input, --confirm-local-read, and optional --output (new file in an existing directory); diagnostic details withheld";
}
