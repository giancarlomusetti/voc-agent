/**
 * Structured error type returned by all MCP servers.
 * Follows the exam guide pattern (Domain 2.2, 5.3):
 * giving the agent enough context to make intelligent recovery decisions
 * rather than a generic "Operation failed" string.
 */
export interface StructuredError {
  errorCategory: "transient" | "validation" | "permission";
  isRetryable: boolean;
  attempted: string;
  partialResults: unknown[];
  suggestedAlternative: string;
}

export function makeError(
  errorCategory: StructuredError["errorCategory"],
  attempted: string,
  suggestedAlternative: string,
  partialResults: unknown[] = []
): StructuredError {
  return {
    errorCategory,
    isRetryable: errorCategory === "transient",
    attempted,
    partialResults,
    suggestedAlternative,
  };
}
