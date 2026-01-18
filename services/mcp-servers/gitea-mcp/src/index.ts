#!/usr/bin/env node

/**
 * Gitea MCP Server
 * 
 * Provides MCP tools for interacting with Gitea (issues, PRs, repos, workflows).
 * Supports dual transport: stdio (for OpenCode) and HTTP/SSE (for Conductor).
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { ServerResult } from "@modelcontextprotocol/sdk/types.js";
import { startDualTransportServer } from "@cuemarshal/mcp-shared/transport";
import { IssueTools } from "./tools/issues.js";
import { PullRequestTools } from "./tools/pull-requests.js";
import { RepositoryTools } from "./tools/repositories.js";
import { WorkflowTools } from "./tools/workflows.js";
import { SearchTools } from "./tools/search.js";
import { LabelTools } from "./tools/labels.js";

const SERVER_NAME = "gitea-mcp";
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
  ...IssueTools,
  ...PullRequestTools,
  ...RepositoryTools,
  ...WorkflowTools,
  ...SearchTools,
  ...LabelTools,
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
          (key) => !(tool.parameters.shape as Record<string, { isOptional: () => boolean }>)[key].isOptional()
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

// Start server with dual transport support
startDualTransportServer(server, {
  name: SERVER_NAME,
  version: SERVER_VERSION,
  port: 80,
}).catch((error: Error) => {
  console.error("Failed to start Gitea MCP server:", error);
  process.exit(1);
});
