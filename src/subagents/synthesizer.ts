/**
 * Synthesis Subagent
 *
 * Pure reasoning — NO tools. Receives the structured findings from all 4 data
 * collection subagents explicitly in its prompt (not via shared context) and
 * produces a cross-source theme analysis with confidence scores and provenance.
 *
 * Exam guide reference:
 * - Domain 1.3: subagent context must be explicitly provided in the prompt
 * - Domain 5.6: preserve claim-source mappings through synthesis
 * - Domain 5.5: confidence calibration per theme
 */
import Anthropic from "@anthropic-ai/sdk";
import { SubagentFindings } from "../types.js";

export async function runSynthesizer(
  findings: SubagentFindings[],
  thresholds: { confidence_threshold: number; issue_filing_min_mentions: number },
  anthropic: Anthropic
): Promise<string> {
  const systemPrompt = `You are a Voice of Customer synthesis analyst. You receive structured findings from multiple data sources and produce a cross-source theme analysis.

For each theme you identify, you MUST:
1. Track PROVENANCE — cite the specific quotes, ticket IDs, and post titles from the findings that support it
2. Score CONFIDENCE on 1–10:
   - 1–3: Anecdotal (1–2 mentions, 1 source)
   - 4–5: Notable (3–5 mentions, or 2 sources)
   - 6–7: Confirmed (5–8 mentions across 3 sources)
   - 8–10: Critical (8+ mentions across 4 sources, or major analytics spike)
3. Assess TREND: "🆕 New", "↑ Worsening", "→ Stable", or "↓ Improving"

Themes with confidence ≥ ${thresholds.confidence_threshold} AND mentions ≥ ${thresholds.issue_filing_min_mentions} should be flagged for GitHub Issue filing.
Themes below these thresholds go into Emerging Signals.

Return your analysis as structured markdown with these exact sections:

## Theme Intelligence
| Theme | Confidence | Mentions | Sources | Trend | Key Evidence |
|-------|-----------|----------|---------|-------|--------------|
[rows ranked by confidence descending]

## Emerging Signals
[bullet list of low-confidence themes]

## Source Coverage
| Source | Items | Avg Sentiment | Errors |
|--------|-------|--------------|--------|
[one row per source]

## Themes Qualifying for GitHub Issues
[JSON array for the reporter, format: [{"theme": "...", "confidence": N, "mentions": N, "sources": [...], "evidence": {...}}]]`;

  const findingsBlock = JSON.stringify(findings, null, 2);

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: `Here are the structured findings from all data sources. Synthesize them into cross-source themes.\n\n${findingsBlock}`,
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  return textBlock?.type === "text" ? textBlock.text : "";
}
