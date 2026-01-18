/**
 * Conductor API authentication
 */

export interface ConductorConfig {
  url: string;
  secret: string;
}

export function getConductorConfig(): ConductorConfig {
  const url = process.env.CONDUCTOR_URL;
  const secret = process.env.CONDUCTOR_SECRET;

  if (!url || !secret) {
    throw new Error("CONDUCTOR_URL and CONDUCTOR_SECRET must be set");
  }

  return { url, secret };
}

/**
 * Make an authenticated request to Conductor internal API
 */
export async function conductorRequest(
  method: string,
  path: string,
  body?: unknown
): Promise<unknown> {
  const { url, secret } = getConductorConfig();
  const apiUrl = `${url}/api/internal${path}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${secret}`,
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

  if (response.status === 204) {
    return null;
  }

  return await response.json();
}
