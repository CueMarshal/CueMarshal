/**
 * Shared authentication utilities for MCP servers
 */

import type { AuthContext } from "./types.js";

/**
 * Validate a bearer token
 */
export function validateBearerToken(authHeader: string | undefined, expectedToken: string): boolean {
  if (!authHeader) return false;
  
  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") return false;
  
  return parts[1] === expectedToken;
}

/**
 * Extract auth context from environment and headers
 */
export function getAuthContext(env: NodeJS.ProcessEnv, headers?: Record<string, string>): AuthContext {
  return {
    token: env.GITEA_TOKEN || env.CONDUCTOR_SECRET || headers?.["authorization"],
    userId: headers?.["x-user-id"],
    role: headers?.["x-agent-role"],
  };
}
