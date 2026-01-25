/**
 * System MCP server authentication and config
 */

export interface SystemConfig {
  gatewayUrl: string;
  gatewayApiKey: string;
  redisUrl: string;
  conductorUrl: string;
  conductorSecret?: string;
  databaseUrl?: string;
  lokiUrl?: string;
  prometheusUrl?: string;
  grafanaUrl?: string;
  grafanaToken?: string;
}

export function getSystemConfig(): SystemConfig {
  const gatewayUrl = process.env.GATEWAY_URL;
  const gatewayApiKey = process.env.GATEWAY_API_KEY;
  const redisUrl = process.env.REDIS_URL;
  const conductorUrl = process.env.CONDUCTOR_URL;
  const conductorSecret = process.env.CONDUCTOR_SECRET;

  if (!gatewayUrl || !gatewayApiKey || !redisUrl || !conductorUrl) {
    throw new Error(
      "GATEWAY_URL, GATEWAY_API_KEY, REDIS_URL, and CONDUCTOR_URL must be set"
    );
  }

  return {
    gatewayUrl,
    gatewayApiKey,
    redisUrl,
    conductorUrl,
    conductorSecret,
    databaseUrl: process.env.DATABASE_URL,
    lokiUrl: process.env.LOKI_URL || "http://loki:3100",
    prometheusUrl: process.env.PROMETHEUS_URL || "http://prometheus:9090",
    grafanaUrl: process.env.GRAFANA_URL || "http://grafana:3000",
    grafanaToken: process.env.GRAFANA_TOKEN,
  };
}

/**
 * Make authenticated request to LiteLLM Gateway
 */
export async function gatewayRequest(
  method: string,
  path: string,
  body?: unknown
): Promise<unknown> {
  const { gatewayUrl, gatewayApiKey } = getSystemConfig();
  const apiUrl = `${gatewayUrl}${path}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${gatewayApiKey}`,
    "Content-Type": "application/json",
  };

  const options: RequestInit = {
    method,
    headers,
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(apiUrl, options);

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Gateway API error (${response.status}): ${error}`);
  }

  return await response.json();
}

/**
 * Make request to Conductor internal API
 */
export async function conductorRequest(
  method: string,
  path: string,
  body?: unknown
): Promise<unknown> {
  const { conductorUrl, conductorSecret } = getSystemConfig();
  const apiUrl = `${conductorUrl}${path}`;

  if (!conductorSecret) {
    throw new Error("CONDUCTOR_SECRET must be set to call Conductor internal API");
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${conductorSecret}`,
    "Content-Type": "application/json",
  };

  const options: RequestInit = {
    method,
    headers,
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(apiUrl, options);

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Conductor API error (${response.status}): ${error}`);
  }

  return await response.json();
}

/**
 * Make request to Loki API
 */
export async function lokiRequest(path: string): Promise<unknown> {
  const { lokiUrl } = getSystemConfig();
  const apiUrl = `${lokiUrl}${path}`;

  const response = await fetch(apiUrl);

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Loki API error (${response.status}): ${error}`);
  }

  return await response.json();
}

/**
 * Make request to Prometheus API
 */
export async function prometheusRequest(path: string): Promise<unknown> {
  const { prometheusUrl } = getSystemConfig();
  const apiUrl = `${prometheusUrl}${path}`;

  const response = await fetch(apiUrl);

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Prometheus API error (${response.status}): ${error}`);
  }

  return await response.json();
}

/**
 * Make request to Grafana API
 */
export async function grafanaRequest(
  method: string,
  path: string,
  body?: unknown
): Promise<unknown> {
  const { grafanaUrl, grafanaToken } = getSystemConfig();
  const apiUrl = `${grafanaUrl}${path}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (grafanaToken) {
    headers.Authorization = `Bearer ${grafanaToken}`;
  }

  const options: RequestInit = {
    method,
    headers,
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(apiUrl, options);

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Grafana API error (${response.status}): ${error}`);
  }

  return await response.json();
}
