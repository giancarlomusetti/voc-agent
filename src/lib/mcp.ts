/**
 * Shared MCP client utilities used by both the legacy agent and the coordinator.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import * as path from "path";

export interface McpTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  serverName: string;
}

interface ToolResult {
  content: Array<{ type: string; text: string }>;
}

export async function startMcpServer(
  serverPath: string,
  serverName: string
): Promise<Client> {
  const client = new Client(
    { name: "voc-agent", version: "1.0.0" },
    { capabilities: {} }
  );
  const transport = new StdioClientTransport({
    command: "node",
    args: [serverPath],
    env: {
      ...process.env,
      NODE_PATH: path.resolve(process.cwd(), "node_modules"),
    } as Record<string, string>,
  });
  await client.connect(transport);
  return client;
}

export async function getGithubMcpClient(): Promise<Client> {
  const client = new Client(
    { name: "voc-agent", version: "1.0.0" },
    { capabilities: {} }
  );
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    env: {
      ...process.env,
      GITHUB_PERSONAL_ACCESS_TOKEN: process.env.GITHUB_TOKEN ?? "",
    } as Record<string, string>,
  });
  await client.connect(transport);
  return client;
}

export async function listTools(
  client: Client,
  serverName: string
): Promise<McpTool[]> {
  const result = await client.listTools();
  return result.tools.map((t) => ({
    name: t.name,
    description: t.description ?? "",
    input_schema:
      (t.inputSchema as Record<string, unknown>) ?? {
        type: "object",
        properties: {},
      },
    serverName,
  }));
}

export async function callTool(
  clients: Map<string, Client>,
  toolName: string,
  toolInput: Record<string, unknown>,
  allTools: McpTool[]
): Promise<string> {
  const toolDef = allTools.find((t) => t.name === toolName);
  if (!toolDef) throw new Error(`Tool ${toolName} not found`);

  const client = clients.get(toolDef.serverName);
  if (!client) throw new Error(`Client for ${toolDef.serverName} not found`);

  const result = (await client.callTool({
    name: toolName,
    arguments: toolInput,
  })) as ToolResult;
  return result.content.map((c) => c.text).join("\n");
}
