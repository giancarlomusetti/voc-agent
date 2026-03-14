# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build        # Compile TypeScript → dist/
npm run agent        # Build + run the coordinator (multi-agent, default)
npm run agent:legacy # Build + run the single-agent fallback (src/agent.ts)
npm run dev          # Run coordinator with ts-node, no build step
npx tsc --noEmit     # Type-check only, no output
```

The agent requires `ANTHROPIC_API_KEY` and `GITHUB_TOKEN` in `.env`. Copy `.env.example` to get started.

## Architecture

Hub-and-spoke multi-agent system. The coordinator starts all 5 MCP servers, then spawns 6 Claude subagents — 4 in parallel for data collection, then synthesis, then reporting.

```
coordinator.ts
  ├── starts 5 MCP servers (reviews, reddit, support, analytics, github)
  │
  ├── [PARALLEL via Promise.all()]
  │   ├── ReviewsSubagent    — tools: get_trustpilot_reviews, get_app_store_reviews
  │   ├── RedditSubagent     — tools: get_reddit_mentions
  │   ├── SupportSubagent    — tools: get_support_tickets
  │   └── AnalyticsSubagent  — tools: get_analytics_events
  │
  ├── SynthesisSubagent      — NO tools; receives SubagentFindings[] explicitly
  └── ReporterSubagent       — tools: GitHub MCP only
```

Each MCP server is a standalone Node process connected via `StdioClientTransport`. Shared MCP utilities (startMcpServer, listTools, callTool) live in `src/lib/mcp.ts`.

**Tool scoping**: Each subagent receives only the tools for its role — data collectors cannot file GitHub Issues; the reporter cannot read data sources. Enforced by passing filtered `McpTool[]` subsets to each subagent.

**Context passing**: Data collectors return `SubagentFindings` JSON. The coordinator injects all 4 findings directly into the synthesizer's user message. The synthesizer has no access to the data collectors' conversation history.

**Agentic loop** (same pattern in `data-collector.ts` and `reporter.ts`): append assistant message → handle `tool_use` blocks → append tool results → repeat until `stop_reason === "end_turn"`. Synthesizer uses a single non-agentic call (no tools needed).

**Adding a new data source**: Create `src/mcp-servers/<name>/index.ts` (follow existing server pattern), add to `clients` map in `coordinator.ts`, create a `DataCollectorConfig` entry in `buildCollectorConfigs()`, add its tools to the relevant `Promise.all()` call.

## Key Files

- `config.json` — the only file a fork needs to change: target company slugs, subreddit names, CSV paths, GitHub repo, and thresholds (`issue_filing_min_mentions`, `confidence_threshold`)
- `src/types.ts` — `StructuredError` (MCP server errors), `SubagentFindings` (data collector output)
- `data/*.csv` — mock support tickets and analytics events; designed so login failures appear across all 4 sources to demonstrate cross-source synthesis
- `src/mcp-servers/reviews/index.ts` — tries the real Trustpilot API first, returns structured error + mock data as `partialResults` on failure; same pattern for App Store and Reddit
- `src/agent.ts` — legacy single-agent implementation kept for reference; run via `npm run agent:legacy`

## TypeScript Notes

- `tsconfig.json` targets CommonJS (required for `StdioClientTransport` child process spawning)
- MCP SDK imports use the `.js` extension suffix (`/index.js`) even in TypeScript source — this is required by the SDK's ESM-style re-exports
- `resolveJsonModule: true` is set so `config.json` can be imported directly
