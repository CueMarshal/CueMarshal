/**
 * Configuration for OAuth and API endpoints
 * Environment variables are replaced at build time by Vite
 */

const BASE_URL = import.meta.env.VITE_BASE_URL || window.location.origin;
const GITEA_URL = BASE_URL;
const CONDUCTOR_URL = `${BASE_URL}/api`;

export const config = {
  baseUrl: BASE_URL,
  giteaUrl: GITEA_URL,
  conductorUrl: CONDUCTOR_URL,
  
  // OAuth2 Client Configuration
  // The clientId is fetched at runtime from GET /api/config
  // Fallback to hardcoded value if API is unavailable
  oauth2: {
    clientId: import.meta.env.VITE_OAUTH2_CLIENT_ID || 'cuemarshal-oauth-client',
    redirectUri: `${window.location.origin}/oauth/callback`,
    scopes: [
      'read:user',
      'read:repository',
      'write:repository',
      'read:issue',
      'write:issue'
    ],
  },
  
  appScheme: 'cuemarshal',
};

/**
 * Fetch the OAuth2 client ID from the conductor's /api/config endpoint.
 * Falls back to the value from environment variables if the request fails.
 */
export async function fetchOAuth2ClientId(conductorUrl) {
  const baseApi = conductorUrl || CONDUCTOR_URL;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${baseApi}/config`, { signal: controller.signal });
    clearTimeout(timeout);
    if (res.ok) {
      const data = await res.json();
      if (data.oauth2ClientId) {
        // Update the in-memory config so subsequent reads see the live value
        config.oauth2.clientId = data.oauth2ClientId;
        return data.oauth2ClientId;
      }
    }
  } catch {
    // Network error or timeout — fall through to fallback
  }
  return config.oauth2.clientId;
}

/**
 * Validate configuration (synchronous, checks current in-memory values)
 */
export function validateConfig() {
  const errors = [];
  
  if (!config.oauth2.clientId) {
    errors.push('OAuth2 Client ID is not configured');
  }
  
  if (!config.baseUrl) {
    errors.push('Base URL is not configured');
  }
  
  return {
    isValid: errors.length === 0,
    errors,
  };
}
