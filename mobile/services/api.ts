import Constants from 'expo-constants';
import { storage } from './storage';

/**
 * Base URL for API requests
 * Uses the baseUrl from app.json extra config
 */
const BASE_URL = Constants.expoConfig?.extra?.baseUrl || 'http://localhost';

/**
 * API Service for fetching data from Conductor
 */
export const api = {
    /**
     * Fetch dashboard data including health, costs, metrics, and activity
     */
    getDashboardData: async () => {
        try {
            const token = await storage.getToken();
            const headers: Record<string, string> = {};
            if (token) {
                headers.Authorization = `Bearer ${token}`;
            }

            const response = await fetch(`${BASE_URL}/api/dashboard`, { headers });

            if (!response.ok) {
                throw new Error(`API Error: ${response.status} ${response.statusText}`);
            }

            return await response.json();
        } catch (error) {
            console.error('Failed to fetch dashboard data:', error);
            throw error;
        }
    },

    /**
     * Fetch projects list
     */
    getProjects: async () => {
        try {
            const token = await storage.getToken();
            const headers: Record<string, string> = {};
            if (token) {
                headers.Authorization = `Bearer ${token}`;
            }

            const response = await fetch(`${BASE_URL}/api/projects`, { headers });
            if (!response.ok) {
                throw new Error(`API Error: ${response.status} ${response.statusText}`);
            }
            return await response.json();
        } catch (error) {
            console.error('Failed to fetch projects:', error);
            throw error;
        }
    }
};
