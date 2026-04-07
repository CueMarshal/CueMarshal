/**
 * MCP Server Registry
 * Manages connections to MCP servers via HTTP/SSE transport
 * with automatic reconnection, retry logic, and health monitoring.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import type OpenAI from "openai";


/** Backoff / retry constants */
const INITIAL_CONNECT_MAX_RETRIES = 30;       // ~2.5 min with base delay
const INITIAL_CONNECT_BASE_DELAY_MS = 2_000;
const RECONNECT_MAX_RETRIES = 10;
const RECONNECT_BASE_DELAY_MS = 1_000;
const RECONNECT_MAX_DELAY_MS = 30_000;
const HEALTH_CHECK_INTERVAL_MS = 30_000;      // check every 30 s
const TOOL_EXEC_RETRIES = 2;                  // retry a tool call after reconnect

interface MCPConnection {
  client: Client;
  transport: SSEClientTransport;
  tools: Map<string, any>;
  /** Marks whether the connection is believed to be healthy */
  healthy: boolean;
}

interface ServerEntry {
  name: string;
  url: string;
}

export class MCPRegistry {
  private connections: Map<string, MCPConnection> = new Map();
  private toolToServer: Map<string, string> = new Map();
  private serverEntries: ServerEntry[] = [];
  private healthInterval: ReturnType<typeof setInterval> | null = null;
  /** Prevents concurrent reconnect attempts for the same server */
  private reconnecting: Set<string> = new Set();

  private static OPTIONAL_SERVERS = new Set(["sonar"]);

  // ───────── Initialization ─────────

  /**
   * Connect to all configured MCP servers.
   *
   * Connections are attempted with retry + backoff so the conductor can
   * start even when MCP server pods are still rolling out (e.g. after
   * `helm upgrade`).  Required servers that remain unreachable after all
   * retries are logged as errors but do NOT crash the process — the
   * background health monitor will keep trying.
   */
  async initialize(): Promise<void> {
    logger.info("Initializing MCP server connections");

    this.serverEntries = [
      { name: "gitea", url: config.mcpGiteaUrl },
      { name: "conductor", url: config.mcpConductorUrl },
      { name: "system", url: config.mcpSystemUrl },
      { name: "vector", url: config.mcpVectorUrl },
    ];

    if (config.mcpSonarUrl) {
      this.serverEntries.push({ name: "sonar", url: config.mcpSonarUrl });
    }

    // Attempt initial connections in parallel; failures are tolerated.
    await Promise.all(
      this.serverEntries.map(({ name, url }) =>
        this.connectWithRetry(name, url, INITIAL_CONNECT_MAX_RETRIES, INITIAL_CONNECT_BASE_DELAY_MS)
      )
    );

    logger.info(
      { toolCount: this.toolToServer.size, connectedServers: [...this.connections.keys()] },
      "MCP registry initialized"
    );

    // Start background health monitor
    this.startHealthMonitor();
  }

  // ───────── Connection helpers ─────────

