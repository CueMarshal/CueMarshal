/**
 * Chat API Routes
 */

import { Router, Request, Response } from "express";
import { validateMobileToken } from "../middleware/auth.js";
import { chatHandler } from "../services/chat-handler.js";
import { logger } from "../utils/logger.js";
import { db } from "../db/client.js";
import { chatSessions, chatMessages } from "../db/schema.js";
import { eq } from "drizzle-orm";

const router = Router();

/**
 * POST /api/chat
 * Send a natural language message and receive MCP-powered response
 * Requires authentication via Bearer token
 */
router.post("/", validateMobileToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const { session_id, message } = req.body;
    const userId = (req as any).user?.id || "anonymous";
    const authToken = (req as any).authToken as string | undefined;

    if (!message || typeof message !== "string") {
      res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "Message is required" } });
      return;
    }

    const result = await chatHandler.handleMessage({
      userId,
      sessionId: session_id,
      message,
      authToken,
    });

    res.json(result);
  } catch (error) {
    logger.error({ error }, "Chat request failed");
    res.status(500).json({
      error: {
        code: "INTERNAL_ERROR",
        message: "Failed to process chat message",
      },
    });
  }
});

/**
 * GET /api/chat/sessions
 * List chat sessions for the authenticated user
 */
router.get("/sessions", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id || "anonymous";

    const sessions = await db.query.chatSessions.findMany({
      where: eq(chatSessions.userId, userId),
      orderBy: (sessions, { desc }) => [desc(sessions.updatedAt)],
      limit: 20,
    });

    // Get message count and preview for each session
    const sessionsWithDetails = await Promise.all(
      sessions.map(async (session) => {
        const messages = await db.query.chatMessages.findMany({
          where: eq(chatMessages.sessionId, session.id),
          orderBy: (messages, { asc }) => [asc(messages.createdAt)],
          limit: 1,
        });

        const messageCount = await db.query.chatMessages.findMany({
          where: eq(chatMessages.sessionId, session.id),
        });

        return {
          id: session.id,
          created_at: session.createdAt,
          updated_at: session.updatedAt,
          message_count: messageCount.length,
          preview: messages[0]?.content?.substring(0, 100) || "",
        };
      })
    );

    res.json({ sessions: sessionsWithDetails });
  } catch (error) {
    logger.error({ error }, "Failed to fetch chat sessions");
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to fetch sessions" } });
  }
});

/**
 * GET /api/chat/sessions/:id
 * Get full chat history for a session
 */
router.get("/sessions/:id", async (req: Request, res: Response): Promise<void> => {
  try {
    const sessionId = req.params.id as string;
    const userId = (req as any).user?.id || "anonymous";

    // Verify session belongs to user
    const session = await db.query.chatSessions.findFirst({
      where: eq(chatSessions.id, sessionId),
    });

    if (!session) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Session not found" } });
      return;
    }

    if (session.userId !== userId) {
      res.status(403).json({ error: { code: "FORBIDDEN", message: "Not authorized" } });
      return;
    }

    const messages = await db.query.chatMessages.findMany({
      where: eq(chatMessages.sessionId, sessionId as string),
      orderBy: (messages, { asc }) => [asc(messages.createdAt)],
    });

    res.json({
      session_id: sessionId,
      messages: messages.map((msg) => ({
        role: msg.role,
        content: msg.content,
        timestamp: msg.createdAt,
      })),
    });
  } catch (error) {
    logger.error({ error }, "Failed to fetch chat history");
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to fetch history" } });
  }
});

export default router;
