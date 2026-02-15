import { useState, useEffect } from 'react';
import { storage } from '../services/storage';
import { DEFAULT_BASE_URL, GITEA_URL, CONDUCTOR_URL } from '../config';

export interface RuntimeConfig {
  baseUrl: string;
  giteaUrl: string;
  conductorUrl: string;
}

/**
 * Hook to manage runtime configuration
 * Loads saved URL from storage or uses platform-appropriate default
 */
export function useRuntimeConfig() {
  const [config, setConfig] = useState<RuntimeConfig>({
    baseUrl: DEFAULT_BASE_URL,
    giteaUrl: GITEA_URL,
    conductorUrl: CONDUCTOR_URL,
  });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      const savedUrl = await storage.getBaseUrl();
      if (savedUrl) {
        updateBaseUrl(savedUrl);
      }
    } catch (error) {
      console.error('Failed to load runtime config:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const updateBaseUrl = (newBaseUrl: string) => {
    const trimmedUrl = newBaseUrl.trim().replace(/\/$/, ''); // Remove trailing slash
    setConfig({
      baseUrl: trimmedUrl,
      giteaUrl: trimmedUrl,
      conductorUrl: `${trimmedUrl}/api`,
    });
  };

  const saveBaseUrl = async (newBaseUrl: string) => {
    const trimmedUrl = newBaseUrl.trim().replace(/\/$/, '');
    await storage.saveBaseUrl(trimmedUrl);
    updateBaseUrl(trimmedUrl);
  };

  const resetToDefault = async () => {
    await storage.saveBaseUrl(DEFAULT_BASE_URL);
    updateBaseUrl(DEFAULT_BASE_URL);
  };

  return {
    config,
    isLoading,
    saveBaseUrl,
    resetToDefault,
  };
}

// Global runtime config instance
let _runtimeConfig: RuntimeConfig | null = null;

export async function getGlobalRuntimeConfig(): Promise<RuntimeConfig> {
  if (_runtimeConfig) {
    return _runtimeConfig;
  }

  const savedUrl = await storage.getBaseUrl();
  const baseUrl = savedUrl || DEFAULT_BASE_URL;

  _runtimeConfig = {
    baseUrl,
    giteaUrl: baseUrl,
    conductorUrl: `${baseUrl}/api`,
  };

  return _runtimeConfig;
}

export function updateGlobalRuntimeConfig(newBaseUrl: string) {
  const trimmedUrl = newBaseUrl.trim().replace(/\/$/, '');
  _runtimeConfig = {
    baseUrl: trimmedUrl,
    giteaUrl: trimmedUrl,
    conductorUrl: `${trimmedUrl}/api`,
  };
}
