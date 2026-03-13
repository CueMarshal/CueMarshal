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
import { config } from "./config.js";
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

  // Initialize MCP server connections (non-fatal — reconnects in background)
  try {
    await mcpRegistry.initialize();
    logger.info("✓ MCP servers connected (or connecting in background)");
  } catch (error) {
    logger.warn({ error }, "MCP initialization had errors — health monitor will retry");
  }

  // Create Express app
  const app = express();
  app.use(express.json({
    limit: "10mb",
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    },
  }));
  app.use(express.urlencoded({ extended: true }));

  // CORS — restrict to known origins; allow wildcard only in development.
  const ALLOWED_ORIGINS = [
    "cuemarshal://",          // React Native deep-link scheme
    config.nodeEnv === "development" ? "*" : null,
  ].filter(Boolean) as string[];

  app.use((req, res, next) => {
    const origin = req.headers.origin || "";
    const allowed =
      config.nodeEnv === "development" ||
      ALLOWED_ORIGINS.some((o) => origin === o || origin.startsWith(o));

    if (allowed && origin) {
      res.header("Access-Control-Allow-Origin", origin);
    }
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.header("Vary", "Origin");
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
        
        // Check for initialization marker file OR if tokens directory has OAuth client ID
        // (indicating the init-gitea job has completed and populated the ConfigMap)
        try {
          await fs.access("/tokens/.initialized");
          logger.info("✓ System initialized (marker file found)");
          return true;
        } catch {
          // If marker file doesn't exist, check if tokens have been created by init job
          // This handles the case where init-gitea job created tokens but the marker file wasn't preserved
          try {
            await fs.access("/tokens/oauth2_client_id");
            logger.info("✓ System initialized (tokens found in ConfigMap)");
            return true;
          } catch {
            // Tokens not ready yet
            throw new Error("Tokens not yet available");
          }
        }
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
