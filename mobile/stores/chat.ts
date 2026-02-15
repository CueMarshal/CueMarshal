import { create } from "zustand";
import { getGlobalRuntimeConfig } from '../hooks/useRuntimeConfig';
import { useAuthStore } from './auth';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

interface ChatState {
  messages: Message[];
  isLoading: boolean;
  sessionId: string | null;
  sendMessage: (msg: string) => Promise<void>;
  clearMessages: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isLoading: false,
  sessionId: null,
  sendMessage: async (msg) => {
    // Add user message
    const userMessage: Message = {
      role: 'user',
      content: msg,
      timestamp: Date.now(),
    };
    
    set({ 
      messages: [...get().messages, userMessage],
      isLoading: true 
    });

    try {
      // Get runtime config (supports dynamic URL changes)
      const runtimeConfig = await getGlobalRuntimeConfig();
      const token = useAuthStore.getState().token;
      
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch(`${runtimeConfig.conductorUrl}/chat`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          session_id: get().sessionId,
          message: msg,
        }),
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json();
      
      // Track session for conversation continuity
      if (data.sessionId) {
        set({ sessionId: data.sessionId });
      }

      // Add assistant response
      const assistantMessage: Message = {
        role: 'assistant',
        content: data.message?.content || data.message || 'No response',
        timestamp: Date.now(),
      };
      
      set({ 
        messages: [...get().messages, assistantMessage],
        isLoading: false 
      });
    } catch (error) {
      console.error('Error sending message:', error);
      
      // Add error message
      const errorMessage: Message = {
        role: 'assistant',
        content: 'Sorry, I encountered an error. Please try again.',
        timestamp: Date.now(),
      };
      
      set({ 
        messages: [...get().messages, errorMessage],
        isLoading: false 
      });
    }
  },
  clearMessages: () => set({ messages: [], sessionId: null }),
}));
