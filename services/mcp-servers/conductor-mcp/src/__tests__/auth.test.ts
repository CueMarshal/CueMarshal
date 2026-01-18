/**
 * Tests for Conductor MCP authentication and API requests
 */

import { getConductorConfig, conductorRequest } from "../auth.js";

// Save original env
const originalEnv = process.env;

describe("getConductorConfig", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("should return config when both env vars are set", () => {
    // Arrange
    process.env.CONDUCTOR_URL = "http://conductor:3001";
    process.env.CONDUCTOR_SECRET = "test-secret";

    // Act
    const config = getConductorConfig();

    // Assert
    expect(config).toEqual({
      url: "http://conductor:3001",
      secret: "test-secret",
    });
  });

  it("should throw when CONDUCTOR_URL is missing", () => {
    // Arrange
    delete process.env.CONDUCTOR_URL;
    process.env.CONDUCTOR_SECRET = "test-secret";

    // Act & Assert
    expect(() => getConductorConfig()).toThrow(
      "CONDUCTOR_URL and CONDUCTOR_SECRET must be set"
    );
  });

  it("should throw when CONDUCTOR_SECRET is missing", () => {
    // Arrange
    process.env.CONDUCTOR_URL = "http://conductor:3001";
    delete process.env.CONDUCTOR_SECRET;

    // Act & Assert
    expect(() => getConductorConfig()).toThrow(
      "CONDUCTOR_URL and CONDUCTOR_SECRET must be set"
    );
  });

  it("should throw when both env vars are missing", () => {
    // Arrange
    delete process.env.CONDUCTOR_URL;
    delete process.env.CONDUCTOR_SECRET;

    // Act & Assert
    expect(() => getConductorConfig()).toThrow();
  });
});

describe("conductorRequest", () => {
  let mockFetch: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.CONDUCTOR_URL = "http://conductor:3001";
    process.env.CONDUCTOR_SECRET = "test-secret";

    mockFetch = jest.spyOn(global, "fetch").mockImplementation();
  });

  afterAll(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  it("should make GET request with correct auth header", async () => {
    // Arrange
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: "test" }),
    });

    // Act
    await conductorRequest("GET", "/tasks");

    // Assert
    expect(mockFetch).toHaveBeenCalledWith(
      "http://conductor:3001/api/internal/tasks",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer test-secret",
          "Content-Type": "application/json",
        }),
      })
    );
  });

  it("should make POST request with JSON body", async () => {
    // Arrange
    const body = { task: "implement feature" };
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 1 }),
    });

    // Act
    await conductorRequest("POST", "/tasks", body);

    // Assert
    expect(mockFetch).toHaveBeenCalledWith(
      "http://conductor:3001/api/internal/tasks",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(body),
      })
    );
  });

  it("should return null for 204 No Content", async () => {
    // Arrange
    mockFetch.mockResolvedValue({
      ok: true,
      status: 204,
    });

    // Act
    const result = await conductorRequest("DELETE", "/tasks/1");

    // Assert
    expect(result).toBeNull();
  });

  it("should return parsed JSON for successful responses", async () => {
    // Arrange
    const responseData = { id: 1, status: "completed" };
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => responseData,
    });

    // Act
    const result = await conductorRequest("GET", "/tasks/1");

    // Assert
    expect(result).toEqual(responseData);
  });

  it("should throw on non-OK response", async () => {
    // Arrange
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    });

    // Act & Assert
    await expect(conductorRequest("GET", "/tasks")).rejects.toThrow(
      "Conductor API error (401): Unauthorized"
    );
  });

  it("should not include body for GET requests", async () => {
    // Arrange
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });

    // Act
    await conductorRequest("GET", "/health");

    // Assert
    const callArgs = mockFetch.mock.calls[0][1];
    expect(callArgs.body).toBeUndefined();
  });
});
