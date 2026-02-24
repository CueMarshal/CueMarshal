/**
 * MCP Server Registry
 * Manages connections to MCP servers via HTTP/SSE transport
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { loadConfig } from "../config.js";
import { logger } from "../utils/logger.js";
import type OpenAI from "openai";

const config = loadConfig();

interface MCPConnection {
  client: Client;
  transport: SSEClientTransport;
  tools: Map<string, any>;
}

export class MCPRegistry {
  private connections: Map<string, MCPConnection> = new Map();
  private toolToServer: Map<string, string> = new Map();

  private static OPTIONAL_SERVERS = new Set(["sonar"]);

  async initialize(): Promise<void> {
    logger.info("Initializing MCP server connections");

    const servers: Array<{ name: string; url: string }> = [
      { name: "gitea", url: config.mcpGiteaUrl },
      { name: "conductor", url: config.mcpConductorUrl },
      { name: "system", url: config.mcpSystemUrl },
      { name: "vector", url: config.mcpVectorUrl },
    ];

    if (config.mcpSonarUrl) {
      servers.push({ name: "sonar", url: config.mcpSonarUrl });
    }

    await Promise.all(
      servers.map(({ name, url }) => this.connectToServer(name, url))
    );

    logger.info(
      { toolCount: this.toolToServer.size },
      "MCP registry initialized"
    );
  }

  private async connectToServer(name: string, url: string): Promise<void> {
    try {
      const transport = new SSEClientTransport(new URL(`${url}/sse`));
      const client = new Client(
        {
          name: `conductor-${name}-client`,
          version: "1.0.0",
        },
        {
          capabilities: {},
        }
      );

      await client.connect(transport);
      logger.info({ server: name, url }, "Connected to MCP server");

      const response = await client.listTools(undefined, { timeout: 5000 });

      const tools = new Map();
      for (const tool of response.tools) {
        tools.set(tool.name, tool);
        this.toolToServer.set(tool.name, name);
      }

      this.connections.set(name, { client, transport, tools });
      logger.info(
        { server: name, toolCount: tools.size },
        "Discovered MCP tools"
      );
    } catch (error) {
      if (MCPRegistry.OPTIONAL_SERVERS.has(name)) {
        logger.warn({ server: name, url }, "Optional MCP server unavailable — skipping");
        return;
      }
      logger.error({ error, server: name, url }, "Failed to connect to MCP server");
      throw error;
    }
  }

  /**
   * Get all tools in OpenAI function-calling format
   */
  getToolDefinitions(): OpenAI.ChatCompletionTool[] {
    const tools: OpenAI.ChatCompletionTool[] = [];

    for (const [_serverName, connection] of this.connections) {
      for (const [toolName, tool] of connection.tools) {
        tools.push({
          type: "function",
          function: {
            name: toolName,
            description: tool.description,
            parameters: tool.inputSchema,
          },
        });
      }
    }

    return tools;
  }

  /**
   * Execute a tool call, routing to the correct MCP server
   */
  async executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const serverName = this.toolToServer.get(name);
    if (!serverName) {
      throw new Error(`Unknown tool: ${name}`);
    }

    const connection = this.connections.get(serverName);
    if (!connection) {
      throw new Error(`Server not connected: ${serverName}`);
    }

    try {
      const response = await connection.client.callTool(
        { name, arguments: args },
        undefined,
        { timeout: 60000 }
      );

      return response;
    } catch (error) {
      logger.error({ error, tool: name, server: serverName }, "Tool execution failed");
      throw error;
    }
  }

  /**
   * Check connection health for all MCP servers
   */
  async healthCheck(): Promise<{ gitea: boolean; conductor: boolean; system: boolean; vector: boolean; sonar: boolean }> {
    return {
      gitea: this.connections.has("gitea"),
      conductor: this.connections.has("conductor"),
      system: this.connections.has("system"),
      vector: this.connections.has("vector"),
      sonar: this.connections.has("sonar"),
    };
  }

  /**
   * Disconnect all MCP servers
   */
  async disconnect(): Promise<void> {
    for (const [name, connection] of this.connections) {
      try {
        await connection.client.close();
        logger.info({ server: name }, "Disconnected from MCP server");
      } catch (error) {
        logger.error({ error, server: name }, "Failed to disconnect from MCP server");
      }
    }
    this.connections.clear();
    this.toolToServer.clear();
  }
}

// Singleton instance
export const mcpRegistry = new MCPRegistry();
