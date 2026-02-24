import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import * as Crypto from 'expo-crypto';
import axios from 'axios';
import { config } from '../config';
import { storage } from './storage';
import { AuthResult, User } from '../types/auth';
import { getGlobalRuntimeConfig } from '../hooks/useRuntimeConfig';

// Enable web browser to dismiss on successful auth
WebBrowser.maybeCompleteAuthSession();

export const authService = {
  /**
   * Start OAuth2 authorization flow using the BFF pattern.
   * The server builds the authorization URL (client ID is injected server-side).
   *
   * Note: The custom URL scheme redirect (cuemarshal://oauth) requires a
   * development build or standalone build. It will not work in Expo Go.
   */
  async startOAuthFlow(): Promise<AuthResult> {
    try {
      const runtimeConfig = await getGlobalRuntimeConfig();
      const { oauth2 } = config;
      const conductorUrl = runtimeConfig.conductorUrl;

      // Generate PKCE challenge for enhanced security
      const codeVerifier = await this.generateCodeVerifier();
      const codeChallenge = await this.generateCodeChallenge(codeVerifier);

      // Build query params for the BFF authorize endpoint
      const state = Crypto.randomUUID
        ? Crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

      const params = new URLSearchParams({
        redirect_uri: oauth2.redirectUri,
        code_challenge: codeChallenge,
        state,
        scopes: oauth2.scopes.join(' '),
      });

      // Ask the BFF to build the authorization URL
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
          error: body.error || 'Failed to get authorization URL from server',
        };
      }

      const { authorizeUrl } = await res.json();

      // Parse the authorization URL to extract the discovery endpoint base
      const authUrl = new URL(authorizeUrl);
      const giteaOrigin = authUrl.origin;

      // Create an AuthSession request that uses the pre-built URL
      const authRequest = new AuthSession.AuthRequest({
        clientId: 'bff', // placeholder — the real client ID is in the authorizeUrl
        redirectUri: oauth2.redirectUri,
        scopes: oauth2.scopes,
        responseType: AuthSession.ResponseType.Code,
        usePKCE: true,
        codeChallengeMethod: AuthSession.CodeChallengeMethod.S256,
        codeChallenge,
      });

      const discovery = {
        authorizationEndpoint: `${giteaOrigin}/login/oauth/authorize`,
        tokenEndpoint: `${giteaOrigin}/login/oauth/access_token`,
        revocationEndpoint: `${giteaOrigin}/login/oauth/revoke`,
      };

      // Open the browser with the BFF-built authorize URL directly
      const result = await WebBrowser.openAuthSessionAsync(
        authorizeUrl,
        oauth2.redirectUri
      );

      if (result.type === 'success') {
        const resultUrl = new URL(result.url);
        const code = resultUrl.searchParams.get('code');

        if (!code) {
          return { success: false, error: 'No authorization code received' };
        }

        // Exchange code for token via BFF
        const tokenResult = await this.exchangeCodeForToken(code, codeVerifier);

        if (tokenResult.success && tokenResult.token) {
          const userInfo = await this.fetchUserInfo(tokenResult.token);
          await storage.saveToken(tokenResult.token);
          await storage.saveUser(userInfo);

          return {
            success: true,
            token: tokenResult.token,
            user: userInfo,
          };
        }

        return tokenResult;
      } else if (result.type === 'cancel' || result.type === 'dismiss') {
        return { success: false, error: 'OAuth authorization was cancelled' };
      } else {
        return { success: false, error: 'OAuth authorization failed' };
      }
    } catch (error) {
      console.error('OAuth flow error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },

  /**
   * Exchange authorization code for access token via BFF.
   * The client ID is injected server-side.
   */
  async exchangeCodeForToken(
    code: string,
    codeVerifier: string
  ): Promise<AuthResult> {
    try {
      const runtimeConfig = await getGlobalRuntimeConfig();
      const { oauth2 } = config;
      const conductorUrl = runtimeConfig.conductorUrl;

      const response = await fetch(`${conductorUrl}/auth/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
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
          error: errorBody.error || 'Token exchange failed',
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
  async fetchUserInfo(token: string): Promise<User> {
    try {
      const runtimeConfig = await getGlobalRuntimeConfig();
      const conductorUrl = runtimeConfig.conductorUrl;

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
  async restoreAuth(): Promise<AuthResult> {
    try {
      const token = await storage.getToken();
      const user = await storage.getUser();

      if (token && user) {
        // Optionally verify token is still valid
        try {
          await this.fetchUserInfo(token);
          return {
            success: true,
            token,
            user,
          };
        } catch (error) {
          // Token is invalid, clear storage
          await storage.clearAuth();
          return {
            success: false,
            error: 'Stored token is invalid',
          };
        }
      }

      return {
        success: false,
        error: 'No stored credentials',
      };
    } catch (error) {
      console.error('Restore auth error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },

  /**
   * Logout and clear stored credentials
   */
  async logout(): Promise<void> {
    await storage.clearAuth();
  },

  /**
   * Generate PKCE code verifier
   * Code verifier is a base64url-encoded random string (43-128 characters)
   */
  async generateCodeVerifier(): Promise<string> {
    const randomBytes = await Crypto.getRandomBytesAsync(32);
    // Convert Uint8Array to base64url string
    // Use a simple character-based approach compatible with React Native
    let binary = '';
    for (let i = 0; i < randomBytes.length; i++) {
      binary += String.fromCharCode(randomBytes[i]);
    }
    // Create base64 from binary string (React Native compatible approach)
    const base64Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let base64 = '';
    for (let i = 0; i < binary.length; i += 3) {
      const byte1 = binary.charCodeAt(i);
      const byte2 = i + 1 < binary.length ? binary.charCodeAt(i + 1) : 0;
      const byte3 = i + 2 < binary.length ? binary.charCodeAt(i + 2) : 0;
      
      const enc1 = byte1 >> 2;
      const enc2 = ((byte1 & 3) << 4) | (byte2 >> 4);
      const enc3 = ((byte2 & 15) << 2) | (byte3 >> 6);
      const enc4 = byte3 & 63;
      
      base64 += base64Chars[enc1] + base64Chars[enc2];
      base64 += i + 1 < binary.length ? base64Chars[enc3] : '';
      base64 += i + 2 < binary.length ? base64Chars[enc4] : '';
    }
    // Convert to base64url format (replace + with -, / with _, remove =)
    return base64
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  },

  /**
   * Generate PKCE code challenge from verifier
   */
  async generateCodeChallenge(codeVerifier: string): Promise<string> {
    const digest = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      codeVerifier,
      { encoding: Crypto.CryptoEncoding.BASE64 }
    );
    // Convert base64 to base64url format
    return digest
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  },
};
