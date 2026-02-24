import axios from 'axios';
import { config } from '../config';
import { storage } from './storage';

const api = axios.create({
  baseURL: config.conductorUrl,
  headers: { 'Content-Type': 'application/json' },
});

// Attach auth token to every request when available
api.interceptors.request.use(async (cfg) => {
  const token = await storage.getToken();
  if (token) {
    cfg.headers.Authorization = `Bearer ${token}`;
  }
  return cfg;
});

/**
 * Fetch per-agent activity status and pipeline state.
 * Endpoint is unauthenticated (internal).
 */
export async function fetchAgentActivity() {
  const res = await api.get('/internal/agents/activity');
  return res.data;
}

/**
 * Send a chat message to the conductor and get an LLM-powered response.
 * @param {string} message
 * @param {string|null} sessionId - existing session ID or null to create one
 * @returns {Promise<{sessionId: string, message: {role: string, content: string}, toolCallsSummary?: Array}>}
 */
export async function sendChatMessage(message, sessionId = null) {
  const body = { message };
  if (sessionId) body.session_id = sessionId;
  const res = await api.post('/chat', body);
  return res.data;
}

/**
 * List chat sessions for the current user.
 */
export async function fetchChatSessions() {
  const res = await api.get('/chat/sessions');
  return res.data;
}

/**
 * Get full message history for a chat session.
 * @param {string} sessionId
 */
export async function fetchChatHistory(sessionId) {
  const res = await api.get(`/chat/sessions/${sessionId}`);
  return res.data;
}
