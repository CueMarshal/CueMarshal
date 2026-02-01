/**
 * Chat Handler Service
 * Processes natural language messages from mobile app using MCP tools
 */

import OpenAI from "openai";
import { loadConfig } from "../config.js";
import { mcpRegistry } from "./mcp-registry.js";
import { db } from "../db/client.js";
import { chatSessions, chatMessages } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { logger } from "../utils/logger.js";

const config = loadConfig();

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
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
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
    });

    return {
      sessionId,
      message: {
        role: "assistant",
        content: finalContent,
      },
      toolCallsSummary: toolCallsSummary.length > 0 ? toolCallsSummary : undefined,
    };
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
