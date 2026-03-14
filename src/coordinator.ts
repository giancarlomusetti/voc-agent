/**
 * VoC Agent — Coordinator
 *
 * Hub-and-spoke multi-agent architecture (exam guide Domain 1.2, 1.3):
 *
 *   Coordinator
 *     ├── [PARALLEL] ReviewsSubagent   — Trustpilot + App Store only
 *     ├── [PARALLEL] RedditSubagent    — Reddit only
 *     ├── [PARALLEL] SupportSubagent   — support tickets only
 *     ├── [PARALLEL] AnalyticsSubagent — analytics events only
 *     ├── SynthesisSubagent            — no tools; receives findings explicitly
 *     └── ReporterSubagent             — GitHub MCP only
 *
 * Key patterns demonstrated:
 * - Parallel data collection via Promise.all() (Domain 1.3)
 * - Isolated subagent context: each subagent only gets its own tools (Domain 2.3)
 * - Explicit context passing: synthesis receives structured JSON, not conversation history (Domain 1.3)
 * - Tool scoping: reporter can only call GitHub tools (Domain 2.3)
 */
import Anthropic from "@anthropic-ai/sdk";
import * as path from "path";
import * as fs from "fs";
import * as dotenv from "dotenv";

import {
  startMcpServer,
  getGithubMcpClient,
  listTools,
  McpTool,
} from "./lib/mcp.js";
import { runDataCollector, DataCollectorConfig } from "./subagents/data-collector.js";
import { runSynthesizer } from "./subagents/synthesizer.js";
import { runReporter } from "./subagents/reporter.js";

dotenv.config();

// ── Config ──────────────────────────────────────────────────────────────────

const config = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), "config.json"), "utf-8")
) as {
  target: {
    trustpilot_company_slug: string;
    app_store_app_id: string;
    app_store_country: string;
    reddit_subreddits: string[];
    support_tickets_file: string;
    analytics_events_file: string;
  };
  thresholds: {
    issue_filing_min_mentions: number;
    confidence_threshold: number;
  };
  github: {
    repo: string;
    report_branch: string;
    report_path: string;
  };
};

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Subagent system prompts ──────────────────────────────────────────────────

const JSON_RETURN_INSTRUCTION = `
After fetching, return ONLY a JSON object (no markdown, no other text) matching:
{
  "source": "<source_name>",
  "rawCount": <number of items fetched>,
  "avgSentiment": <average rating 1-5 or null>,
  "topQuotes": [{ "text": "<quote>", "id": "<id if available>", "score": <rating/upvotes if available> }],
  "themes": ["<theme1>", ...],
  "errorNotes": ["<note if a structured error was encountered>"]
}
If any tool returns an errorCategory field, add a note to errorNotes and use the partialResults data to continue.`;

