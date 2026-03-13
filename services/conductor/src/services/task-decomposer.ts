/**
 * Task Decomposition Service
 * Uses LLM to break down complex tasks into sub-tasks
 */

import OpenAI from "openai";
import { z } from "zod";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";


const gateway = new OpenAI({
  baseURL: `${config.gatewayUrl}/v1`,
  apiKey: config.gatewayApiKey,
});

// Sub-task schema
const SubTaskSchema = z.object({
  title: z.string(),
  description: z.string(),
  role: z.enum(["architect", "developer", "reviewer", "tester", "devops", "docs"]),
  complexity: z.enum(["simple", "standard", "complex"]),
  dependencies: z.array(z.number()).default([]),
});

const DecompositionResponseSchema = z.object({
  sub_tasks: z.array(SubTaskSchema),
});

export interface SubTask {
  title: string;
  description: string;
  role: "architect" | "developer" | "reviewer" | "tester" | "devops" | "docs";
  complexity: "simple" | "standard" | "complex";
  dependencies: number[];
}

export class TaskDecomposer {
  async decompose(input: {
    title: string;
    body: string;
    repo: string;
  }): Promise<SubTask[]> {
    const prompt = this.createDecompositionPrompt(input);

    try {
      const response = await gateway.chat.completions.create({
        model: config.decomposeModel,
        messages: [
          {
            role: "system",
            content: "You are a project manager analyzing tasks for a software development team.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        response_format: { type: "json_object" },
        temperature: 0.3,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error("Empty response from LLM");
      }

      const parsed = JSON.parse(content);
      const validated = DecompositionResponseSchema.parse(parsed);

      logger.info(
        { taskCount: validated.sub_tasks.length, repo: input.repo },
        "Task decomposed successfully"
      );

      return validated.sub_tasks;
    } catch (error) {
      logger.error({ error, repo: input.repo }, "Task decomposition failed");
      // Fallback: return single task
      return [
        {
          title: input.title,
          description: input.body,
          role: "developer",
          complexity: "standard",
          dependencies: [],
        },
      ];
    }
  }

  private createDecompositionPrompt(input: { title: string; body: string; repo: string }): string {
    return `Analyze the following task and break it down into specific, actionable sub-tasks that can be assigned to individual SDLC roles.

Available roles: architect, developer, reviewer, tester, devops, docs

Task Title: ${input.title}

Task Description:
${input.body}

Repository: ${input.repo}

Return a JSON object with a "sub_tasks" array. Each element should have:
- title: string (concise sub-task title)
- description: string (detailed instructions for the agent)
- role: string (one of the available roles)
- complexity: "simple" | "standard" | "complex"
- dependencies: number[] (indices of sub-tasks this depends on, 0-based)

Rules:
1. Architecture tasks should come first if needed (index 0)
2. Developer tasks should reference architecture output if it exists
3. Tester tasks should depend on developer tasks
4. Documentation tasks should come last
5. Do NOT create reviewer tasks (reviews are auto-assigned to PRs)
6. If the task is simple enough, return a single sub-task
7. Maximum 5 sub-tasks unless absolutely necessary

Example:
{
  "sub_tasks": [
    {
      "title": "Design authentication architecture",
      "description": "Create architecture document for JWT-based auth...",
      "role": "architect",
      "complexity": "complex",
      "dependencies": []
    },
    {
      "title": "Implement user registration endpoint",
      "description": "Create POST /api/auth/register endpoint following the architecture...",
      "role": "developer",
      "complexity": "standard",
      "dependencies": [0]
    }
  ]
}`;
  }
}

export const taskDecomposer = new TaskDecomposer();
