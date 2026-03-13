import { create } from "zustand";
import { authService } from "../services/auth";
import { storage } from "../services/storage";
import { User } from "../types/auth";

interface AuthState {
  token: string | null;
  tokenExpiresAt: number | null;
  user: User | null;
  isLoading: boolean;
  isInitialized: boolean;
  login: (token: string, user: User) => void;
  logout: () => Promise<void>;
  initialize: () => Promise<void>;
  startOAuthFlow: () => Promise<{ success: boolean; error?: string }>;
  refreshToken: () => Promise<{ success: boolean; error?: string }>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token: null,
  tokenExpiresAt: null,
  user: null,
  isLoading: false,
  isInitialized: false,
  
  login: (token, user) => {
    set({ token, user });
  },
  
  logout: async () => {
    await authService.logout();
    set({ token: null, tokenExpiresAt: null, user: null });
  },
  
  initialize: async () => {
    set({ isLoading: true });
    try {
      // Check if stored token is expired and needs a refresh before restoring
      const expiresAt = await storage.getTokenExpiresAt();
      const isExpired = expiresAt !== null && Date.now() > expiresAt - 60_000;

      if (isExpired) {
        const refreshResult = await authService.refreshAccessToken();
        if (refreshResult.success && refreshResult.token) {
          const user = await storage.getUser();
          set({
            token: refreshResult.token,
            tokenExpiresAt: refreshResult.expiresAt ?? null,
            user,
            isInitialized: true,
          });
          return;
        }
        // Refresh failed — fall through to restoreAuth (which will clear storage)
      }

      const result = await authService.restoreAuth();
      if (result.success && result.token && result.user) {
        set({ 
          token: result.token,
          tokenExpiresAt: expiresAt,
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
  
  refreshToken: async () => {
    const result = await authService.refreshAccessToken();
    if (result.success && result.token) {
      set({ token: result.token, tokenExpiresAt: result.expiresAt ?? null });
      return { success: true };
    }
    // Refresh failed — log the user out
    await get().logout();
    return { success: false, error: result.error };
  },

  startOAuthFlow: async () => {
    set({ isLoading: true });
    try {
      const result = await authService.startOAuthFlow();
      
      if (result.success && result.token && result.user) {
        // Persist refresh token and expiry if provided
        if (result.refreshToken) await storage.saveRefreshToken(result.refreshToken);
        if (result.expiresAt) await storage.saveTokenExpiresAt(result.expiresAt);

        set({ 
          token: result.token,
          tokenExpiresAt: result.expiresAt ?? null,
          user: result.user,
          isLoading: false,
        });
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
