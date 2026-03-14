#!/usr/bin/env node

/**
 * Vector MCP Server
 * 
 * Provides semantic search over project history for context continuity.
 * Uses pgvector extension in PostgreSQL for vector similarity search.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { ServerResult } from "@modelcontextprotocol/sdk/types.js";
import { startDualTransportServer } from "@cuemarshal/mcp-shared/transport";
import type { ZodRawShape } from "zod";
import { SearchTools } from "./tools/search.js";
import { IndexTools } from "./tools/index.js";

const SERVER_NAME = "vector-mcp";
const SERVER_VERSION = "1.0.0";

function getRequiredFields(shape: ZodRawShape): string[] {
  return Object.entries(shape)
    .filter(([, schema]) => !schema.isOptional())
    .map(([key]) => key);
}

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
  ...SearchTools,
  ...IndexTools,
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
        required: getRequiredFields(tool.parameters.shape),
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
}).catch((error: unknown) => {
  console.error("Failed to start Vector MCP server:", error);
  process.exit(1);
});
