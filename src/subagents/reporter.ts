/**
 * Reporter Subagent
 *
 * Scoped to GitHub MCP tools only — cannot read data sources.
 * Receives the synthesis output explicitly in its prompt and:
 * 1. Files GitHub Issues for qualifying themes
 * 2. Commits the daily report to the repo
 *
 * Exam guide reference:
 * - Domain 2.3: give agents only the tools needed for their role
 * - Domain 1.3: subagent receives coordinator-injected context, not shared history
 */
import Anthropic from "@anthropic-ai/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpTool, callTool } from "../lib/mcp.js";

const MAX_ITERATIONS = 20;

export async function runReporter(
  synthesis: string,
  today: string,
  githubTools: McpTool[],
  clients: Map<string, Client>,
  githubRepo: string,
  reportBranch: string,
  reportPath: string,
  anthropic: Anthropic
): Promise<void> {
  const systemPrompt = `You are a VoC reporter agent. You receive a synthesis of customer feedback themes and must:

1. For each theme in "Themes Qualifying for GitHub Issues":
   - File a GitHub Issue with title: [VoC] <Theme> — confidence <N>/10, <M> mentions across <X> sources
   - Labels: ["voc", "customer-feedback", "P1"] for confidence 8–10, ["voc", "customer-feedback", "P2"] for 5–7
   - Issue body must include:
     a) A per-source evidence table (Source | Mentions | Key Evidence)
     b) ## Suggested Next Steps (2–3 specific, actionable items for the engineering team)

2. Commit the full daily report to the GitHub repo.
   - File path: ${reportPath}/${today}.md
   - Branch: ${reportBranch}
   - Repo: ${githubRepo}
   - The report content should include all sections from the synthesis, plus a "Filed GitHub Issues" section listing the issue numbers you filed.

Use the GitHub MCP tools to create issues and commit the file.`;

  const anthropicTools: Anthropic.Tool[] = githubTools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema as Anthropic.Tool["input_schema"],
  }));

  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `Here is today's (${today}) VoC synthesis. File GitHub Issues for qualifying themes, then commit the full report.\n\nRepo: ${githubRepo}\n\n${synthesis}`,
    },
  ];

  let iterations = 0;

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8096,
      system: systemPrompt,
      tools: anthropicTools,
      messages,
    });

    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "end_turn") {
      const textBlock = response.content.find((b) => b.type === "text");
      if (textBlock?.type === "text") {
        console.log("\n✅ Reporter complete:\n", textBlock.text);
      }
      return;
    }

    // Process tool_use blocks based on content, not solely stop_reason.
    // If stop_reason is "max_tokens" while a tool_use block was being generated,
    // the block is still present in content and must get a tool_result or the
    // next API call will 400 with "tool_use ids found without tool_result blocks".
    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );

    if (toolUseBlocks.length === 0) {
      // No tool calls and not end_turn — unexpected stop, exit cleanly
      return;
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const block of toolUseBlocks) {
      console.log(`  → Reporter calling: ${block.name}`);

      try {
        const result = await callTool(
          clients,
          block.name,
          block.input as Record<string, unknown>,
          githubTools
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
