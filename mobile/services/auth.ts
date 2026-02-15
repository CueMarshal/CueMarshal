import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import * as Crypto from 'expo-crypto';
import axios from 'axios';
import { config, fetchOAuth2ClientId } from '../config';
import { storage } from './storage';
import { AuthResult, User } from '../types/auth';
import { getGlobalRuntimeConfig } from '../hooks/useRuntimeConfig';

// Enable web browser to dismiss on successful auth
WebBrowser.maybeCompleteAuthSession();

export const authService = {
  /**
   * Start OAuth2 authorization flow
   * This opens a browser window for the user to authenticate with Gitea
   * 
   * Note: The custom URL scheme redirect (cuemarshal://oauth) requires a development build
   * or standalone build. It will not work in Expo Go. For Expo Go compatibility,
   * you would need to use AuthSession.makeRedirectUri() with proxy support.
   */
  async startOAuthFlow(): Promise<AuthResult> {
    try {
      const runtimeConfig = await getGlobalRuntimeConfig();
      const { oauth2 } = config;
      const giteaUrl = runtimeConfig.giteaUrl;

      // Discover the live OAuth2 client ID from the conductor.
      // Falls back to the value in app.json / in-memory config.
      const clientId = await fetchOAuth2ClientId(runtimeConfig.conductorUrl);
      if (!clientId) {
        return {
          success: false,
          error: 'OAuth2 Client ID is not configured. Is the platform running?',
        };
      }
      
      // Generate PKCE challenge for enhanced security
      const codeVerifier = await this.generateCodeVerifier();
      const codeChallenge = await this.generateCodeChallenge(codeVerifier);
      
      // Create authorization request
      // Note: Using custom redirect URI - requires dev client or standalone build
      const authRequest = new AuthSession.AuthRequest({
        clientId,
        redirectUri: oauth2.redirectUri,
        scopes: oauth2.scopes,
        responseType: AuthSession.ResponseType.Code,
        usePKCE: true,
        codeChallengeMethod: AuthSession.CodeChallengeMethod.S256,
        codeChallenge,
        extraParams: {
          // Gitea-specific parameters
        },
      });

      // Load the authorization request
      const discovery = {
        authorizationEndpoint: `${giteaUrl}/login/oauth/authorize`,
        tokenEndpoint: `${giteaUrl}/login/oauth/access_token`,
        revocationEndpoint: `${giteaUrl}/login/oauth/revoke`,
      };

      await authRequest.makeAuthUrlAsync(discovery);

      // Prompt for authorization
      const result = await authRequest.promptAsync(discovery);

      if (result.type === 'success') {
        const { code } = result.params;
        
        // Exchange authorization code for access token
        const tokenResult = await this.exchangeCodeForToken(
          code,
          codeVerifier
        );

        if (tokenResult.success && tokenResult.token) {
          // Fetch user information
          const userInfo = await this.fetchUserInfo(tokenResult.token);
          
          // Store token and user data securely
          await storage.saveToken(tokenResult.token);
          await storage.saveUser(userInfo);

          return {
            success: true,
            token: tokenResult.token,
            user: userInfo,
          };
        }

        return tokenResult;
      } else if (result.type === 'error') {
        return {
          success: false,
          error: result.error?.message || 'OAuth authorization failed',
        };
      } else {
        return {
          success: false,
          error: 'OAuth authorization was cancelled',
        };
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
   * Exchange authorization code for access token
   */
  async exchangeCodeForToken(
    code: string,
    codeVerifier: string
  ): Promise<AuthResult> {
    try {
      const runtimeConfig = await getGlobalRuntimeConfig();
      const { oauth2 } = config;
      const giteaUrl = runtimeConfig.giteaUrl;

      // Use the live client ID (already resolved and cached in config by startOAuthFlow)
      const { oauth2: currentOAuth2 } = config;
      const response = await axios.post(
        `${giteaUrl}/login/oauth/access_token`,
        {
          client_id: currentOAuth2.clientId,
          code,
          code_verifier: codeVerifier,
          grant_type: 'authorization_code',
          redirect_uri: currentOAuth2.redirectUri,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
        }
      );

      if (response.data.access_token) {
        return {
          success: true,
          token: response.data.access_token,
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
   * Fetch user information from Gitea using access token
   */
  async fetchUserInfo(token: string): Promise<User> {
    try {
      const runtimeConfig = await getGlobalRuntimeConfig();
      const giteaUrl = runtimeConfig.giteaUrl;

      const response = await axios.get(`${giteaUrl}/api/v1/user`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      });

      return {
        id: response.data.id,
        username: response.data.login || response.data.username,
        email: response.data.email,
        full_name: response.data.full_name || response.data.login,
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
