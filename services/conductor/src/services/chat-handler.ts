/**
 * Chat Handler Service
 * Processes natural language messages from mobile app using MCP tools
 */

import OpenAI from "openai";
import { config } from "../config.js";
import { mcpRegistry } from "./mcp-registry.js";
import { db } from "../db/client.js";
import { chatSessions, chatMessages } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { logger } from "../utils/logger.js";


const gateway = new OpenAI({
  baseURL: `${config.gatewayUrl}/v1`,
  apiKey: config.gatewayApiKey,
});

const SYSTEM_PROMPT = `You are the Conductor — the central orchestrator of the CueMarshal software platform. You ARE the system, not an external assistant. You have direct access to all projects, tasks, agents, costs, and infrastructure through your tools.

**Identity Rules:**
- Never say "I'm an AI", "I don't have direct access", or "I can suggest a way to get the information"
- Never describe tools to the user or suggest they use tools themselves — just USE the tools silently and present the results
- Speak in first person as the Conductor: "I'm currently working on 3 projects" not "There appear to be 3 projects"
- If a user asks a question that requires data, call the appropriate tool FIRST, then answer with the results
- Never respond with empty results or placeholders — if a tool returns no data, say so clearly (e.g., "There are no active projects right now")

You have access to tools that let you:
- List and manage projects, including creation, planning, and progress tracking
- Create and manage Gitea repositories, issues, and pull requests
- Query task status, agent availability, and project progress
- Check LLM costs, runner utilization, and system health

**Project Creation Workflow:**
When a user describes a new project (e.g., "Build a REST API for user authentication"), follow these steps:
1. Ask clarifying questions to understand: goals, tech stack, key features, constraints
2. Use project_create tool with the gathered requirements - this creates the repo and generates a comprehensive plan
3. Present the generated plan to the user, highlighting:
   - Milestones with acceptance criteria
   - Key issues and their dependencies
   - Architecture checkpoints that will require their input
4. When user approves, use project_approve tool - this executes the plan by creating milestones and issues
5. Inform them that agents will start working autonomously, pausing at architecture checkpoints for their review

**Project Lifecycle Awareness:**
- Projects are repositories in Gitea with associated milestones and issues
- Each issue triggers automated agent workflows (developer, reviewer, tester, etc.)
- The Conductor orchestrates all work and maintains priority: project tasks > self-improvement
- When all issues are closed, the project is automatically marked as completed

**User Interaction:**
- Confirm major actions (repo creation, issue creation) before executing
- For project planning, present the generated plan and ask for approval
- Keep responses concise but informative
- Proactively suggest next steps when projects reach checkpoints
- When asked a data question, always call the relevant tool first — never guess or hedge

Always call the appropriate tools. When asked about status, query the real data and present it directly as your own knowledge.`;

export interface ChatMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

export interface StreamCallbacks {
  onChunk: (chunk: { type: "text" | "tool_call" | "session_id"; delta?: string; tool?: string; result_summary?: string; session_id?: string }) => void;
  onDone: (fullResponse: { sessionId: string; content: string; toolCallsSummary?: Array<{ tool: string; result_summary: string }> }) => void;
  onError: (error: Error) => void;
}

export class ChatHandler {
  /**
   * Process a chat message with MCP tool support
   */
  async handleMessage(input: {
    userId: string;
    sessionId?: string;
    message: string;
    authToken?: string;
  }): Promise<{
    sessionId: string;
    message: ChatMessage;
    toolCallsSummary?: Array<{ tool: string; result_summary: string }>;
  }> {
    // Get or create session
    let sessionId = input.sessionId;
    if (!sessionId) {
      const [session] = await db
        .insert(chatSessions)
        .values({ userId: input.userId })
        .returning();
      sessionId = session.id;
    }

    // Load conversation history
    const history = await this.loadHistory(sessionId);

    // Add user message
    await db.insert(chatMessages).values({
      sessionId,
      role: "user",
      content: input.message,
    });

    history.push({ role: "user", content: input.message });

    // Get MCP tool definitions
    const tools = mcpRegistry.getToolDefinitions();

    // Call LLM with tools
    const completion = await gateway.chat.completions.create({
      model: config.chatModel,
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...history] as any,
      tools,
      tool_choice: "auto",
    });

    let assistantMessage = completion.choices[0]?.message;
    const toolCallsSummary: Array<{ tool: string; result_summary: string }> = [];

