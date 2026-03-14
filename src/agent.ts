/**
 * VoC Agent — Voice of Customer
 *
 * Orchestrates 4 MCP servers (reviews, reddit, support, analytics) + GitHub MCP.
 * Claude synthesizes cross-source themes and files GitHub Issues for critical problems.
 * Commits a daily markdown report to the repo.
 */
import Anthropic from "@anthropic-ai/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import * as path from "path";
import * as fs from "fs";
import * as dotenv from "dotenv";

dotenv.config();

// Load config
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
  };
  github: {
    repo: string;
    report_branch: string;
    report_path: string;
  };
};

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

interface McpTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  serverName: string;
}

interface ToolResult {
  content: Array<{ type: string; text: string }>;
}

async function startMcpServer(serverPath: string, serverName: string): Promise<Client> {
  const client = new Client({ name: "voc-agent", version: "1.0.0" }, { capabilities: {} });

  const transport = new StdioClientTransport({
    command: "node",
    args: [serverPath],
    env: {
      ...process.env,
      NODE_PATH: path.resolve(process.cwd(), "node_modules"),
    } as Record<string, string>,
  });

  await client.connect(transport);
  console.log(`✓ Connected to ${serverName}`);
  return client;
}

async function getGithubMcpClient(): Promise<Client> {
  const client = new Client({ name: "voc-agent", version: "1.0.0" }, { capabilities: {} });

  const transport = new StdioClientTransport({
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    env: {
      ...process.env,
      GITHUB_PERSONAL_ACCESS_TOKEN: process.env.GITHUB_TOKEN || "",
    } as Record<string, string>,
  });

  await client.connect(transport);
  console.log("✓ Connected to GitHub MCP");
  return client;
}

async function listTools(client: Client, serverName: string): Promise<McpTool[]> {
  const result = await client.listTools();
  return result.tools.map((t) => ({
    name: t.name,
    description: t.description ?? "",
    input_schema: (t.inputSchema as Record<string, unknown>) ?? { type: "object", properties: {} },
    serverName,
  }));
}

async function callTool(
  clients: Map<string, Client>,
  toolName: string,
  toolInput: Record<string, unknown>,
  allTools: McpTool[]
): Promise<string> {
  const toolDef = allTools.find((t) => t.name === toolName);
  if (!toolDef) throw new Error(`Tool ${toolName} not found`);

  const client = clients.get(toolDef.serverName);
  if (!client) throw new Error(`Client for ${toolDef.serverName} not found`);

  const result = (await client.callTool({ name: toolName, arguments: toolInput })) as ToolResult;
  return result.content.map((c) => c.text).join("\n");
}

async function main() {
  console.log("\n🔍 VoC Agent starting...\n");

  // Start all MCP servers
  const distDir = path.resolve(process.cwd(), "dist", "mcp-servers");

  const clients = new Map<string, Client>();

  clients.set("reviews", await startMcpServer(path.join(distDir, "reviews", "index.js"), "reviews"));
  clients.set("reddit", await startMcpServer(path.join(distDir, "reddit", "index.js"), "reddit"));
  clients.set("support", await startMcpServer(path.join(distDir, "support", "index.js"), "support"));
  clients.set("analytics", await startMcpServer(path.join(distDir, "analytics", "index.js"), "analytics"));
  clients.set("github", await getGithubMcpClient());

  // Collect all tools from all servers
  const allTools: McpTool[] = [];
  for (const [serverName, client] of clients) {
    const tools = await listTools(client, serverName);
    allTools.push(...tools);
  }

  console.log(`\n📦 ${allTools.length} tools available across ${clients.size} MCP servers\n`);

  // Build the system prompt
  const today = new Date().toISOString().split("T")[0];
  const systemPrompt = `You are a Voice of Customer analyst agent. Your job is to:

1. Fetch customer feedback from all available data sources using the provided tools
2. Synthesize the data to identify the top themes and problems customers are experiencing
3. Cross-reference themes across sources (a problem appearing in reviews AND reddit AND support is more severe)
4. File GitHub Issues for problems that meet the severity threshold (${config.thresholds.issue_filing_min_mentions}+ mentions across sources)
5. Generate a structured daily report and commit it to the repository

Today's date: ${today}

Target product config:
- Trustpilot company: ${config.target.trustpilot_company_slug}
- App Store ID: ${config.target.app_store_app_id}
- Reddit subreddits: ${config.target.reddit_subreddits.join(", ")}
- Support tickets file: ${config.target.support_tickets_file}
- Analytics events file: ${config.target.analytics_events_file}

GitHub repo: ${config.github.repo}
Report path: ${config.github.report_path}/${today}.md

When filing GitHub Issues:
- Title format: [VoC] <Problem> — N mentions across X sources
- Labels: ["voc", "customer-feedback", "<priority>"] where priority is P1 (5+ mentions), P2 (3-4 mentions)
- Body should include: what customers are saying, which sources it appears in, example quotes, suggested next steps

Report format:
# VoC Daily Report — ${today}

## Executive Summary
[2-3 sentences synthesizing the day's key customer signals]

## Top Themes (cross-source)
[Ranked list with mention counts per source]

## By Source
### Trustpilot Reviews
### App Store Reviews
### Reddit Mentions
### Support Tickets
### Analytics Signals

## Filed GitHub Issues
[List of issues filed today]

## Sentiment Overview
[Brief sentiment summary per source]

Commit the report using the GitHub MCP's file creation/update tool to ${config.github.report_path}/${today}.md on branch ${config.github.report_branch}.`;

  // Convert tools to Anthropic format
  const anthropicTools: Anthropic.Tool[] = allTools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema as Anthropic.Tool["input_schema"],
  }));

  // Agentic loop
  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: "Run the full VoC analysis for today. Fetch data from all sources, identify themes, file GitHub Issues for critical problems, and commit the daily report.",
    },
  ];

  console.log("🤖 Claude is running the VoC analysis...\n");

  let iterations = 0;
  const maxIterations = 30; // safety limit

  while (iterations < maxIterations) {
    iterations++;

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8096,
      system: systemPrompt,
      tools: anthropicTools,
      messages,
    });

    // Add assistant response to history
    messages.push({ role: "assistant", content: response.content });

    // If Claude is done, print final message and exit
    if (response.stop_reason === "end_turn") {
      const textContent = response.content.find((b) => b.type === "text");
      if (textContent && textContent.type === "text") {
        console.log("\n✅ Agent complete:\n");
        console.log(textContent.text);
      }
      break;
    }

    // Handle tool calls
    if (response.stop_reason === "tool_use") {
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const block of response.content) {
        if (block.type !== "tool_use") continue;

        console.log(`  → Calling tool: ${block.name}`);

        try {
          const result = await callTool(
            clients,
            block.name,
            block.input as Record<string, unknown>,
            allTools
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
