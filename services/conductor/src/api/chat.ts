/**
 * Chat API Routes
 */

import { Router, Request, Response } from "express";
import { validateMobileToken } from "../middleware/auth.js";
import { chatHandler } from "../services/chat-handler.js";
import { logger } from "../utils/logger.js";
import { db } from "../db/client.js";
import { chatSessions, chatMessages } from "../db/schema.js";
import { eq, and } from "drizzle-orm";

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
router.get("/sessions", validateMobileToken, async (req: Request, res: Response) => {
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
          title: session.title,
          is_favorite: session.isFavorite,
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
router.get("/sessions/:id", validateMobileToken, async (req: Request, res: Response): Promise<void> => {
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

/**
 * POST /api/chat/sessions
 * Create a new chat session
 */
router.post("/sessions", validateMobileToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user?.id || "anonymous";
    const { title } = req.body;

    const [session] = await db.insert(chatSessions).values({
      userId,
      title: title || null,
    }).returning();

    res.status(201).json({
      id: session.id,
      title: session.title,
      is_favorite: session.isFavorite,
      created_at: session.createdAt,
      updated_at: session.updatedAt,
    });
  } catch (error) {
    logger.error({ error }, "Failed to create chat session");
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to create session" } });
  }
});

/**
 * PATCH /api/chat/sessions/:id
 * Update session title/favorite
 */
router.patch("/sessions/:id", validateMobileToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const sessionId = req.params.id as string;
    const userId = (req as any).user?.id || "anonymous";
    const { title, is_favorite } = req.body;

    // Verify ownership
    const existing = await db.query.chatSessions.findFirst({
      where: and(eq(chatSessions.id, sessionId), eq(chatSessions.userId, userId)),
    });

    if (!existing) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Session not found" } });
      return;
    }

    const updateData: Record<string, any> = { updatedAt: new Date() };
    if (title !== undefined) updateData.title = title;
    if (is_favorite !== undefined) updateData.isFavorite = is_favorite;

    const [updated] = await db.update(chatSessions)
      .set(updateData)
      .where(eq(chatSessions.id, sessionId))
      .returning();

    res.json({
      id: updated.id,
      title: updated.title,
      is_favorite: updated.isFavorite,
      created_at: updated.createdAt,
      updated_at: updated.updatedAt,
    });
  } catch (error) {
    logger.error({ error }, "Failed to update chat session");
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to update session" } });
  }
});

/**
 * DELETE /api/chat/sessions/:id
 * Delete session (cascade deletes messages)
 */
router.delete("/sessions/:id", validateMobileToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const sessionId = req.params.id as string;
    const userId = (req as any).user?.id || "anonymous";

    // Verify ownership
    const existing = await db.query.chatSessions.findFirst({
      where: and(eq(chatSessions.id, sessionId), eq(chatSessions.userId, userId)),
    });

    if (!existing) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Session not found" } });
      return;
    }

    await db.delete(chatSessions).where(eq(chatSessions.id, sessionId));

    res.status(204).send();
  } catch (error) {
    logger.error({ error }, "Failed to delete chat session");
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to delete session" } });
  }
});

export default router;
