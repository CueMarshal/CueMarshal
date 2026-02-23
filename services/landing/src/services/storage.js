/**
 * Local storage service for web
 */

const TOKEN_KEY = 'auth_token';
const USER_KEY = 'auth_user';

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
   * Clear all stored data
   */
  async clear() {
    await this.removeToken();
    await this.removeUser();
  },
};
