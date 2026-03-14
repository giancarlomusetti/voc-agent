# VoC Agent — Voice of Customer

A daily AI agent that aggregates customer signals from multiple sources, synthesizes cross-source themes using Claude, files GitHub Issues for critical problems, and commits a structured report to your repo.

Built to demonstrate multi-MCP agent architecture. Fork it, point it at your product, and get a daily customer intelligence report in your inbox — or just in your repo.

---

## What It Does

1. **Pulls data** from 4 sources via MCP servers: Trustpilot, App Store, Reddit, and support tickets/analytics (CSV)
2. **Claude synthesizes** across all sources to find themes — a login bug that appears in reviews AND Reddit AND support tickets is more critical than one that appears in just one place
3. **Files GitHub Issues** for problems with 3+ cross-source mentions, with severity labels
4. **Commits a daily report** to `reports/YYYY-MM-DD.md`

---

## Architecture

```
voc-agent/
├── src/
│   ├── coordinator.ts              # Entry point — hub-and-spoke orchestrator
│   ├── lib/
│   │   └── mcp.ts                  # Shared MCP utilities (startMcpServer, callTool)
│   ├── subagents/
│   │   ├── data-collector.ts       # Generic agentic loop for one data source
│   │   ├── synthesizer.ts          # Cross-source theme synthesis (no tools)
│   │   └── reporter.ts             # GitHub Issue filing + report commit
│   └── mcp-servers/
│       ├── reviews/index.ts        # Trustpilot + App Store public APIs
│       ├── reddit/index.ts         # Reddit public API
│       ├── support/index.ts        # Support tickets from CSV
│       └── analytics/index.ts     # Analytics events from CSV
├── data/
│   ├── support-tickets.csv             # Mock or real support data
│   └── analytics-events.csv           # Mock or real analytics data
├── .github/workflows/
│   └── daily-voc.yml               # Runs every day at 8am UTC
├── reports/                            # Daily reports committed here
└── config.json                         # Your product config
```

The coordinator starts all 5 MCP servers, then spawns 4 data-collector subagents in parallel via `Promise.all()`. Each subagent receives only its own server's tools — no cross-contamination. Findings are passed as structured JSON to an isolated synthesis subagent, which has no tools and no access to the collectors' conversation history. A reporter subagent then receives only GitHub MCP tools to file Issues and commit the report.

---

## Setup

### 1. Clone and install

```bash
git clone https://github.com/YOUR_USERNAME/voc-agent
cd voc-agent
npm install
```

### 2. Add API keys

```bash
cp .env.example .env
```

Edit `.env`:

| Variable | Where to get it |
|---|---|
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) |
| `GITHUB_TOKEN` | [github.com/settings/tokens](https://github.com/settings/tokens) — needs `repo` scope |
| `REDDIT_CLIENT_ID` | [reddit.com/prefs/apps](https://www.reddit.com/prefs/apps) — create a "script" app |
| `REDDIT_CLIENT_SECRET` | Same Reddit app |

### 3. Configure your product

Edit `config.json`:

```json
{
  "target": {
    "trustpilot_company_slug": "your-company",
    "app_store_app_id": "123456789",
    "app_store_country": "us",
    "reddit_subreddits": ["YourProduct", "YourProductSupport"],
    "support_tickets_file": "./data/support-tickets.csv",
    "analytics_events_file": "./data/analytics-events.csv"
  },
  "thresholds": {
    "issue_filing_min_mentions": 3,
    "confidence_threshold": 5
  },
  "github": {
    "repo": "YOUR_USERNAME/voc-agent",
    "report_branch": "main",
    "report_path": "reports"
  }
}
```

### 4. Add your data

Replace `data/support-tickets.csv` with a real export from Zendesk, Intercom, or any support tool. The CSV needs these columns:

```
id, date, subject, description, category, priority, status
```

Replace `data/analytics-events.csv` with an export from Amplitude, Mixpanel, or PostHog:

```
date, event_name, count, unique_users, prev_week_count, change_pct, is_error_event, funnel_step, drop_off_rate
```

### 5. Run

```bash
npm run agent
```

---

## Example Report Output

```markdown
# VoC Daily Report — 2026-03-13

## Executive Summary
Customers are experiencing a significant login regression affecting ~28% of login attempts,
with corroborating signals across all 4 data sources. Performance degradation is a secondary
theme. Two GitHub Issues filed.

## Top Themes (cross-source)

1. **Login / Authentication failures** — 18 mentions
   - Support tickets: 6 | App Store: 3 | Trustpilot: 4 | Reddit: 5

2. **Performance / Slow load times** — 11 mentions
   - Support tickets: 4 | App Store: 2 | Trustpilot: 2 | Reddit: 3

## Theme Intelligence
| Theme | Confidence | Sources | Key Evidence |
|---|---|---|---|
| Login failures | 9/10 | 4/4 | "Login keeps failing" (Trustpilot), T-1001 (support), login_error +690% (analytics) |
| Performance / Slow load times | 7/10 | 3/4 | "Pages take 10s to load" (App Store), r/Notion post 89↑ |

## Emerging Signals (confidence < 5 — monitoring only, no Issues filed)
- Search autocomplete broken — 2/4 sources, 3 mentions

## Filed GitHub Issues
- #12: [VoC] Login failures — 18 mentions across 4 sources (P1)
- #13: [VoC] Performance degradation — 11 mentions across 4 sources (P2)
```

---

## Swap In Real Integrations

The CSV-based support and analytics servers are intentional placeholders. To connect real tools:

- **Zendesk** → Replace `support/index.ts` with Zendesk API calls
- **Amplitude** → Replace `analytics/index.ts` with Amplitude Data API
- **Intercom** → Replace `support/index.ts` with Intercom conversations API
- **PagerDuty** → Add a new `incidents/index.ts` MCP server

Each integration is isolated — you can swap one without touching the others.

---

## Running on a Schedule

A GitHub Actions workflow is already included at `.github/workflows/daily-voc.yml`. It runs every day at 8am UTC, requires `ANTHROPIC_API_KEY` to be added as a repo secret, and commits the daily report automatically. Trigger it manually anytime from the **Actions** tab.

---

## Tech Stack

- **Claude claude-sonnet-4-6** via `@anthropic-ai/sdk` — synthesis and reasoning
- **Model Context Protocol** via `@modelcontextprotocol/sdk` — tool server architecture
- **GitHub MCP** (`@modelcontextprotocol/server-github`) — issue filing + report commits
- **TypeScript + Node.js**
