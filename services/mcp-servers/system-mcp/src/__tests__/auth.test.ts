/**
 * Tests for System MCP authentication and API requests
 */

import {
  getSystemConfig,
  gatewayRequest,
  conductorRequest,
} from "../auth.js";

// Save original env
const originalEnv = process.env;

describe("getSystemConfig", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("should return config when all required env vars are set", () => {
    // Arrange
    process.env.GATEWAY_URL = "http://gateway";
    process.env.GATEWAY_API_KEY = "gw-api-key";
    process.env.REDIS_URL = "redis://redis:6379";
    process.env.CONDUCTOR_URL = "http://conductor:3001";
    process.env.CONDUCTOR_SECRET = "conductor-secret";
    process.env.DATABASE_URL = "postgres://localhost/db";

    // Act
    const config = getSystemConfig();

    // Assert
    expect(config).toEqual({
      gatewayUrl: "http://gateway",
      gatewayApiKey: "gw-api-key",
      redisUrl: "redis://redis:6379",
      conductorUrl: "http://conductor:3001",
      conductorSecret: "conductor-secret",
      databaseUrl: "postgres://localhost/db",
      lokiUrl: "http://loki:3100",
      prometheusUrl: "http://prometheus:9090",
      grafanaUrl: "http://grafana:3000",
      grafanaToken: undefined,
    });
  });

  it("should allow optional CONDUCTOR_SECRET and DATABASE_URL", () => {
    // Arrange
    process.env.GATEWAY_URL = "http://gateway";
    process.env.GATEWAY_API_KEY = "gw-api-key";
    process.env.REDIS_URL = "redis://redis:6379";
    process.env.CONDUCTOR_URL = "http://conductor:3001";
    delete process.env.CONDUCTOR_SECRET;
    delete process.env.DATABASE_URL;

    // Act
    const config = getSystemConfig();

    // Assert
    expect(config.conductorSecret).toBeUndefined();
    expect(config.databaseUrl).toBeUndefined();
  });

  it("should throw when GATEWAY_URL is missing", () => {
    // Arrange
    delete process.env.GATEWAY_URL;
    process.env.GATEWAY_API_KEY = "key";
    process.env.REDIS_URL = "redis://redis:6379";
    process.env.CONDUCTOR_URL = "http://conductor:3001";

    // Act & Assert
    expect(() => getSystemConfig()).toThrow(
      "GATEWAY_URL, GATEWAY_API_KEY, REDIS_URL, and CONDUCTOR_URL must be set"
    );
  });

  it("should throw when GATEWAY_API_KEY is missing", () => {
    // Arrange
    process.env.GATEWAY_URL = "http://gateway";
    delete process.env.GATEWAY_API_KEY;
    process.env.REDIS_URL = "redis://redis:6379";
    process.env.CONDUCTOR_URL = "http://conductor:3001";

    // Act & Assert
    expect(() => getSystemConfig()).toThrow();
  });

  it("should throw when REDIS_URL is missing", () => {
    // Arrange
    process.env.GATEWAY_URL = "http://gateway";
    process.env.GATEWAY_API_KEY = "key";
    delete process.env.REDIS_URL;
    process.env.CONDUCTOR_URL = "http://conductor:3001";

    // Act & Assert
    expect(() => getSystemConfig()).toThrow();
  });

  it("should throw when CONDUCTOR_URL is missing", () => {
    // Arrange
    process.env.GATEWAY_URL = "http://gateway";
    process.env.GATEWAY_API_KEY = "key";
    process.env.REDIS_URL = "redis://redis:6379";
    delete process.env.CONDUCTOR_URL;

    // Act & Assert
    expect(() => getSystemConfig()).toThrow();
  });
});

describe("gatewayRequest", () => {
  let mockFetch: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.GATEWAY_URL = "http://gateway";
    process.env.GATEWAY_API_KEY = "gw-api-key";
    process.env.REDIS_URL = "redis://redis:6379";
    process.env.CONDUCTOR_URL = "http://conductor:3001";

    mockFetch = jest.spyOn(global, "fetch").mockImplementation();
  });

  afterAll(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  it("should make request with Bearer API key auth", async () => {
    // Arrange
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ models: [] }),
    });

    // Act
    await gatewayRequest("GET", "/models");

    // Assert
    expect(mockFetch).toHaveBeenCalledWith(
      "http://gateway/models",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer gw-api-key",
          "Content-Type": "application/json",
        }),
      })
    );
  });

  it("should make POST request with body", async () => {
    // Arrange
    const body = { model: "gpt-4", messages: [] };
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [] }),
    });

    // Act
    await gatewayRequest("POST", "/chat/completions", body);

    // Assert
    expect(mockFetch).toHaveBeenCalledWith(
      "http://gateway/chat/completions",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(body),
      })
    );
  });

  it("should throw on non-OK response", async () => {
    // Arrange
    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => "Rate limited",
    });

    // Act & Assert
    await expect(gatewayRequest("POST", "/chat/completions")).rejects.toThrow(
      "Gateway API error (429): Rate limited"
    );
  });
});

describe("conductorRequest", () => {
  let mockFetch: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.GATEWAY_URL = "http://gateway";
    process.env.GATEWAY_API_KEY = "gw-api-key";
    process.env.REDIS_URL = "redis://redis:6379";
    process.env.CONDUCTOR_URL = "http://conductor:3001";
    process.env.CONDUCTOR_SECRET = "conductor-secret";

    mockFetch = jest.spyOn(global, "fetch").mockImplementation();
  });

  afterAll(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  it("should make request with Bearer conductor secret", async () => {
    // Arrange
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: "ok" }),
    });

    // Act
    await conductorRequest("GET", "/health");

    // Assert
    expect(mockFetch).toHaveBeenCalledWith(
      "http://conductor:3001/health",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer conductor-secret",
        }),
      })
    );
  });

  it("should throw when CONDUCTOR_SECRET is not set", async () => {
    // Arrange
    delete process.env.CONDUCTOR_SECRET;

    // Act & Assert
    await expect(conductorRequest("GET", "/health")).rejects.toThrow(
      "CONDUCTOR_SECRET must be set to call Conductor internal API"
    );
  });

  it("should throw on non-OK response", async () => {
    // Arrange
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
    });

    // Act & Assert
    await expect(conductorRequest("GET", "/health")).rejects.toThrow(
      "Conductor API error (500): Internal Server Error"
    );
  });
});
