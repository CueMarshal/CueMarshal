import * as SecureStore from 'expo-secure-store';
import { User } from '../types/auth';

const TOKEN_KEY = 'auth_token';
const REFRESH_TOKEN_KEY = 'auth_refresh_token';
const TOKEN_EXPIRES_AT_KEY = 'auth_token_expires_at';
const USER_KEY = 'user_data';
const BASE_URL_KEY = 'base_url';

export const storage = {
  // Save auth token securely
  async saveToken(token: string): Promise<void> {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
  },

  // Retrieve auth token
  async getToken(): Promise<string | null> {
    return await SecureStore.getItemAsync(TOKEN_KEY);
  },

  // Save user data
  async saveUser(user: User): Promise<void> {
    await SecureStore.setItemAsync(USER_KEY, JSON.stringify(user));
  },

  // Retrieve user data
  async getUser(): Promise<User | null> {
    try {
      const userData = await SecureStore.getItemAsync(USER_KEY);
      return userData ? JSON.parse(userData) : null;
    } catch (error) {
      console.error('Failed to parse user data from SecureStore:', error);
      // Clear corrupted data
      await SecureStore.deleteItemAsync(USER_KEY);
      return null;
    }
  },

  // Save base URL (allows runtime reconfiguration)
  async saveBaseUrl(url: string): Promise<void> {
    await SecureStore.setItemAsync(BASE_URL_KEY, url);
  },

  // Retrieve base URL
  async getBaseUrl(): Promise<string | null> {
    return await SecureStore.getItemAsync(BASE_URL_KEY);
  },

  // Clear all auth data
  async clearAuth(): Promise<void> {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
    await SecureStore.deleteItemAsync(TOKEN_EXPIRES_AT_KEY);
    await SecureStore.deleteItemAsync(USER_KEY);
  },

  // Save refresh token securely
  async saveRefreshToken(token: string): Promise<void> {
    await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, token);
  },

  // Retrieve refresh token
  async getRefreshToken(): Promise<string | null> {
    return await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
  },

  // Save token expiry time (epoch ms)
  async saveTokenExpiresAt(expiresAt: number): Promise<void> {
    await SecureStore.setItemAsync(TOKEN_EXPIRES_AT_KEY, String(expiresAt));
  },

  // Retrieve token expiry time
  async getTokenExpiresAt(): Promise<number | null> {
    const val = await SecureStore.getItemAsync(TOKEN_EXPIRES_AT_KEY);
    return val ? Number(val) : null;
  },
};
