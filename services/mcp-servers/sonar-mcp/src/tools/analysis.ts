/**
 * SonarQube MCP Tools - Issue Analysis
 */

import { z } from "zod";
import { sonarRequest, getSonarConfig } from "../auth.js";

export const AnalysisTools = {
  sonar_get_issues: {
    description: "Query SonarQube issues by severity, type, and component",
    parameters: z.object({
      project: z.string().optional().describe("Project key (defaults to configured project)"),
      severities: z
        .array(z.enum(["BLOCKER", "CRITICAL", "MAJOR", "MINOR", "INFO"]))
        .optional()
        .describe("Filter by severities"),
      types: z
        .array(z.enum(["BUG", "VULNERABILITY", "CODE_SMELL", "SECURITY_HOTSPOT"]))
        .optional()
        .describe("Filter by issue types"),
      statuses: z
        .array(z.enum(["OPEN", "CONFIRMED", "REOPENED", "RESOLVED", "CLOSED"]))
        .optional()
        .describe("Filter by statuses (default: OPEN, CONFIRMED, REOPENED)"),
      componentKeys: z.string().optional().describe("Filter by component path"),
      limit: z.number().optional().describe("Max results (default: 50, max: 500)"),
    }),
    handler: async (args: {
      project?: string;
      severities?: string[];
      types?: string[];
      statuses?: string[];
      componentKeys?: string;
      limit?: number;
    }) => {
      try {
        const { sonarProjectKey } = getSonarConfig();
        const projectKey = args.project || sonarProjectKey;

        if (!projectKey) {
          throw new Error("Project key must be provided or configured");
        }

        const params = new URLSearchParams();
        const componentKeys = args.componentKeys || projectKey;
        params.append("componentKeys", componentKeys);
        params.append("resolved", "false");
        params.append("ps", String(Math.min(args.limit || 50, 500)));

        if (args.severities && args.severities.length > 0) {
          params.append("severities", args.severities.join(","));
        }

        if (args.types && args.types.length > 0) {
          params.append("types", args.types.join(","));
        }

        if (args.statuses && args.statuses.length > 0) {
          params.append("statuses", args.statuses.join(","));
        } else {
          params.append("statuses", "OPEN,CONFIRMED,REOPENED");
        }

        const result = await sonarRequest("GET", `/api/issues/search?${params}`);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ error: (error as Error).message }, null, 2),
            },
          ],
        };
      }
    },
  },

  sonar_get_hotspots: {
    description: "List security hotspots for review",
    parameters: z.object({
      project: z.string().optional().describe("Project key (defaults to configured project)"),
      status: z
        .enum(["TO_REVIEW", "REVIEWED"])
        .optional()
        .describe("Filter by review status"),
      limit: z.number().optional().describe("Max results (default: 50)"),
    }),
    handler: async (args: {
      project?: string;
      status?: string;
      limit?: number;
    }) => {
      try {
        const { sonarProjectKey } = getSonarConfig();
        const projectKey = args.project || sonarProjectKey;

        if (!projectKey) {
          throw new Error("Project key must be provided or configured");
        }

        const params = new URLSearchParams();
        params.append("projectKey", projectKey);
        params.append("ps", String(args.limit || 50));

        if (args.status) {
          params.append("status", args.status);
        }

        const result = await sonarRequest("GET", `/api/hotspots/search?${params}`);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ error: (error as Error).message }, null, 2),
            },
          ],
        };
      }
    },
  },
};
