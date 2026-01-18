/**
 * Gitea API authentication
 */

export interface GiteaConfig {
  url: string;
  token: string;
}

export function getGiteaConfig(): GiteaConfig {
  const url = process.env.GITEA_URL;
  const token = process.env.GITEA_TOKEN;

  if (!url || !token) {
    throw new Error("GITEA_URL and GITEA_TOKEN must be set");
  }

  return { url, token };
}

/**
 * Make an authenticated request to Gitea API
 */
export async function giteaRequest(
  method: string,
  path: string,
  body?: unknown,
  authToken?: string
): Promise<unknown> {
  const { url, token } = getGiteaConfig();
  const apiUrl = `${url}/api/v1${path}`;
  const resolvedToken = authToken || token;

  const headers: Record<string, string> = {
    Authorization: `token ${resolvedToken}`,
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
    throw new Error(`Gitea API error (${response.status}): ${error}`);
  }

  // Handle 204 No Content
  if (response.status === 204) {
    return null;
  }

  return await response.json();
}
