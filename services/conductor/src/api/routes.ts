/**
 * API Route Registration
 */

import { Express } from "express";
import { readFile } from "fs/promises";
import webhooksRouter from "./webhooks.js";
import chatRouter from "./chat.js";
import authRouter from "./auth.js";
import mobileRouter from "./mobile.js";
import internalRouter from "./internal.js";
import projectsRouter from "./projects.js";
import { logger } from "../utils/logger.js";

// Cache the oauth2 client ID in memory (it rarely changes)
let _cachedOAuth2ClientId: string | null = null;

async function readOAuth2ClientId(): Promise<string | null> {
  if (_cachedOAuth2ClientId) return _cachedOAuth2ClientId;
  try {
    const raw = await readFile("/tokens/oauth2_client_id", "utf-8");
    _cachedOAuth2ClientId = raw.trim();
    return _cachedOAuth2ClientId;
  } catch {
    logger.warn("Could not read /tokens/oauth2_client_id");
    return null;
  }
}

export function registerRoutes(app: Express) {
  // Webhooks (no /api prefix)
  app.use("/webhooks", webhooksRouter);

  // Mobile and chat APIs
  app.use("/api/chat", chatRouter);

  // Project board APIs
  app.use("/api/projects", projectsRouter);

  // BFF auth endpoints (server-side OAuth2 – clients never need the client ID)
  app.use("/api/auth", authRouter);

  // Public client configuration (no auth required)
  // Kept for backward compatibility; new clients should use /api/auth/* instead
  app.get("/api/config", async (_req, res) => {
    try {
      const oauth2ClientId = await readOAuth2ClientId();
      res.json({
        oauth2ClientId: oauth2ClientId || null,
      });
    } catch (error) {
      logger.error({ error }, "Failed to serve /api/config");
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.use("/api", mobileRouter);

  // Hello endpoint
  app.get("/hello", (_req, res) => {
    const timestamp = new Date().toISOString();
    res.json({
      message: "Hello from CueMarshal!",
      timestamp,
    });
  });

  // Health check
  app.get("/health", (_req, res) => {
    res.json({
      status: "healthy",
      version: "1.0.0",
      uptime: process.uptime(),
    });
  });

  // Internal API (for MCP servers, gateway, and runners)
  app.use("/api/internal", internalRouter);
}
