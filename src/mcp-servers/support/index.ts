/**
 * Support Tickets MCP Server
 * Reads customer support tickets from a CSV file.
 * Mock layer for Zendesk/Intercom — swap this server for a real integration.
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
  { name: "support-server", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "get_support_tickets",
      description:
        "Read recent customer support tickets. Returns ticket subject, description, category, priority, and date. Data comes from a CSV file (swap for Zendesk/Intercom in production).",
      inputSchema: {
        type: "object",
        properties: {
          file_path: {
            type: "string",
            description: "Path to the support tickets CSV file",
          },
          limit: {
            type: "number",
            description: "Max tickets to return (default 50)",
          },
          days_back: {
            type: "number",
            description: "Only return tickets from the last N days (default 7)",
          },
        },
        required: ["file_path"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "get_support_tickets") {
    const { file_path, limit = 50, days_back = 7 } = args as {
      file_path: string;
      limit?: number;
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
            `read support tickets from ${absolutePath}`,
            `Create the file at ${absolutePath} — see data/support-tickets.csv in the repo for the expected CSV format`
          ), null, 2),
        }],
      };
    }

    const csvContent = fs.readFileSync(absolutePath, "utf-8");
    const records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
    }) as Array<{
      id: string;
      date: string;
      subject: string;
      description: string;
      category: string;
      priority: string;
      status: string;
    }>;

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days_back);

    const filtered = records
      .filter((r) => new Date(r.date) >= cutoffDate)
      .slice(0, limit)
      .map((r) => ({
        source: "support",
        id: r.id,
        date: r.date,
        subject: r.subject,
        description: r.description,
        category: r.category,
        priority: r.priority,
        status: r.status,
      }));

    return {
      content: [{ type: "text", text: JSON.stringify(filtered, null, 2) }],
    };
  }

  throw new Error(`Unknown tool: ${name}`);
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
