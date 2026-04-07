import Constants from 'expo-constants';
import { Platform } from 'react-native';

// Configuration for OAuth and API endpoints
// These can be overridden via app.json's extra field (Constants.expoConfig.extra)
//
// The OAuth2 client ID is managed server-side (BFF pattern).
// The mobile app calls /api/auth/* endpoints and never needs
// to know or fetch the client ID.

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
  
  // OAuth2 Configuration (client ID is handled server-side via BFF)
  oauth2: {
    redirectUri: extra.oauth2RedirectUri || 'cuemarshal://oauth',
    scopes: [
      'read:user',
      'read:organization',
      'read:repository',
      'write:repository',
      'read:issue',
      'write:issue'
    ],
  },
  
  // App configuration
  appScheme: 'cuemarshal',
};

// Validate configuration (synchronous, checks current in-memory values)
export function validateConfig(): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (!config.baseUrl) {
    errors.push('Base URL is not configured');
  }
  
  return {
    isValid: errors.length === 0,
    errors,
  };
}
