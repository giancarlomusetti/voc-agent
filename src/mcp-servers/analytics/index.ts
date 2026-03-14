/**
 * Analytics MCP Server
 * Reads product analytics events from a CSV file.
 * Mock layer for Amplitude/Mixpanel — swap this server for a real integration.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { parse } from "csv-parse/sync";
import { makeError } from "../../types.js";
import * as fs from "fs";
import * as path from "path";

const server = new Server(
  { name: "analytics-server", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "get_analytics_events",
      description:
        "Read product analytics events and funnel metrics. Returns event names, counts, drop-off rates, and error event spikes. Data comes from a CSV file (swap for Amplitude/Mixpanel in production).",
      inputSchema: {
        type: "object",
        properties: {
          file_path: {
            type: "string",
            description: "Path to the analytics events CSV file",
          },
          days_back: {
            type: "number",
            description: "Only return events from the last N days (default 7)",
          },
        },
        required: ["file_path"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "get_analytics_events") {
    const { file_path, days_back = 7 } = args as {
      file_path: string;
      days_back?: number;
    };

    const absolutePath = path.resolve(process.cwd(), file_path);

    if (!fs.existsSync(absolutePath)) {
      return {
        isError: true,
        content: [{
          type: "text",
          text: JSON.stringify(makeError(
            "validation",
            `read analytics events from ${absolutePath}`,
            `Create the file at ${absolutePath} — see data/analytics-events.csv in the repo for the expected CSV format`
          ), null, 2),
        }],
      };
    }

    const csvContent = fs.readFileSync(absolutePath, "utf-8");
    const records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
    }) as Array<{
      date: string;
      event_name: string;
      count: string;
      unique_users: string;
      prev_week_count: string;
      change_pct: string;
      is_error_event: string;
      funnel_step: string;
      drop_off_rate: string;
    }>;

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days_back);

    const filtered = records
      .filter((r) => new Date(r.date) >= cutoffDate)
      .map((r) => ({
        source: "analytics",
        date: r.date,
        event_name: r.event_name,
        count: parseInt(r.count),
        unique_users: parseInt(r.unique_users),
        prev_week_count: parseInt(r.prev_week_count),
        change_pct: parseFloat(r.change_pct),
        is_error_event: r.is_error_event === "true",
        funnel_step: r.funnel_step || null,
        drop_off_rate: r.drop_off_rate ? parseFloat(r.drop_off_rate) : null,
      }));

    // Highlight notable signals
    const errorSpikes = filtered.filter(
      (r) => r.is_error_event && r.change_pct > 20
    );
    const funnelDropoffs = filtered.filter(
      (r) => r.funnel_step && r.drop_off_rate !== null && r.drop_off_rate > 30
    );

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { all_events: filtered, error_spikes: errorSpikes, funnel_dropoffs: funnelDropoffs },
            null,
            2
          ),
        },
      ],
    };
  }

  throw new Error(`Unknown tool: ${name}`);
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
