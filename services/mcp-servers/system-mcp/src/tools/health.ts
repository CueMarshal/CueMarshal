/**
 * System MCP Tools - Health Checks and Metrics
 */

import { z } from "zod";
import { getSystemConfig, conductorRequest } from "../auth.js";

export const HealthTools = {
  health_check: {
    description: "Check health of all platform services",
    parameters: z.object({}),
    handler: async () => {
      const { gatewayUrl, conductorUrl, redisUrl } = getSystemConfig();
      
      const services: Record<string, { status: string; latency_ms?: number; error?: string }> = {};

      // Check Gitea
      try {
        const start = Date.now();
        const giteaUrl = process.env.GITEA_URL || "http://gitea:3000";
        const response = await fetch(`${giteaUrl}/api/v1/version`, {
          signal: AbortSignal.timeout(5000),
        });
        services.gitea = {
          status: response.ok ? "healthy" : "unhealthy",
          latency_ms: Date.now() - start,
        };
      } catch (error) {
        services.gitea = {
          status: "unhealthy",
          error: (error as Error).message,
        };
      }

      // Check Conductor
      try {
        const start = Date.now();
        const response = await fetch(`${conductorUrl}/health`, {
          signal: AbortSignal.timeout(5000),
        });
        services.conductor = {
          status: response.ok ? "healthy" : "unhealthy",
          latency_ms: Date.now() - start,
        };
      } catch (error) {
        services.conductor = {
          status: "unhealthy",
          error: (error as Error).message,
        };
      }

      // Check Gateway
      try {
        const start = Date.now();
        const response = await fetch(`${gatewayUrl}/health/liveliness`, {
          signal: AbortSignal.timeout(5000),
        });
        services.gateway = {
          status: response.ok ? "healthy" : "unhealthy",
          latency_ms: Date.now() - start,
        };
      } catch (error) {
        services.gateway = {
          status: "unhealthy",
          error: (error as Error).message,
        };
      }

      // Check Redis
      try {
        const { createClient } = await import("redis");
        const client = createClient({ url: redisUrl });
        await client.connect();
        const start = Date.now();
        await client.ping();
        services.redis = {
          status: "healthy",
          latency_ms: Date.now() - start,
        };
        await client.disconnect();
      } catch (error) {
        services.redis = {
          status: "unhealthy",
          error: (error as Error).message,
        };
      }

      const overall = Object.values(services).every(s => s.status === "healthy") 
        ? "healthy" 
        : "degraded";

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ overall, services }, null, 2),
          },
        ],
      };
    },
  },

  metrics_get: {
    description: "Get platform performance metrics (task completion, success rate, etc.)",
    parameters: z.object({
      period: z.enum(["day", "week", "month"]).optional().describe("Time period (default: week)"),
    }),
    handler: async (args: { period?: string }) => {
      const params = new URLSearchParams();
      if (args.period) params.append("period", args.period);
      const query = params.toString();
      const path = query ? `/api/internal/metrics?${query}` : "/api/internal/metrics";
      const result = await conductorRequest("GET", path);

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
