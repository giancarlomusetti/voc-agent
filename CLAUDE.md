# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build        # Compile TypeScript → dist/
npm run agent        # Build + run the full agent (requires .env)
npm run dev          # Run with ts-node, no build step (slower startup)
npx tsc --noEmit     # Type-check only, no output
```

The agent requires `ANTHROPIC_API_KEY` and `GITHUB_TOKEN` in `.env`. Copy `.env.example` to get started.

## Architecture

The agent orchestrates **5 MCP servers** in parallel. Four are custom stdio servers built in this repo; one is the official GitHub MCP server pulled via `npx`.

```
agent.ts
  ├── starts reviews-server   (dist/mcp-servers/reviews/index.js)
  ├── starts reddit-server    (dist/mcp-servers/reddit/index.js)
  ├── starts support-server   (dist/mcp-servers/support/index.js)
  ├── starts analytics-server (dist/mcp-servers/analytics/index.js)
  └── spawns GitHub MCP       (npx @modelcontextprotocol/server-github)
```

Each custom server is a standalone Node process connected via `StdioClientTransport`. `agent.ts` starts them all as child processes, calls `listTools()` on each, merges the results into a single flat `allTools` array (with a `serverName` field for routing), then passes them to Claude as `Anthropic.Tool[]`.

**Agentic loop** (`src/agent.ts`): Standard tool-use loop — append assistant message to `messages[]`, handle all `tool_use` blocks by dispatching to the correct MCP client via `serverName`, append tool results, repeat until `stop_reason === "end_turn"`. Capped at 30 iterations.

**Adding a new data source**: Create a new file at `src/mcp-servers/<name>/index.ts`, follow the pattern of any existing server (Server → ListTools handler → CallTool handler → `main()` with StdioServerTransport), then add it to the `clients` map in `agent.ts` and include its tools in `allTools`.

## Key Files

- `config.json` — the only file a fork needs to change: target company slugs, subreddit names, CSV paths, GitHub repo, and the mention threshold for filing issues
- `data/*.csv` — mock support tickets and analytics events; designed so login failures appear across all 4 sources to demonstrate cross-source synthesis
- `src/mcp-servers/reviews/index.ts` — tries the real Trustpilot API first, silently falls back to mock data if the key is absent or the request fails; same pattern applies to App Store RSS and Reddit

## TypeScript Notes

- `tsconfig.json` targets CommonJS (required for `StdioClientTransport` child process spawning)
- MCP SDK imports use the `.js` extension suffix (`/index.js`) even in TypeScript source — this is required by the SDK's ESM-style re-exports
- `resolveJsonModule: true` is set so `config.json` can be imported directly
