/**
 * Gitea MCP Tools - Label Management
 */

import { z } from "zod";
import { giteaRequest } from "../auth.js";

export const LabelTools = {
  gitea_list_labels: {
    description: "List labels available in a Gitea organization or repository. Returns label names and IDs for use in issue creation.",
    parameters: z.object({
      owner: z.string().describe("Organization or repository owner"),
      repo: z.string().optional().describe("Repository name (optional - if omitted, returns org-level labels only)"),
      authToken: z.string().optional().describe("Optional Gitea auth token override"),
    }),
    handler: async (args: {
      owner: string;
      repo?: string;
      authToken?: string;
    }) => {
      const labels: Array<{ id: number; name: string; color: string; description?: string }> = [];

      try {
        const orgLabels = await giteaRequest(
          "GET",
          `/orgs/${args.owner}/labels`,
          undefined,
          args.authToken
        ) as Array<{
          id: number;
          name: string;
          color: string;
          description?: string;
        }>;
        labels.push(...orgLabels.map(l => ({ ...l, scope: 'org' })));
      } catch { /* continue */ }

      if (args.repo) {
        try {
          const repoLabels = await giteaRequest(
            "GET",
            `/repos/${args.owner}/${args.repo}/labels`,
            undefined,
            args.authToken
          ) as Array<{
            id: number;
            name: string;
            color: string;
            description?: string;
          }>;
          labels.push(...repoLabels.map(l => ({ ...l, scope: 'repo' })));
        } catch { /* continue */ }
      }

      const labelMap: Record<string, { id: number; color: string; description?: string; scope?: string }> = {};
      for (const label of labels) {
        if (!labelMap[label.name] || (label as { scope?: string }).scope === 'repo') {
          labelMap[label.name] = {
            id: label.id,
            color: label.color,
            description: label.description,
            scope: (label as { scope?: string }).scope,
          };
        }
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            labels: labels.map(l => ({ id: l.id, name: l.name, color: l.color, description: l.description, scope: (l as { scope?: string }).scope })),
            labelMap,
            summary: `Found ${labels.length} labels`,
          }, null, 2),
        }],
      };
    },
  },

  gitea_resolve_label_names: {
    description: "Resolve label names to IDs for use in issue creation.",
    parameters: z.object({
      owner: z.string().describe("Organization or repository owner"),
      repo: z.string().describe("Repository name"),
      labelNames: z.array(z.string()).describe("Array of label names to resolve to IDs"),
      authToken: z.string().optional().describe("Optional Gitea auth token override"),
    }),
    handler: async (args: { owner: string; repo: string; labelNames: string[]; authToken?: string }) => {
      const labels: Array<{ id: number; name: string }> = [];
      try {
        const orgLabels = await giteaRequest(
          "GET",
          `/orgs/${args.owner}/labels`,
          undefined,
          args.authToken
        ) as Array<{ id: number; name: string }>;
        labels.push(...orgLabels);
      } catch { /* continue */ }
      try {
        const repoLabels = await giteaRequest(
          "GET",
          `/repos/${args.owner}/${args.repo}/labels`,
          undefined,
          args.authToken
        ) as Array<{ id: number; name: string }>;
        labels.push(...repoLabels);
      } catch { /* continue */ }

      const labelMap = new Map<string, number>();
      for (const label of labels) labelMap.set(label.name, label.id);

      const resolvedIds: number[] = [];
      const unresolvedLabels: string[] = [];
      for (const labelName of args.labelNames) {
        const id = labelMap.get(labelName);
        if (id !== undefined) resolvedIds.push(id);
        else unresolvedLabels.push(labelName);
      }

      if (unresolvedLabels.length > 0) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              error: "Label resolution failed",
              unresolvedLabels,
              availableLabels: Array.from(labelMap.keys()),
              message: `The following labels could not be found: ${unresolvedLabels.join(', ')}.`,
            }, null, 2),
          }],
        };
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            labelIds: resolvedIds,
            resolved: args.labelNames.map((name, idx) => ({ name, id: resolvedIds[idx] })),
          }, null, 2),
        }],
      };
    },
  },
};
