/**
 * Configuration for OAuth and API endpoints
 * Environment variables are replaced at build time by Vite
 *
 * The OAuth2 client ID is managed server-side (BFF pattern).
 * The frontend calls /api/auth/* endpoints and never needs
 * to know or fetch the client ID.
 */

const BASE_URL = import.meta.env.VITE_BASE_URL || window.location.origin;
const GITEA_URL = BASE_URL;
const CONDUCTOR_URL = `${BASE_URL}/api`;

export const config = {
  baseUrl: BASE_URL,
  giteaUrl: GITEA_URL,
  conductorUrl: CONDUCTOR_URL,
  
  // OAuth2 Configuration (client ID is handled server-side via BFF)
  oauth2: {
    redirectUri: `${window.location.origin}/oauth/callback`,
    scopes: [
      'read:user',
      'read:organization',
      'read:repository',
      'write:repository',
      'read:issue',
      'write:issue'
    ],
  },
  
  appScheme: 'cuemarshal',
};

/**
 * Validate configuration (synchronous, checks current in-memory values)
 */
export function validateConfig() {
  const errors = [];
  
  if (!config.baseUrl) {
    errors.push('Base URL is not configured');
  }
  
  return {
    isValid: errors.length === 0,
    errors,
  };
}