  /**
   * Connect to a single MCP server with retry + exponential backoff.
   * Returns `true` if connected, `false` otherwise.
   */
  private async connectWithRetry(
    name: string,
    url: string,
    maxRetries: number,
    baseDelay: number,
  ): Promise<boolean> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.connectToServer(name, url);
        return true;
      } catch (error) {
        const isOptional = MCPRegistry.OPTIONAL_SERVERS.has(name);
        const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), RECONNECT_MAX_DELAY_MS);

        if (attempt === maxRetries) {
          if (isOptional) {
            logger.warn({ server: name, url }, "Optional MCP server unavailable after retries — skipping");
          } else {
            logger.error(
              { server: name, url, attempts: maxRetries },
              "Required MCP server unavailable after retries — will keep trying in background"
            );
          }
          return false;
        }

        logger.warn(
          { server: name, attempt, maxRetries, nextRetryMs: delay, error: (error as Error).message },
          "MCP connection attempt failed, retrying…"
        );
        await this.sleep(delay);
      }
    }
    return false;
  }

  /**
   * Low-level: open an SSE connection, discover tools, and register them.
   * Throws on failure — callers handle retries.
   */
  private async connectToServer(name: string, url: string): Promise<void> {
    // Tear down any existing connection first
    await this.disconnectServer(name);

    const transport = new SSEClientTransport(new URL(`${url}/sse`));
    const client = new Client(
      { name: `conductor-${name}-client`, version: "1.0.0" },
      { capabilities: {} },
    );

    await client.connect(transport);
    logger.info({ server: name, url }, "Connected to MCP server");

    const response = await client.listTools(undefined, { timeout: 5000 });

    const tools = new Map<string, any>();
    for (const tool of response.tools) {
      tools.set(tool.name, tool);
      this.toolToServer.set(tool.name, name);
    }

    this.connections.set(name, { client, transport, tools, healthy: true });
    logger.info({ server: name, toolCount: tools.size }, "Discovered MCP tools");
  }

  /**
   * Gracefully disconnect a single server (if connected).
   */
  private async disconnectServer(name: string): Promise<void> {
    const existing = this.connections.get(name);
    if (!existing) return;

    try {
      await existing.client.close();
    } catch {
      // Swallow — the connection may already be dead.
    }

    // Remove tool mappings that belonged to this server
    for (const [toolName, serverName] of this.toolToServer) {
      if (serverName === name) this.toolToServer.delete(toolName);
    }

    this.connections.delete(name);
  }

  /**
   * Trigger a reconnect for a specific server.
   * Serialised so only one reconnect attempt runs per server at a time.
   */
  private async reconnectServer(name: string): Promise<boolean> {
    if (this.reconnecting.has(name)) return false;
    this.reconnecting.add(name);

    const entry = this.serverEntries.find((s) => s.name === name);
    if (!entry) {
      this.reconnecting.delete(name);
      return false;
    }

    logger.info({ server: name }, "Attempting MCP server reconnection");

    try {
      const ok = await this.connectWithRetry(
        name,
        entry.url,
        RECONNECT_MAX_RETRIES,
        RECONNECT_BASE_DELAY_MS,
      );
      return ok;
    } finally {
      this.reconnecting.delete(name);
    }
  }

  // ───────── Health monitoring ─────────

  /**
   * Background loop that pings every registered server and
   * reconnects any that have become unreachable.
   */
  private startHealthMonitor(): void {
    if (this.healthInterval) return;

    this.healthInterval = setInterval(async () => {
      for (const entry of this.serverEntries) {
        const conn = this.connections.get(entry.name);

        if (!conn) {
          // Not connected at all — try to reconnect
          logger.info({ server: entry.name }, "Health monitor: server not connected, reconnecting");
          this.reconnectServer(entry.name).catch(() => {});
          continue;
        }

        // Probe the connection by listing tools
        try {
          await conn.client.listTools(undefined, { timeout: 5000 });
          if (!conn.healthy) {
            conn.healthy = true;
            logger.info({ server: entry.name }, "Health monitor: server recovered");
          }
        } catch {
          conn.healthy = false;
          logger.warn({ server: entry.name }, "Health monitor: server unreachable, reconnecting");
          this.reconnectServer(entry.name).catch(() => {});
        }
      }
    }, HEALTH_CHECK_INTERVAL_MS);

    // Allow the process to exit even if the interval is still active
    if (this.healthInterval.unref) {
      this.healthInterval.unref();
    }

    logger.info({ intervalMs: HEALTH_CHECK_INTERVAL_MS }, "MCP health monitor started");
  }

  // ───────── Tool access ─────────

  /**
   * Get all tools in OpenAI function-calling format
   */
  getToolDefinitions(): OpenAI.ChatCompletionTool[] {
    const tools: OpenAI.ChatCompletionTool[] = [];

    for (const [_serverName, connection] of this.connections) {
      if (!connection.healthy) continue;
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
   * Execute a tool call, routing to the correct MCP server.
   *
   * If the call fails with what looks like a connection / transport error
   * the registry will reconnect to the target server and retry the call
   * once before propagating the error.
   */
  async executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const serverName = this.toolToServer.get(name);
    if (!serverName) {
      throw new Error(`Unknown tool: ${name}`);
    }

    for (let attempt = 0; attempt <= TOOL_EXEC_RETRIES; attempt++) {
      const connection = this.connections.get(serverName);
      if (!connection || !connection.healthy) {
        const reconnected = await this.reconnectServer(serverName);
        if (!reconnected) {
          throw new Error(`MCP server "${serverName}" is not connected and reconnection failed`);
        }
        continue;
      }

      const outcome = await this.attemptToolCall(connection, name, args);
      if (outcome.success) return outcome.result;

      const callError = outcome.error;
      logger.error({ error: callError, tool: name, server: serverName, attempt, isConnectionError: this.isConnectionError(callError) }, "Tool execution failed");

      if (this.isConnectionError(callError) && attempt < TOOL_EXEC_RETRIES) {
        connection.healthy = false;
        const reconnected = await this.reconnectServer(serverName);
        if (!reconnected) {
          throw new Error(`MCP server "${serverName}" reconnection failed after tool error`);
        }
        logger.info({ server: serverName, tool: name }, "Retrying tool call after reconnect");
        continue;
      }

      throw callError;
    }

    throw new Error(`Tool execution failed after ${TOOL_EXEC_RETRIES} retries: ${name}`);
  }

  private async attemptToolCall(
    connection: { client: { callTool: Function }; healthy: boolean },
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ success: true; result: unknown } | { success: false; error: Error }> {
    try {
      const result = await connection.client.callTool({ name, arguments: args }, undefined, { timeout: 60000 });
      return { success: true, result };
    } catch (error) {
      return { success: false, error: error as Error };
    }
  }

  // ───────── Health check API ─────────

  /**
   * Check connection health for all MCP servers
   */
  async healthCheck(): Promise<Record<string, boolean>> {
    const result: Record<string, boolean> = {};
    for (const entry of this.serverEntries) {
      const conn = this.connections.get(entry.name);
      result[entry.name] = !!conn?.healthy;
    }
    return result;
  }

  // ───────── Shutdown ─────────

  /**
   * Disconnect all MCP servers and stop the health monitor
   */
  async disconnect(): Promise<void> {
    // Stop health monitor
    if (this.healthInterval) {
      clearInterval(this.healthInterval);
      this.healthInterval = null;
    }

    for (const [name] of this.connections) {
      await this.disconnectServer(name);
    }
    this.connections.clear();
    this.toolToServer.clear();
    logger.info("All MCP servers disconnected");
  }

  // ───────── Utilities ─────────

  /**
   * Heuristic to decide whether an error is a transport / connection
   * issue (worth reconnecting) vs. a logical / application error.
   */
  private isConnectionError(error: unknown): boolean {
    if (!error) return false;
    const msg = typeof (error as Error).message === "string" ? (error as Error).message.toLowerCase() : "";
    const rawCode = (error as { code?: unknown }).code;
    const name = typeof rawCode === "string" ? rawCode.toLowerCase() : "";
    return (
      msg.includes("econnrefused") ||
      msg.includes("econnreset") ||
      msg.includes("socket hang up") ||
      msg.includes("network") ||
      msg.includes("timeout") ||
      msg.includes("aborted") ||
      msg.includes("not connected") ||
      msg.includes("transport") ||
      msg.includes("sse") ||
      msg.includes("could not connect") ||
      msg.includes("fetch failed") ||
      msg.includes("unknown session") ||  // Session expired/invalidated on server
      name === "econnrefused" ||
      name === "econnreset" ||
      name === "enotfound" ||
      name === "epipe"
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Singleton instance
export const mcpRegistry = new MCPRegistry();
