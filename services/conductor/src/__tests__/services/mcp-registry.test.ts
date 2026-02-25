/**
 * Tests for MCPRegistry — reconnection and resilience logic
 */

// Mock dependencies before imports
jest.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: jest.fn().mockImplementation(() => ({
    connect: jest.fn(),
    close: jest.fn(),
    listTools: jest.fn().mockResolvedValue({ tools: [{ name: "test_tool", description: "A test tool", inputSchema: {} }] }),
    callTool: jest.fn().mockResolvedValue({ content: [{ type: "text", text: "ok" }] }),
  })),
}));

jest.mock("@modelcontextprotocol/sdk/client/sse.js", () => ({
  SSEClientTransport: jest.fn().mockImplementation(() => ({})),
}));

jest.mock("../../config.js", () => ({
  loadConfig: () => ({
    mcpGiteaUrl: "http://mcp-gitea",
    mcpConductorUrl: "http://mcp-conductor",
    mcpSystemUrl: "http://mcp-system",
    mcpVectorUrl: "http://mcp-vector",
    mcpSonarUrl: undefined,
  }),
}));

jest.mock("../../utils/logger.js", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import { MCPRegistry } from "../../services/mcp-registry.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

describe("MCPRegistry", () => {
  let registry: MCPRegistry;

  beforeEach(() => {
    jest.clearAllMocks();
    registry = new MCPRegistry();
  });

  afterEach(async () => {
    await registry.disconnect();
  });

  it("should initialize and connect to all required servers", async () => {
    await registry.initialize();

    const health = await registry.healthCheck();
    expect(health.gitea).toBe(true);
    expect(health.conductor).toBe(true);
    expect(health.system).toBe(true);
    expect(health.vector).toBe(true);
  });

  it("should discover tools during initialization", async () => {
    await registry.initialize();

    const tools = registry.getToolDefinitions();
    // Each of the 4 servers registers 1 "test_tool" but they all map to the same name
    // so toolToServer will overwrite, but getToolDefinitions iterates per-connection
    expect(tools.length).toBeGreaterThanOrEqual(1);
  });

  it("should not crash when a required server is unreachable on init", async () => {
    // Make the gitea client fail to connect
    let callCount = 0;
    (Client as jest.Mock).mockImplementation(() => ({
      connect: jest.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 30) throw new Error("ECONNREFUSED");
        return Promise.resolve();
      }),
      close: jest.fn(),
      listTools: jest.fn().mockResolvedValue({ tools: [] }),
      callTool: jest.fn(),
    }));

    // Should NOT throw even though connections fail
    await expect(registry.initialize()).resolves.not.toThrow();
  });

  it("should reconnect and retry tool execution on connection error", async () => {
    let callCount = 0;
    const mockClient = {
      connect: jest.fn(),
      close: jest.fn(),
      listTools: jest.fn().mockResolvedValue({
        tools: [{ name: "my_tool", description: "d", inputSchema: {} }],
      }),
      callTool: jest.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          throw new Error("socket hang up");
        }
        return { content: [{ type: "text", text: "success" }] };
      }),
    };

    (Client as jest.Mock).mockImplementation(() => ({ ...mockClient }));

    await registry.initialize();

    // Tool execution should succeed after reconnect+retry
    const result = await registry.executeTool("my_tool", {});
    expect(result).toBeDefined();
  });

  it("should clean up on disconnect", async () => {
    await registry.initialize();

    await registry.disconnect();

    const health = await registry.healthCheck();
    // All should be false/undefined after disconnect
    for (const val of Object.values(health)) {
      expect(val).toBe(false);
    }
  });
});
