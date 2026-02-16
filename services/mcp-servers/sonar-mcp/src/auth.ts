/**
 * SonarQube MCP server authentication and config
 */

export interface SonarConfig {
  sonarUrl: string;
  sonarToken: string;
  sonarProjectKey?: string;
}

export function getSonarConfig(): SonarConfig {
  const sonarUrl = process.env.SONAR_URL;
  const sonarToken = process.env.SONAR_TOKEN;
  const sonarProjectKey = process.env.SONAR_PROJECT_KEY;

  if (!sonarUrl || !sonarToken) {
    throw new Error("SONAR_URL and SONAR_TOKEN must be set");
  }

  return {
    sonarUrl,
    sonarToken,
    sonarProjectKey,
  };
}

/**
 * Make authenticated request to SonarQube API
 * SonarQube uses token-based basic auth (token as username, empty password)
 */
export async function sonarRequest(
  method: string,
  path: string,
  body?: unknown
): Promise<unknown> {
  const { sonarUrl, sonarToken } = getSonarConfig();
  const apiUrl = `${sonarUrl}${path}`;

  // SonarQube uses token as username with empty password
  const authHeader = `Basic ${Buffer.from(`${sonarToken}:`).toString("base64")}`;

  const headers: Record<string, string> = {
    Authorization: authHeader,
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
    throw new Error(`SonarQube API error (${response.status}): ${error}`);
  }

  return await response.json();
}
