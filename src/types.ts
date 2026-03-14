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

/**
 * Structured findings returned by each data-collection subagent to the coordinator.
 * The coordinator passes these explicitly to the synthesizer — subagents do NOT
 * share context automatically (Domain 1.3 exam guide pattern).
 */
export interface SubagentFindings {
  source: string;
  rawCount: number;
  avgSentiment: number | null; // 1–5 average rating; null for analytics
  topQuotes: Array<{
    text: string;
    id?: string;    // ticket ID, review ID, post title
    score?: number; // upvotes (Reddit) or rating (reviews)
  }>;
  themes: string[];
  errorNotes: string[]; // populated when structured errors occurred
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
