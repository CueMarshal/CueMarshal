/**
 * Shared types for CueMarshal MCP servers
 */

export interface MCPServerOptions {
  name: string;
  version: string;
  port?: number;
}

export interface AuthContext {
  token?: string;
  userId?: string;
  role?: string;
}

export interface HealthStatus {
  status: "healthy" | "degraded" | "unhealthy";
  name: string;
  version: string;
  uptime: number;
  dependencies?: Record<string, boolean>;
}