function buildCollectorConfigs(): DataCollectorConfig[] {
  return [
    {
      sourceName: "trustpilot_appstore",
      systemPrompt: `You are a reviews analyst for a Voice of Customer system. Fetch recent public reviews from Trustpilot and the App Store using the provided tools. Identify the top themes from the reviews (e.g. login issues, performance, search).${JSON_RETURN_INSTRUCTION}`,
      userMessage: `Fetch reviews for Trustpilot company "${config.target.trustpilot_company_slug}" and App Store app ID "${config.target.app_store_app_id}" (country: ${config.target.app_store_country}). Return the JSON summary.`,
    },
    {
      sourceName: "reddit",
      systemPrompt: `You are a social listening analyst for a Voice of Customer system. Fetch recent posts from the configured subreddits and identify common customer complaints and praise.${JSON_RETURN_INSTRUCTION}`,
      userMessage: `Fetch posts from subreddits: ${config.target.reddit_subreddits.join(", ")}. Return the JSON summary.`,
    },
    {
      sourceName: "support",
      systemPrompt: `You are a support ticket analyst for a Voice of Customer system. Read customer support tickets from the CSV file and categorise them by theme.${JSON_RETURN_INSTRUCTION}`,
      userMessage: `Read support tickets from: ${config.target.support_tickets_file}. Return the JSON summary.`,
    },
    {
      sourceName: "analytics",
      systemPrompt: `You are a product analytics analyst for a Voice of Customer system. Read analytics events from the CSV file and flag error event spikes (change_pct > 50%) and funnel drop-offs (drop_off_rate > 30%).${JSON_RETURN_INSTRUCTION}`,
      userMessage: `Read analytics events from: ${config.target.analytics_events_file}. Return the JSON summary.`,
    },
  ];
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n🔍 VoC Coordinator starting...\n");

  const distDir = path.resolve(process.cwd(), "dist", "mcp-servers");

  // Start all MCP servers
  const clients = new Map([
    ["reviews",   await startMcpServer(path.join(distDir, "reviews", "index.js"),   "reviews")],
    ["reddit",    await startMcpServer(path.join(distDir, "reddit", "index.js"),    "reddit")],
    ["support",   await startMcpServer(path.join(distDir, "support", "index.js"),   "support")],
    ["analytics", await startMcpServer(path.join(distDir, "analytics", "index.js"), "analytics")],
    ["github",    await getGithubMcpClient()],
  ]);

  console.log("✓ All MCP servers connected\n");

  // Collect tools grouped by server
  const toolsByServer = new Map<string, McpTool[]>();
  for (const [serverName, client] of clients) {
    toolsByServer.set(serverName, await listTools(client, serverName));
  }

  const githubTools = toolsByServer.get("github") ?? [];
  const totalTools = [...toolsByServer.values()].flat().length;
  console.log(`📦 ${totalTools} tools available across ${clients.size} MCP servers\n`);

  // ── Phase 1: Parallel data collection ────────────────────────────────────
  // Each subagent gets ONLY its own server's tools — cannot access other sources.
  // Exam guide Domain 1.3: "spawning parallel subagents by emitting multiple
  // Task tool calls in a single coordinator response"
  console.log("🚀 Spawning 4 data collection subagents in parallel...\n");

  const collectorConfigs = buildCollectorConfigs();

  const [reviewsFindings, redditFindings, supportFindings, analyticsFindings] =
    await Promise.all([
      runDataCollector(
        collectorConfigs[0],
        toolsByServer.get("reviews") ?? [],
        clients,
        anthropic
      ).then((f) => { console.log(`  ✓ Reviews subagent complete (${f.rawCount} items, ${f.errorNotes.length} errors)`); return f; }),

      runDataCollector(
        collectorConfigs[1],
        toolsByServer.get("reddit") ?? [],
        clients,
        anthropic
      ).then((f) => { console.log(`  ✓ Reddit subagent complete (${f.rawCount} items, ${f.errorNotes.length} errors)`); return f; }),

      runDataCollector(
        collectorConfigs[2],
        toolsByServer.get("support") ?? [],
        clients,
        anthropic
      ).then((f) => { console.log(`  ✓ Support subagent complete (${f.rawCount} items, ${f.errorNotes.length} errors)`); return f; }),

      runDataCollector(
        collectorConfigs[3],
        toolsByServer.get("analytics") ?? [],
        clients,
        anthropic
      ).then((f) => { console.log(`  ✓ Analytics subagent complete (${f.rawCount} items, ${f.errorNotes.length} errors)`); return f; }),
    ]);

  console.log("\n✅ All data collection subagents complete\n");

  // ── Phase 2: Synthesis ───────────────────────────────────────────────────
  // Synthesizer has NO tools. Its context is entirely what the coordinator
  // injects — it cannot read the conversation history of the data collectors.
  // Exam guide Domain 1.3: "subagent context must be explicitly provided in the prompt"
  console.log("🧠 Running synthesis subagent (no tools — pure reasoning)...\n");

  const synthesis = await runSynthesizer(
    [reviewsFindings, redditFindings, supportFindings, analyticsFindings],
    config.thresholds,
    anthropic
  );

  console.log("✅ Synthesis complete\n");

  // ── Phase 3: Report + Issue Filing ──────────────────────────────────────
  // Reporter has ONLY GitHub MCP tools. Receives synthesis output explicitly.
  // Cannot retroactively call data-source tools.
  console.log("📝 Running reporter subagent (GitHub MCP tools only)...\n");

  const today = new Date().toISOString().split("T")[0];

  await runReporter(
    synthesis,
    today,
    githubTools,
    clients,
    config.github.repo,
    config.github.report_branch,
    config.github.report_path,
    anthropic
  );

  // Clean up
  for (const client of clients.values()) {
    await client.close();
  }

  console.log("\n📁 Report committed to GitHub. Done!");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
