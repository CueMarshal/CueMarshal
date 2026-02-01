/**
 * WebSocket Server for real-time updates to mobile app
 */

import { WebSocketServer, WebSocket } from "ws";
import { Server as HTTPServer } from "http";
import { logger } from "../utils/logger.js";

export interface WebSocketMessage {
  type: string;
  payload: unknown;
  timestamp: string;
}

export class CueMarshalWebSocketServer {
  private wss: WebSocketServer;
  private clients: Map<string, WebSocket> = new Map();

  constructor(server: HTTPServer) {
    this.wss = new WebSocketServer({ server, path: "/ws" });

    this.wss.on("connection", (ws: WebSocket, req) => {
      const userId = this.extractUserId(req.url);
      
      if (!userId) {
        logger.warn("WebSocket connection rejected: no user ID");
        ws.close(1008, "Authentication required");
        return;
      }

      this.clients.set(userId, ws);
      logger.info({ userId, clientCount: this.clients.size }, "WebSocket client connected");

      ws.on("message", (message: string) => {
        this.handleMessage(userId, message);
      });

      ws.on("close", () => {
        this.clients.delete(userId);
        logger.info({ userId, clientCount: this.clients.size }, "WebSocket client disconnected");
      });

      ws.on("error", (error) => {
        logger.error({ userId, error }, "WebSocket error");
      });

      // Send welcome message
      this.sendToClient(userId, {
        type: "connected",
        payload: { message: "Connected to CueMarshal platform" },
        timestamp: new Date().toISOString(),
      });
    });

    logger.info("WebSocket server initialized");
  }

  private extractUserId(url: string | undefined): string | null {
    if (!url) return null;
    
    const params = new URLSearchParams(url.split("?")[1]);
    const token = params.get("token");
    
    // TODO: Validate token and extract user ID
    // For now, return a placeholder
    return token ? "user-from-token" : null;
  }

  private handleMessage(userId: string, message: string) {
    try {
      const data = JSON.parse(message);
      
      switch (data.type) {
        case "ping":
          this.sendToClient(userId, {
            type: "pong",
            payload: {},
            timestamp: new Date().toISOString(),
          });
          break;
        case "subscribe":
          // Handle project subscription
          logger.info({ userId, project: data.payload?.project }, "Client subscribed to project");
          break;
        default:
          logger.warn({ userId, type: data.type }, "Unknown message type");
      }
    } catch (error) {
      logger.error({ userId, error }, "Failed to parse WebSocket message");
    }
  }

  /**
   * Send a message to a specific client
   */
  sendToClient(userId: string, message: WebSocketMessage) {
    const client = this.clients.get(userId);
    if (client && client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  }

  /**
   * Broadcast a message to all connected clients
   */
  broadcast(message: WebSocketMessage) {
    const messageStr = JSON.stringify(message);
    for (const [_userId, client] of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(messageStr);
      }
    }
    logger.debug({ type: message.type, clientCount: this.clients.size }, "Broadcast message");
  }

  /**
   * Send task update to relevant clients
   */
  sendTaskUpdate(taskId: string, update: {
    status?: string;
    progress?: number;
    message?: string;
  }) {
    this.broadcast({
      type: "task:progress",
      payload: { task_id: taskId, ...update },
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Send PR update to relevant clients
   */
  sendPRUpdate(prNumber: number, type: "reviewed" | "merged", payload: Record<string, unknown>) {
    this.broadcast({
      type: `pr:${type}`,
      payload: { pr_number: prNumber, ...payload },
      timestamp: new Date().toISOString(),
    });
  }
}

let wsServer: CueMarshalWebSocketServer | null = null;

export function initializeWebSocketServer(httpServer: HTTPServer): CueMarshalWebSocketServer {
  wsServer = new CueMarshalWebSocketServer(httpServer);
  return wsServer;
}

export function getWebSocketServer(): CueMarshalWebSocketServer {
  if (!wsServer) {
    throw new Error("WebSocket server not initialized");
  }
  return wsServer;
}
