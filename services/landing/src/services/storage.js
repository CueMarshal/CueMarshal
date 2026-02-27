/**
 * Local storage service for web
 */

const TOKEN_KEY = 'auth_token';
const USER_KEY = 'auth_user';
const SESSION_ID_KEY = 'chat_session_id';
const SESSIONS_LIST_KEY = 'chat_sessions_list';
const THEME_KEY = 'ui_theme';

export const storage = {
  /**
   * Save authentication token
   */
  async saveToken(token) {
    localStorage.setItem(TOKEN_KEY, token);
  },

  /**
   * Get authentication token
   */
  async getToken() {
    return localStorage.getItem(TOKEN_KEY);
  },

  /**
   * Remove authentication token
   */
  async removeToken() {
    localStorage.removeItem(TOKEN_KEY);
  },

  /**
   * Save user data
   */
  async saveUser(user) {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  },

  /**
   * Get user data
   */
  async getUser() {
    const userData = localStorage.getItem(USER_KEY);
    return userData ? JSON.parse(userData) : null;
  },

  /**
   * Remove user data
   */
  async removeUser() {
    localStorage.removeItem(USER_KEY);
  },

  /**
   * Save current chat session ID
   */
  async saveCurrentSessionId(sessionId) {
    localStorage.setItem(SESSION_ID_KEY, sessionId);
  },

  /**
   * Get current chat session ID
   */
  async getCurrentSessionId() {
    return localStorage.getItem(SESSION_ID_KEY);
  },

  /**
   * Remove current chat session ID
   */
  async clearCurrentSessionId() {
    localStorage.removeItem(SESSION_ID_KEY);
  },

  /**
   * Save sessions list cache
   */
  async saveSessionsList(sessions) {
    localStorage.setItem(SESSIONS_LIST_KEY, JSON.stringify(sessions));
  },

  /**
   * Get sessions list cache
   */
  async getSessionsList() {
    const data = localStorage.getItem(SESSIONS_LIST_KEY);
    return data ? JSON.parse(data) : [];
  },

  /**
   * Clear sessions list cache
   */
  async clearSessionsList() {
    localStorage.removeItem(SESSIONS_LIST_KEY);
  },

  /**
   * Save theme preference ('light', 'dark', or 'system')
   */
  async saveTheme(theme) {
    localStorage.setItem(THEME_KEY, theme);
  },

  /**
   * Get theme preference
   */
  async getTheme() {
    return localStorage.getItem(THEME_KEY) || 'system';
  },

  /**
   * Clear all chat-related data
   */
  async clearChatData() {
    await this.clearCurrentSessionId();
    await this.clearSessionsList();
  },

  /**
   * Clear all stored data
   */
  async clear() {
    await this.removeToken();
    await this.removeUser();
    await this.clearChatData();
  },
};
