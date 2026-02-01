#!/usr/bin/env node

/**
 * CueMarshal Conductor - Main Entry Point
 * 
 * Starts:
 * 1. Express HTTP server for API and webhooks
 * 2. WebSocket server for real-time updates
 * 3. BullMQ workers for async job processing
 * 4. MCP server connections for tool access
 */

import express from "express";
import { createServer } from "http";
import { loadConfig } from "./config.js";
import { logger } from "./utils/logger.js";
import { testConnection } from "./db/client.js";
import { mcpRegistry } from "./services/mcp-registry.js";
import { initializeWebSocketServer } from "./websocket/server.js";
import { registerRoutes } from "./api/routes.js";
import {
  tasksWorker,
  reviewsWorker,
  workflowsWorker,
} from "./queue/worker.js";
import { recoveryService } from "./queue/recovery.js";

const config = loadConfig();

async function main() {
  logger.info("Starting CueMarshal Conductor...");

  // Test database connection
  const dbConnected = await testConnection();
  if (!dbConnected) {
    logger.error("Failed to connect to database");
    process.exit(1);
  }
  logger.info("✓ Database connected");

  // Run database migrations
  try {
    const { runMigrations } = await import("./db/client.js");
    await runMigrations();
    logger.info("✓ Database migrations completed");
  } catch (error) {
    logger.error({ error }, "Database migration failed");
    process.exit(1);
  }

  // Initialize MCP server connections
  await mcpRegistry.initialize();
  logger.info("✓ MCP servers connected");

  // Create Express app
  const app = express();
  app.use(express.json({
    limit: "10mb",
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    },
  }));
  app.use(express.urlencoded({ extended: true }));

  // CORS for mobile app
  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Authorization, Content-Type");
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });

  // Register routes
  registerRoutes(app);

  // Create HTTP server
  const httpServer = createServer(app);

  // Initialize WebSocket server
  initializeWebSocketServer(httpServer);
  logger.info("✓ WebSocket server initialized");

  // Start HTTP server
  httpServer.listen(config.port, () => {
    logger.info({ port: config.port }, "✓ HTTP server listening");
  });

  // Workers are automatically started when imported
  logger.info("✓ BullMQ workers started");

  // Wait for initialization to complete before starting recovery
  logger.info("Waiting for system initialization...");
  const waitForInit = async () => {
    const MAX_RETRIES = 60; // 5 minutes
    const RETRY_DELAY = 5000;

    for (let i = 0; i < MAX_RETRIES; i++) {
      try {
        const fs = await import("fs/promises");
        await fs.access("/tokens/.initialized");
        logger.info("✓ System initialized");
        return true;
      } catch {
        if (i % 5 === 0) {
          logger.info("Waiting for init-gitea to complete...");
        }
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
      }
    }
    return false;
  };

  const initialized = await waitForInit();
  if (!initialized) {
    logger.error("Initialization timed out - recovery service may fail");
  }

  // Start recovery service - runs every hour to detect and re-trigger orphaned issues
  const RECOVERY_INTERVAL = 60 * 60 * 1000; // 1 hour
  const recoveryInterval = setInterval(async () => {
    try {
      await recoveryService.recoverOrphanedIssues();
    } catch (error) {
      logger.error({ error }, "Recovery service failed");
    }
  }, RECOVERY_INTERVAL);

  // Run recovery once on startup (now that we know init is done)
  if (initialized) {
    // Small delay to ensure everything settles
    setTimeout(async () => {
      try {
        await recoveryService.recoverOrphanedIssues();
      } catch (error) {
        logger.error({ error }, "Initial recovery failed");
      }
    }, 5000);

    logger.info({ intervalMinutes: 60 }, "✓ Recovery service started");
  } else {
    logger.warn("Skipping initial recovery due to initialization timeout");
  }

  // Graceful shutdown
  process.on("SIGTERM", async () => {
    logger.info("SIGTERM received, shutting down gracefully");

    clearInterval(recoveryInterval);
    await mcpRegistry.disconnect();
    await tasksWorker.close();
    await reviewsWorker.close();
    await workflowsWorker.close();

    httpServer.close(() => {
      logger.info("Server shut down");
      process.exit(0);
    });
  });

  logger.info("🚀 CueMarshal Conductor is ready");
}

main().catch((error) => {
  logger.error({ error }, "Fatal error during startup");
  process.exit(1);
});
