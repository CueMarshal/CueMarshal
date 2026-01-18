/**
 * Conductor MCP Tools - Task Management
 */

import { z } from "zod";
import { conductorRequest } from "../auth.js";

export const TaskTools = {
  task_report_progress: {
    description: "Agent reports progress on a task",
    parameters: z.object({
      task_id: z.string().describe("Task UUID"),
      progress: z.number().min(0).max(100).describe("Completion percentage (0-100)"),
      status_message: z.string().describe("Human-readable status message"),
      phase: z.string().optional().describe("Current phase (e.g., 'coding', 'testing')"),
    }),
    handler: async (args: {
      task_id: string;
      progress: number;
      status_message: string;
      phase?: string;
    }) => {
      const result = await conductorRequest("POST", `/tasks/${args.task_id}/progress`, {
        progress: args.progress,
        status_message: args.status_message,
        phase: args.phase,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  },

  task_request_help: {
    description: "Agent requests assistance from another role (escalation)",
    parameters: z.object({
      task_id: z.string().describe("Current task UUID"),
      requested_role: z
        .enum(["architect", "developer", "reviewer", "tester", "devops", "docs"])
        .describe("Role needed for help"),
      description: z.string().describe("What help is needed"),
      blocking: z.boolean().optional().describe("Whether this blocks current work (default: false)"),
    }),
    handler: async (args: {
      task_id: string;
      requested_role: string;
      description: string;
      blocking?: boolean;
    }) => {
      const result = await conductorRequest("POST", `/tasks/${args.task_id}/request-help`, {
        requested_role: args.requested_role,
        description: args.description,
        blocking: args.blocking || false,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  },

  task_get_context: {
    description: "Get full context for a task including parent, sub-tasks, and related PRs",
    parameters: z.object({
      task_id: z.string().describe("Task UUID"),
    }),
    handler: async (args: { task_id: string }) => {
      const result = await conductorRequest("GET", `/tasks/${args.task_id}/context`);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  },

  task_list_active: {
    description: "List all in-progress tasks across projects",
    parameters: z.object({
      project: z.string().optional().describe("Filter by project name"),
      role: z.string().optional().describe("Filter by agent role"),
      status: z.string().optional().describe("Filter by status"),
    }),
    handler: async (args: { project?: string; role?: string; status?: string }) => {
      const params = new URLSearchParams();
      if (args.project) params.append("project", args.project);
      if (args.role) params.append("role", args.role);
      if (args.status) params.append("status", args.status);

      const result = await conductorRequest("GET", `/tasks/active?${params}`);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  },
};
