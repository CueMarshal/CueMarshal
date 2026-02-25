import axios from 'axios';
import { config } from '../config';
import { storage } from './storage';

/**
 * Generate a UUID v4 with fallback for non-secure contexts
 */
function generateUUID() {
  try {
    if (typeof crypto !== 'undefined' && 
        crypto.randomUUID && 
        typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    throw new Error('crypto.randomUUID not available');
  } catch (error) {
    // Fallback UUID v4 generation
    console.warn('crypto.randomUUID not available - using fallback:', error.message);
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }
}

/**
 * Generate random string for PKCE code verifier
 */
function generateCodeVerifier() {
  const array = new Uint8Array(32);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(array);
  } else {
    // Fallback to Math.random (less secure but works)
    for (let i = 0; i < array.length; i++) {
      array[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Fallback SHA-256 implementation for non-secure contexts
 * Uses a simple JavaScript implementation when crypto.subtle is unavailable
 */
async function sha256Fallback(message) {
  // Simple SHA-256 implementation for development/non-secure contexts
  // This is a simplified version - not for production use
  function rightRotate(value, amount) {
    return (value >>> amount) | (value << (32 - amount));
  }

  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  const msgLength = data.length * 8;
  
  // Padding
  const paddingLength = (56 - ((data.length + 1) % 64) + 64) % 64;
  const paddedMessage = new Uint8Array(data.length + 1 + paddingLength + 8);
  paddedMessage.set(data);
  paddedMessage[data.length] = 0x80;
  
  // Append length
  for (let i = 0; i < 8; i++) {
    paddedMessage[paddedMessage.length - 1 - i] = msgLength >>> (i * 8);
  }

  // Initialize hash values
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

  // Process message in 512-bit chunks
  for (let offset = 0; offset < paddedMessage.length; offset += 64) {
    const w = new Array(64);
    
    for (let i = 0; i < 16; i++) {
      w[i] = (paddedMessage[offset + i * 4] << 24) | 
             (paddedMessage[offset + i * 4 + 1] << 16) |
             (paddedMessage[offset + i * 4 + 2] << 8) | 
             paddedMessage[offset + i * 4 + 3];
    }

    for (let i = 16; i < 64; i++) {
      const s0 = rightRotate(w[i - 15], 7) ^ rightRotate(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rightRotate(w[i - 2], 17) ^ rightRotate(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }

    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;

    for (let i = 0; i < 64; i++) {
      const S1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[i] + w[i]) | 0;
      const S0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) | 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }

    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
    h5 = (h5 + f) | 0;
    h6 = (h6 + g) | 0;
    h7 = (h7 + h) | 0;
  }

  // Produce final hash value
  const hash = new Uint8Array(32);
  [h0, h1, h2, h3, h4, h5, h6, h7].forEach((h, i) => {
    hash[i * 4] = h >>> 24;
    hash[i * 4 + 1] = h >>> 16;
    hash[i * 4 + 2] = h >>> 8;
    hash[i * 4 + 3] = h;
  });

  return hash;
}

/**
 * Generate PKCE code challenge from verifier
 * Uses crypto.subtle when available (secure contexts), falls back to JS implementation
 */
async function generateCodeChallenge(verifier) {
  let hash;
  
  // Check if crypto.subtle is available (secure context required)
  // Use try-catch to handle any environment-specific issues
  try {
    if (typeof crypto !== 'undefined' && 
        crypto.subtle && 
        typeof crypto.subtle.digest === 'function') {
      const encoder = new TextEncoder();
      const data = encoder.encode(verifier);
      hash = await crypto.subtle.digest('SHA-256', data);
      hash = new Uint8Array(hash);
    } else {
      throw new Error('crypto.subtle.digest not available');
    }
  } catch (error) {
    // Fallback for non-secure contexts (development only)
    console.warn('crypto.subtle not available - using fallback SHA-256 implementation:', error.message);
    hash = await sha256Fallback(verifier);
  }
  
  const base64 = btoa(String.fromCharCode(...hash));
  // Convert to URL-safe base64
  return base64
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

export const authService = {
  /**
   * Start OAuth2 authorization flow
   * Uses the BFF /api/auth/authorize endpoint so the client
   * never needs to know the OAuth2 client ID.
   */
  async startOAuthFlow() {
    try {
      const { oauth2, conductorUrl } = config;

      // Generate PKCE challenge for enhanced security
      const codeVerifier = generateCodeVerifier();
      const codeChallenge = await generateCodeChallenge(codeVerifier);
      const state = generateUUID();

      // Store code verifier and state for later use in callback
      sessionStorage.setItem('oauth_code_verifier', codeVerifier);
      sessionStorage.setItem('oauth_state', state);

      // Ask the BFF to build the authorization URL (client ID is injected server-side)
      const params = new URLSearchParams({
        redirect_uri: oauth2.redirectUri,
        code_challenge: codeChallenge,
        state,
        scopes: oauth2.scopes.join(' '),
      });

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`${conductorUrl}/auth/authorize?${params.toString()}`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return {
          success: false,
          error: body.error || `BFF authorize failed: ${res.status}`,
        };
      }

      const { authorizeUrl } = await res.json();

      // Redirect to Gitea authorization URL
      window.location.href = authorizeUrl;

      return { success: true };
    } catch (error) {
      console.error('OAuth flow error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },

  /**
   * Handle OAuth callback
   * Extracts authorization code and exchanges it for access token via BFF
   */
  async handleOAuthCallback() {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const code = urlParams.get('code');
      const state = urlParams.get('state');
      const error = urlParams.get('error');

      if (error) {
        return {
          success: false,
          error: `OAuth error: ${error}`,
        };
      }

      if (!code) {
        return {
          success: false,
          error: 'No authorization code received',
        };
      }

      // Verify state to prevent CSRF
      const storedState = sessionStorage.getItem('oauth_state');
      if (state !== storedState) {
        return {
          success: false,
          error: 'Invalid state parameter',
        };
      }

      // Get code verifier
      const codeVerifier = sessionStorage.getItem('oauth_code_verifier');
      if (!codeVerifier) {
        return {
          success: false,
          error: 'No code verifier found',
        };
      }

      // Exchange code for token via the BFF (client ID is injected server-side)
      const tokenResult = await this.exchangeCodeForToken(code, codeVerifier);

      // Clean up session storage
      sessionStorage.removeItem('oauth_code_verifier');
      sessionStorage.removeItem('oauth_state');

      if (tokenResult.success && tokenResult.token) {
        // Fetch user information
        const userInfo = await this.fetchUserInfo(tokenResult.token);

        // Store token and user data
        await storage.saveToken(tokenResult.token);
        await storage.saveUser(userInfo);

        return {
          success: true,
          token: tokenResult.token,
          user: userInfo,
        };
      }

      return tokenResult;
    } catch (error) {
      console.error('OAuth callback error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },

  /**
   * Exchange authorization code for access token via BFF
   * The client ID is injected server-side; the frontend only sends
   * the code, code_verifier, and redirect_uri.
   */
  async exchangeCodeForToken(code, codeVerifier) {
    try {
      const { oauth2, conductorUrl } = config;

      const response = await fetch(`${conductorUrl}/auth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          code_verifier: codeVerifier,
          redirect_uri: oauth2.redirectUri,
        }),
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        console.error(`Token exchange error: ${response.status}`, errorBody);
        return {
          success: false,
          error: errorBody.error || `Token exchange failed: ${response.status} ${response.statusText}`,
        };
      }

      const data = await response.json();
      
      if (data.access_token) {
        return {
          success: true,
          token: data.access_token,
        };
      }

      return {
        success: false,
        error: 'No access token in response',
      };
    } catch (error) {
      console.error('Token exchange error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Token exchange failed',
      };
    }
  },

  /**
   * Fetch user information via BFF /api/auth/user endpoint
   */
  async fetchUserInfo(token) {
    try {
      const { conductorUrl } = config;

      const response = await axios.get(`${conductorUrl}/auth/user`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      });

      return {
        id: response.data.id,
        username: response.data.username,
        email: response.data.email,
        full_name: response.data.full_name,
        avatar_url: response.data.avatar_url,
      };
    } catch (error) {
      console.error('Fetch user info error:', error);
      throw error;
    }
  },

  /**
   * Restore authentication from stored credentials
   */
  async restoreAuth() {
    try {
      const token = await storage.getToken();
      const user = await storage.getUser();

      if (!token || !user) {
        return { success: false, error: 'No stored credentials' };
      }

      // Verify token is still valid by fetching user info
      try {
        const userInfo = await this.fetchUserInfo(token);
        return {
          success: true,
          token,
          user: userInfo,
        };
      } catch (error) {
        // Token is invalid, clear stored data
        await storage.clear();
        return {
          success: false,
          error: 'Token expired or invalid',
        };
      }
    } catch (error) {
      console.error('Restore auth error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },

  /**
   * Logout user
   */
  async logout() {
    await storage.clear();
  },
};