    // Handle tool calls
    while (assistantMessage?.tool_calls && assistantMessage.tool_calls.length > 0) {
      logger.info(
        { toolCalls: assistantMessage.tool_calls.map((tc) => tc.function.name) },
        "Executing tool calls"
      );

      // Add assistant message with tool_calls to history (required by OpenAI API)
      history.push({
        role: "assistant",
        content: assistantMessage.content || null,
        tool_calls: assistantMessage.tool_calls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.function.name, arguments: tc.function.arguments },
        })),
      } as any);

      // Execute each tool call
      for (const toolCall of assistantMessage.tool_calls) {
        const toolName = toolCall.function.name;
        const toolArgs = JSON.parse(toolCall.function.arguments);

        if (input.authToken && toolName.startsWith("gitea_") && !toolArgs.authToken) {
          toolArgs.authToken = input.authToken;
        }

        try {
          const result = await mcpRegistry.executeTool(toolName, toolArgs);
          
          // Extract text content from MCP response
          const resultText = this.extractTextFromMCPResponse(result);

          // Add tool result to history
          history.push({
            role: "tool",
            content: resultText,
            tool_call_id: toolCall.id,
          });

          toolCallsSummary.push({
            tool: toolName,
            result_summary: this.summarizeResult(toolName, resultText),
          });
        } catch (error) {
          logger.error({ error, tool: toolName }, "Tool execution failed");
          history.push({
            role: "tool",
            content: `Error executing ${toolName}: ${(error as Error).message}`,
            tool_call_id: toolCall.id,
          });
        }
      }

      // Continue conversation with tool results
      const followUp = await gateway.chat.completions.create({
        model: config.chatModel,
        messages: [{ role: "system", content: SYSTEM_PROMPT }, ...history] as any,
        tools,
        tool_choice: "auto",
      });

      assistantMessage = followUp.choices[0]?.message;
    }

    // Save assistant message
    const finalContent = assistantMessage?.content || "I apologize, I encountered an issue.";
    await db.insert(chatMessages).values({
      sessionId,
      role: "assistant",
      content: finalContent,
      toolCalls: assistantMessage?.tool_calls ? assistantMessage.tool_calls : null,
    });

    // Auto-generate title for new sessions (first message)
    await this.maybeGenerateTitle(sessionId, input.message);

    return {
      sessionId,
      message: {
        role: "assistant",
        content: finalContent,
      },
      toolCallsSummary: toolCallsSummary.length > 0 ? toolCallsSummary : undefined,
    };
  }

  /**
   * Stream a chat message response via SSE callbacks.
   * Text content is streamed token-by-token; tool calls are emitted as discrete events.
   */
  async streamMessage(
    input: { userId: string; sessionId?: string; message: string; authToken?: string },
    callbacks: StreamCallbacks,
  ): Promise<void> {
    let sessionId = input.sessionId;
    if (!sessionId) {
      const [session] = await db
        .insert(chatSessions)
        .values({ userId: input.userId })
        .returning();
      sessionId = session.id;
    }

    callbacks.onChunk({ type: "session_id", session_id: sessionId });

    const history = await this.loadHistory(sessionId);

    await db.insert(chatMessages).values({
      sessionId,
      role: "user",
      content: input.message,
    });

    history.push({ role: "user", content: input.message });

    const tools = mcpRegistry.getToolDefinitions();
    const toolCallsSummary: Array<{ tool: string; result_summary: string }> = [];
    let fullContent = "";

    const collectStreamChunks = async (stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>): Promise<{
      chunkContent: string;
      toolCallEntries: Array<{ id: string; name: string; args: string }>;
    }> => {
      const pendingToolCalls: Record<number, { id: string; name: string; args: string }> = {};
      let chunkContent = "";
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        if (!delta) continue;
        if (delta.content) {
          chunkContent += delta.content;
          fullContent += delta.content;
          callbacks.onChunk({ type: "text", delta: delta.content });
        }
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index;
            if (!pendingToolCalls[idx]) pendingToolCalls[idx] = { id: tc.id || "", name: tc.function?.name || "", args: "" };
            if (tc.id) pendingToolCalls[idx].id = tc.id;
            if (tc.function?.name) pendingToolCalls[idx].name = tc.function.name;
            if (tc.function?.arguments) pendingToolCalls[idx].args += tc.function.arguments;
          }
        }
      }
      return { chunkContent, toolCallEntries: Object.values(pendingToolCalls) };
    };

    const dispatchToolCalls = async (
      toolCallEntries: Array<{ id: string; name: string; args: string }>,
    ): Promise<void> => {
      for (const tc of toolCallEntries) {
        const toolArgs = JSON.parse(tc.args);
        if (input.authToken && tc.name.startsWith("gitea_") && !toolArgs.authToken) {
          toolArgs.authToken = input.authToken;
        }
        try {
          const result = await mcpRegistry.executeTool(tc.name, toolArgs);
          const resultText = this.extractTextFromMCPResponse(result);
          history.push({ role: "tool", content: resultText, tool_call_id: tc.id });
          const summary = this.summarizeResult(tc.name, resultText);
          toolCallsSummary.push({ tool: tc.name, result_summary: summary });
          callbacks.onChunk({ type: "tool_call", tool: tc.name, result_summary: summary });
        } catch (error) {
          logger.error({ error, tool: tc.name }, "Streaming tool execution failed");
          history.push({ role: "tool", content: `Error executing ${tc.name}: ${(error as Error).message}`, tool_call_id: tc.id });
          callbacks.onChunk({ type: "tool_call", tool: tc.name, result_summary: "Failed" });
        }
      }
    };

    const streamOnce = async (): Promise<boolean> => {
      const stream = await gateway.chat.completions.create({
        model: config.chatModel,
        messages: [{ role: "system", content: SYSTEM_PROMPT }, ...history] as any,
        tools,
        tool_choice: "auto",
        stream: true,
      });

      const { chunkContent, toolCallEntries } = await collectStreamChunks(stream);
      if (toolCallEntries.length === 0) return false;

      history.push({
        role: "assistant",
        content: chunkContent || null,
        tool_calls: toolCallEntries.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.name, arguments: tc.args },
        })),
      } as any);

      await dispatchToolCalls(toolCallEntries);
      return true;
    };

    try {
      let hasMoreToolCalls = true;
      while (hasMoreToolCalls) {
        hasMoreToolCalls = await streamOnce();
      }

      const finalContent = fullContent || "I apologize, I encountered an issue.";
      await db.insert(chatMessages).values({
        sessionId,
        role: "assistant",
        content: finalContent,
        toolCalls: toolCallsSummary.length > 0 ? toolCallsSummary : null,
      });

      await this.maybeGenerateTitle(sessionId, input.message);

      callbacks.onDone({
        sessionId,
        content: finalContent,
        toolCallsSummary: toolCallsSummary.length > 0 ? toolCallsSummary : undefined,
      });
    } catch (error) {
      callbacks.onError(error as Error);
    }
  }

  /**
   * Auto-generate a session title from the first user message if none exists yet.
   */
  private async maybeGenerateTitle(sessionId: string, userMessage: string): Promise<void> {
    try {
      const session = await db.query.chatSessions.findFirst({
        where: eq(chatSessions.id, sessionId),
      });
      if (session?.title) return;

      // Simple heuristic: use first ~60 chars of the first message
      const title = userMessage.length > 60
        ? userMessage.substring(0, 57) + "..."
        : userMessage;

      await db
        .update(chatSessions)
        .set({ title, updatedAt: new Date() })
        .where(eq(chatSessions.id, sessionId));
    } catch (error) {
      logger.warn({ error, sessionId }, "Failed to auto-generate session title");
    }
  }

  private async loadHistory(sessionId: string): Promise<ChatMessage[]> {
    const messages = await db.query.chatMessages.findMany({
      where: eq(chatMessages.sessionId, sessionId),
      orderBy: (messages, { asc }) => [asc(messages.createdAt)],
      limit: 20, // Last 20 messages for context
    });

    return messages.map((msg) => ({
      role: msg.role as "user" | "assistant" | "tool",
      content: msg.content || "",
      tool_calls: msg.toolCalls as any,
      tool_call_id: msg.toolCallId ?? undefined,
    }));
  }

  private extractTextFromMCPResponse(result: unknown): string {
    if (typeof result === "object" && result !== null) {
      const content = (result as any).content;
      if (Array.isArray(content) && content[0]?.type === "text") {
        return content[0].text;
      }
    }
    return JSON.stringify(result);
  }

  private summarizeResult(toolName: string, result: string): string {
    try {
      const parsed = JSON.parse(result);
      
      // Tool-specific summaries
      if (toolName === "gitea_create_issue") {
        return `Created issue #${parsed.number}`;
      }
      if (toolName === "gitea_create_pull_request") {
        return `Created PR #${parsed.number}`;
      }
      if (toolName.startsWith("gitea_list") || toolName.startsWith("project_list")) {
        const count = Array.isArray(parsed) ? parsed.length : parsed.total || 0;
        return `Found ${count} items`;
      }
      
      return "Success";
    } catch {
      return "Completed";
    }
  }
}

export const chatHandler = new ChatHandler();
