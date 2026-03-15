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
 * Stream a chat message response via SSE.
 * @param {string} message
 * @param {string|null} sessionId
 * @param {Object} callbacks - { onChunk, onDone, onError }
 * @returns {Promise<void>}
 */
function processSseLine(line, { onChunk, onDone, onError }) {
  if (!line.startsWith('data: ')) return;
  try {
    const data = JSON.parse(line.slice(6));
    if (data.type === 'done') {
      onDone(data);
    } else if (data.type === 'error') {
      onError(new Error(data.message));
    } else {
      onChunk(data);
    }
  } catch {
    // ignore malformed SSE lines
  }
}

export async function streamChatMessage(message, sessionId, { onChunk, onDone, onError }) {
  const token = await storage.getToken();
  const body = JSON.stringify({
    message,
    session_id: sessionId || undefined,
  });

  const response = await fetch(`${config.conductorUrl}/chat/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `Stream failed: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      processSseLine(line, { onChunk, onDone, onError });
    }
  }
}

/**
 * Fetch Kanban board data for a repository.
 * @param {string|null} repo - "owner/name" format, or null for default
 */
export async function fetchProjectBoard(repo = null) {
  const params = repo ? `?repo=${encodeURIComponent(repo)}` : '';
  const res = await api.get(`/projects/board${params}`);
  return res.data;
}

/**
 * List organization repositories for the repo picker.
 */
export async function fetchProjectRepos() {
  const res = await api.get('/projects/repos');
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

/**
 * Create a new chat session.
 * @param {string|null} title - optional session title
 * @returns {Promise<{id: string, title: string|null, is_favorite: boolean, created_at: string, updated_at: string}>}
 */
export async function createChatSession(title = null) {
  const res = await api.post('/chat/sessions', { title });
  return res.data;
}

/**
 * Update a chat session (title, favorite status).
 * @param {string} sessionId
 * @param {Object} updates - { title?: string, is_favorite?: boolean }
 */
export async function updateChatSession(sessionId, updates) {
  const res = await api.patch(`/chat/sessions/${sessionId}`, updates);
  return res.data;
}

/**
 * Delete a chat session.
 * @param {string} sessionId
 */
export async function deleteChatSession(sessionId) {
  await api.delete(`/chat/sessions/${sessionId}`);
}
