#!/usr/bin/env node

/**
 * System MCP Server
 * 
 * Provides MCP tools for system observability: costs, runner status, health checks,
 * logs (Loki), metrics (Prometheus), and dashboards (Grafana).
 * Supports dual transport: stdio (for OpenCode) and HTTP/SSE (for Conductor chat).
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { ServerResult } from "@modelcontextprotocol/sdk/types.js";
import { startDualTransportServer } from "@cuemarshal/mcp-shared/transport";
import { CostTools } from "./tools/costs.js";
import { RunnerTools } from "./tools/runners.js";
import { HealthTools } from "./tools/health.js";
import { LogTools } from "./tools/logs.js";
import { MetricTools } from "./tools/metrics.js";
import { DashboardTools } from "./tools/dashboards.js";

const SERVER_NAME = "system-mcp";
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
  ...CostTools,
  ...RunnerTools,
  ...HealthTools,
  ...LogTools,
  ...MetricTools,
  ...DashboardTools,
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

// Start server
startDualTransportServer(server, {
  name: SERVER_NAME,
  version: SERVER_VERSION,
  port: 80,
}).catch((error: Error) => {
  console.error("Failed to start System MCP server:", error);
  process.exit(1);
});
