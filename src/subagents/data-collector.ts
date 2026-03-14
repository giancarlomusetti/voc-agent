/**
 * Data Collection Subagent
 *
 * Generic agentic loop scoped to a single data source.
 * Receives only the tools for its source — cannot access GitHub MCP or other sources.
 * Returns SubagentFindings JSON that the coordinator injects into the synthesizer.
 *
 * Exam guide reference: Domain 1.2 (subagents operate with isolated context),
 * Domain 2.3 (restrict each subagent's tool set to those relevant to its role).
 */
import Anthropic from "@anthropic-ai/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpTool, callTool } from "../lib/mcp.js";
import { SubagentFindings } from "../types.js";

const MAX_ITERATIONS = 15;

export interface DataCollectorConfig {
  sourceName: string;
  systemPrompt: string;
  userMessage: string;
}

export async function runDataCollector(
  config: DataCollectorConfig,
  tools: McpTool[],
  clients: Map<string, Client>,
  anthropic: Anthropic
): Promise<SubagentFindings> {
  const anthropicTools: Anthropic.Tool[] = tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema as Anthropic.Tool["input_schema"],
  }));

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: config.userMessage },
  ];

  let iterations = 0;

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: config.systemPrompt,
      tools: anthropicTools,
      messages,
    });

    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "end_turn") {
      const textBlock = response.content.find((b) => b.type === "text");
      const rawText = textBlock?.type === "text" ? textBlock.text : "";

      // Extract JSON from response — Claude may wrap it in markdown fences
      const jsonMatch =
        rawText.match(/```json\s*([\s\S]*?)\s*```/) ??
        rawText.match(/(\{[\s\S]*\})/);

      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[1]) as SubagentFindings;
        } catch {
          // fall through to fallback
        }
      }

      // Fallback: return minimal findings with a parse error note
      return {
        source: config.sourceName,
        rawCount: 0,
        avgSentiment: null,
        topQuotes: [],
        themes: [],
        errorNotes: [`Failed to parse JSON from subagent response: ${rawText.slice(0, 200)}`],
      };
    }

    if (response.stop_reason === "tool_use") {
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const block of response.content) {
        if (block.type !== "tool_use") continue;

        try {
          const result = await callTool(
            clients,
            block.name,
            block.input as Record<string, unknown>,
            tools
          );
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: result,
          });
        } catch (err) {
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: `Error: ${err instanceof Error ? err.message : String(err)}`,
            is_error: true,
          });
        }
      }

      messages.push({ role: "user", content: toolResults });
    }
  }

  return {
    source: config.sourceName,
    rawCount: 0,
    avgSentiment: null,
    topQuotes: [],
    themes: [],
    errorNotes: [`Subagent hit iteration limit (${MAX_ITERATIONS}) without completing`],
  };
}
