#!/usr/bin/env node

/**
 * Conductor MCP Server
 * 
 * Provides MCP tools for task coordination, agent status, and project management.
 * Supports dual transport: stdio (for OpenCode) and HTTP/SSE (for Conductor chat).
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { ServerResult } from "@modelcontextprotocol/sdk/types.js";
import { startDualTransportServer } from "@cuemarshal/mcp-shared/transport";
import { TaskTools } from "./tools/tasks.js";
import { AgentTools } from "./tools/agents.js";
import { ProjectTools } from "./tools/projects.js";
import { SessionTools } from "./tools/sessions.js";

const SERVER_NAME = "conductor-mcp";
const SERVER_VERSION = "1.0.0";

// Create MCP server
const server = new Server(
  {
    name: SERVER_NAME,
    version: SERVER_VERSION,
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Combine all tools
const allTools = {
  ...TaskTools,
  ...AgentTools,
  ...ProjectTools,
  ...SessionTools,
};

// Register tools list handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: Object.entries(allTools).map(([name, tool]) => ({
      name,
      description: tool.description,
      inputSchema: {
        type: "object" as const,
        properties: tool.parameters.shape,
        required: Object.keys(tool.parameters.shape).filter(
          (key) => !isZodOptional(tool.parameters.shape[key as keyof typeof tool.parameters.shape])
        ),
      },
    })),
  };
});

// Register tool call handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  const tool = allTools[name as keyof typeof allTools];
  if (!tool) {
    throw new Error(`Unknown tool: ${name}`);
  }

  try {
    const validatedArgs = tool.parameters.parse(args);
    const result = await (tool.handler as (args: unknown) => Promise<ServerResult>)(validatedArgs);
    return result;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Tool execution failed: ${error.message}`);
    }
    throw error;
  }
});

// Start server
startDualTransportServer(server, {
  name: SERVER_NAME,
  version: SERVER_VERSION,
  port: 80,
}).catch((error: Error) => {
  console.error("Failed to start Conductor MCP server:", error);
  process.exit(1);
});
