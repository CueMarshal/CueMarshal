import { create } from "zustand";
import { authService } from "../services/auth";

/**
 * @typedef {Object} AuthState
 * @property {string|null} token
 * @property {import('../types/auth').User|null} user
 * @property {boolean} isLoading
 * @property {boolean} isInitialized
 * @property {(token: string, user: import('../types/auth').User) => void} login
 * @property {() => Promise<void>} logout
 * @property {() => Promise<void>} initialize
 * @property {() => Promise<{success: boolean, error?: string}>} startOAuthFlow
 */

export const useAuthStore = create((set) => ({
  token: null,
  user: null,
  isLoading: false,
  isInitialized: false,
  
  login: (token, user) => {
    set({ token, user });
  },
  
  logout: async () => {
    await authService.logout();
    set({ token: null, user: null });
  },
  
  initialize: async () => {
    set({ isLoading: true });
    try {
      const result = await authService.restoreAuth();
      if (result.success && result.token && result.user) {
        set({ 
          token: result.token, 
          user: result.user,
          isInitialized: true,
        });
      } else {
        set({ isInitialized: true });
      }
    } catch (error) {
      console.error('Failed to initialize auth:', error);
      set({ isInitialized: true });
    } finally {
      set({ isLoading: false });
    }
  },
  
  startOAuthFlow: async () => {
    set({ isLoading: true });
    try {
      const result = await authService.startOAuthFlow();
      
      if (result.success) {
        // OAuth flow will redirect, so we don't need to update state here
        return { success: true };
      } else {
        set({ isLoading: false });
        return { 
          success: false, 
          error: result.error || 'Authentication failed' 
        };
      }
    } catch (error) {
      set({ isLoading: false });
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  },
}));
