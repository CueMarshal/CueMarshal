import Constants from 'expo-constants';
import { Platform } from 'react-native';

// Configuration for OAuth and API endpoints
// These can be overridden via app.json's extra field (Constants.expoConfig.extra)

const extra = Constants.expoConfig?.extra || {};

/**
 * Get platform-appropriate default base URL
 * - iOS/Web: localhost
 * - Android emulator: 10.0.2.2 (maps to host machine's localhost)
 */
function getDefaultBaseUrl(): string {
  const configuredUrl = extra.baseUrl as string | undefined;
  const baseUrl = configuredUrl || 'http://localhost:8180';

  // Android emulator needs special IP — replace localhost with 10.0.2.2
  if (Platform.OS === 'android') {
    return baseUrl.replace('localhost', '10.0.2.2');
  }

  return baseUrl;
}

export const DEFAULT_BASE_URL = getDefaultBaseUrl();

// Export URLs for backward compatibility
// These derive from the single baseUrl (nginx proxies to underlying services)
export const GITEA_URL = `${DEFAULT_BASE_URL}`;  // nginx / → gitea:3000
export const CONDUCTOR_URL = `${DEFAULT_BASE_URL}/api`;  // nginx /api → conductor

export const config = {
  baseUrl: DEFAULT_BASE_URL,
  giteaUrl: GITEA_URL,
  conductorUrl: CONDUCTOR_URL,
  
  // OAuth2 Client Configuration
  // The clientId from app.json is used as a fallback.
  // At runtime the app fetches the live value from GET /api/config.
  oauth2: {
    clientId: extra.oauth2ClientId || '',
    redirectUri: extra.oauth2RedirectUri || 'cuemarshal://oauth',
    scopes: [
      'read:user',
      'read:repository',
      'write:repository',
      'read:issue',
      'write:issue'
    ],
  },
  
  // App configuration
  appScheme: 'cuemarshal',
};

/**
 * Fetch the OAuth2 client ID from the conductor's /api/config endpoint.
 * Falls back to the value baked into app.json if the request fails.
 */
export async function fetchOAuth2ClientId(conductorUrl?: string): Promise<string> {
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

// Validate configuration (synchronous, checks current in-memory values)
export function validateConfig(): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];
  
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
