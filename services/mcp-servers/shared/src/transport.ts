/**
 * Dual transport setup for MCP servers (stdio + HTTP/SSE)
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";
import type { MCPServerOptions, HealthStatus } from "./types.js";

const startTime = Date.now();

/**
 * Start an MCP server with dual transport support
 * 
 * Transport is selected via MCP_TRANSPORT env var:
 * - "stdio": For OpenCode in runners (default)
 * - "http": For Conductor chat handler
 */
export async function startDualTransportServer(
  server: Server,
  options: MCPServerOptions
): Promise<void> {
  const mode = process.env.MCP_TRANSPORT || "stdio";
  const port = options.port || parseInt(process.env.PORT || "80");

  if (mode === "stdio") {
    // stdio transport for OpenCode in runners
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error(`[${options.name}] Running in stdio mode`);
    
  } else if (mode === "http") {
    // HTTP/SSE transport for Conductor
    const app = express();
    
    app.use(express.json());

    // Track active SSE transports by sessionId for POST routing
    const transports = new Map<string, SSEServerTransport>();
    
    // Health check endpoint
    app.get("/health", (_req, res) => {
      const health: HealthStatus = {
        status: "healthy",
        name: options.name,
        version: options.version,
        uptime: Math.floor((Date.now() - startTime) / 1000),
      };
      res.json(health);
    });
    
    // SSE endpoint for MCP communication
    app.get("/sse", async (_req, res) => {
      console.log(`[${options.name}] SSE connection established`);
      
      const transport = new SSEServerTransport("/message", res);
      transports.set(transport.sessionId, transport);
      console.log(`[${options.name}] Session ${transport.sessionId} registered`);

      // Clean up on disconnect
      res.on("close", () => {
        console.log(`[${options.name}] Session ${transport.sessionId} disconnected`);
        transports.delete(transport.sessionId);
      });

      // MCP Server only supports one active transport; disconnect the
      // previous one before attaching the new connection.
      try {
        await server.close();
      } catch {
        // No existing transport to close
      }
      await server.connect(transport);
    });
    
    // Message endpoint for SSE transport — routes POSTs to the correct session
    app.post("/message", async (req, res) => {
      const sessionId = req.query.sessionId as string;
      if (!sessionId) {
        res.status(400).json({ error: "Missing sessionId query parameter" });
        return;
      }

      const transport = transports.get(sessionId);
      if (!transport) {
        res.status(404).json({ error: `Unknown session: ${sessionId}` });
        return;
      }

      await transport.handlePostMessage(req, res, req.body);
    });
    
    app.listen(port, () => {
      console.log(`[${options.name}] HTTP/SSE server listening on port ${port}`);
      console.log(`[${options.name}] Health: http://localhost:${port}/health`);
      console.log(`[${options.name}] SSE: http://localhost:${port}/sse`);
    });
    
  } else {
    throw new Error(`Unknown MCP_TRANSPORT mode: ${mode}`);
  }
}
