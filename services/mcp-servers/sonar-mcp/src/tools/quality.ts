/**
 * SonarQube MCP Tools - Quality Metrics
 */

import { z } from "zod";
import { sonarRequest, getSonarConfig } from "../auth.js";

export const QualityTools = {
  sonar_get_quality_gate: {
    description: "Get quality gate status for a project",
    parameters: z.object({
      project: z.string().optional().describe("Project key (defaults to configured project)"),
    }),
    handler: async (args: { project?: string }) => {
      try {
        const { sonarProjectKey } = getSonarConfig();
        const projectKey = args.project || sonarProjectKey;

        if (!projectKey) {
          throw new Error("Project key must be provided or configured");
        }

        const params = new URLSearchParams();
        params.append("projectKey", projectKey);

        const result = await sonarRequest(
          "GET",
          `/api/qualitygates/project_status?${params}`
        );

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

  sonar_get_metrics: {
    description:
      "Get project metrics (coverage, duplications, complexity, technical debt, etc.)",
    parameters: z.object({
      project: z.string().optional().describe("Project key (defaults to configured project)"),
      metrics: z
        .array(z.string())
        .optional()
        .describe(
          "Metric keys (default: coverage, duplicated_lines_density, complexity, sqale_index, bugs, vulnerabilities, code_smells)"
        ),
    }),
    handler: async (args: { project?: string; metrics?: string[] }) => {
      try {
        const { sonarProjectKey } = getSonarConfig();
        const projectKey = args.project || sonarProjectKey;

        if (!projectKey) {
          throw new Error("Project key must be provided or configured");
        }

        const defaultMetrics = [
          "coverage",
          "duplicated_lines_density",
          "complexity",
          "sqale_index",
          "bugs",
          "vulnerabilities",
          "code_smells",
          "security_hotspots",
          "ncloc",
          "reliability_rating",
          "security_rating",
          "sqale_rating",
        ];

        const metricKeys = args.metrics || defaultMetrics;

        const params = new URLSearchParams();
        params.append("component", projectKey);
        params.append("metricKeys", metricKeys.join(","));

        const result = await sonarRequest("GET", `/api/measures/component?${params}`);

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

  sonar_get_rules: {
    description: "Look up a SonarQube rule's description and details",
    parameters: z.object({
      ruleKey: z.string().describe("Rule key (e.g., 'javascript:S1234')"),
    }),
    handler: async (args: { ruleKey: string }) => {
      try {
        const params = new URLSearchParams();
        params.append("key", args.ruleKey);

        const result = await sonarRequest("GET", `/api/rules/show?${params}`);

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
