/**
 * Conductor MCP Tools - Project Management
 */

import { z } from "zod";
import { conductorRequest } from "../auth.js";
import { readFileSync } from "fs";
import { join } from "path";

export const ProjectTools = {
  project_create: {
    description: "Create a new project (repository + plan). This creates a Gitea repository, initializes workflows, and generates a project plan for user approval.",
    parameters: z.object({
      name: z.string().describe("Project/repository name (lowercase, hyphens allowed)"),
      description: z.string().describe("Project description"),
      goals: z.array(z.string()).optional().describe("Project goals or objectives"),
      private: z.boolean().optional().describe("Whether the repository should be private (default: false)"),
    }),
    handler: async (args: { name: string; description: string; goals?: string[]; private?: boolean }) => {
      // Step 1: Create repository via Gitea MCP tool
      await conductorRequest("POST", "/mcp/execute", {
        server: "gitea",
        tool: "gitea_create_repo",
        arguments: {
          owner: "cuemarshal", // Using default org
          name: args.name,
          description: args.description,
          private: args.private ?? false,
        },
      });

      // Step 2: Copy workflow templates
      const workflowFiles = ["task-execute.yml", "code-review.yml", "run-tests.yml"];
      for (const workflowFile of workflowFiles) {
        try {
          // Read workflow template
          const workflowContent = readFileSync(join("/app/workflows", workflowFile), "utf-8");
          
          // Create workflow in new repo via Gitea MCP
          await conductorRequest("POST", "/mcp/execute", {
            server: "gitea",
            tool: "gitea_create_or_update_file",
            arguments: {
              owner: "cuemarshal",
              repo: args.name,
              filepath: `.gitea/workflows/${workflowFile}`,
              content: workflowContent,
              message: `chore: initialize ${workflowFile} workflow`,
              branch: "main",
            },
          });
        } catch (error) {
          // Non-fatal - continue even if some workflows fail
          console.error(`Failed to copy ${workflowFile}:`, error);
        }
      }

      // Step 3: Generate project plan
      const planResult: any = await conductorRequest("POST", "/api/internal/projects/plan", {
        name: args.name,
        description: args.description,
        goals: args.goals || [],
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              project: {
                name: args.name,
                repo: `cuemarshal/${args.name}`,
                description: args.description,
              },
              plan: planResult.plan,
              message: "Project created successfully. Review the plan and use project_approve to proceed with execution.",
            }, null, 2),
          },
        ],
      };
    },
  },

  project_approve: {
    description: "Approve and execute a project plan. This creates milestones and issues in Gitea based on the approved plan.",
    parameters: z.object({
      name: z.string().describe("Project name"),
      modifications: z.string().optional().describe("Optional modifications to the plan in natural language"),
    }),
    handler: async (args: { name: string; modifications?: string }) => {
      const result: any = await conductorRequest("POST", `/api/internal/projects/${args.name}/execute`, {
        modifications: args.modifications,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              execution: result,
              message: `Project plan approved and executed. Created ${result.milestones_created} milestones and ${result.issues_created} issues. Work will begin automatically.`,
            }, null, 2),
          },
        ],
      };
    },
  },

  project_list: {
    description: "List all projects with summary information including name, status, description, and progress. Use this to answer questions about how many projects exist or to get an overview of all projects.",
    parameters: z.object({
      status: z.string().optional().describe("Filter by status (e.g., 'active', 'completed', 'planning'). Omit to list all projects."),
    }),
    handler: async (args: { status?: string }) => {
      const params = new URLSearchParams();
      if (args.status) params.append("status", args.status);
      const query = params.toString();

      const result: any = await conductorRequest("GET", `/projects${query ? `?${query}` : ""}`);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              projects: result.projects || [],
              total: result.total || 0,
            }, null, 2),
          },
        ],
      };
    },
  },

  project_get_status: {
    description: "Get the current status and progress of a specific project by name",
    parameters: z.object({
      name: z.string().describe("Project name"),
    }),
    handler: async (args: { name: string }) => {
      const result: any = await conductorRequest("GET", `/projects`);
      const project = result.projects?.find((p: any) => p.name === args.name);

      if (!project) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ error: "Project not found" }),
            },
          ],
        };
      }

      // Get progress from Conductor
      const progress = await conductorRequest("GET", `/projects/${args.name}/progress`);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              project,
              progress,
            }, null, 2),
          },
        ],
      };
    },
  },
};
