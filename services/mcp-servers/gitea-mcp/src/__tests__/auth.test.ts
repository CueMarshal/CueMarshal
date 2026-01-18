/**
 * Tests for Gitea MCP authentication and API requests
 */

import { getGiteaConfig, giteaRequest } from "../auth.js";

// Save original env
const originalEnv = process.env;

describe("getGiteaConfig", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("should return config when both env vars are set", () => {
    // Arrange
    process.env.GITEA_URL = "http://gitea:3000";
    process.env.GITEA_TOKEN = "gitea-token-123";

    // Act
    const config = getGiteaConfig();

    // Assert
    expect(config).toEqual({
      url: "http://gitea:3000",
      token: "gitea-token-123",
    });
  });

  it("should throw when GITEA_URL is missing", () => {
    // Arrange
    delete process.env.GITEA_URL;
    process.env.GITEA_TOKEN = "gitea-token-123";

    // Act & Assert
    expect(() => getGiteaConfig()).toThrow(
      "GITEA_URL and GITEA_TOKEN must be set"
    );
  });

  it("should throw when GITEA_TOKEN is missing", () => {
    // Arrange
    process.env.GITEA_URL = "http://gitea:3000";
    delete process.env.GITEA_TOKEN;

    // Act & Assert
    expect(() => getGiteaConfig()).toThrow(
      "GITEA_URL and GITEA_TOKEN must be set"
    );
  });

  it("should throw when both env vars are missing", () => {
    // Arrange
    delete process.env.GITEA_URL;
    delete process.env.GITEA_TOKEN;

    // Act & Assert
    expect(() => getGiteaConfig()).toThrow();
  });
});

describe("giteaRequest", () => {
  let mockFetch: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.GITEA_URL = "http://gitea:3000";
    process.env.GITEA_TOKEN = "gitea-token-123";

    mockFetch = jest.spyOn(global, "fetch").mockImplementation();
  });

  afterAll(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  it("should make GET request with token auth header", async () => {
    // Arrange
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: "test" }),
    });

    // Act
    await giteaRequest("GET", "/repos/search");

    // Assert
    expect(mockFetch).toHaveBeenCalledWith(
      "http://gitea:3000/api/v1/repos/search",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "token gitea-token-123",
          "Content-Type": "application/json",
        }),
      })
    );
  });

  it("should use authToken override when provided", async () => {
    // Arrange
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ login: "user" }),
    });

    // Act
    await giteaRequest("GET", "/user", undefined, "override-token");

    // Assert
    expect(mockFetch).toHaveBeenCalledWith(
      "http://gitea:3000/api/v1/user",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "token override-token",
        }),
      })
    );
  });

  it("should make POST request with JSON body", async () => {
    // Arrange
    const body = { title: "Test Issue", body: "Issue body" };
    mockFetch.mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ id: 42 }),
    });

    // Act
    await giteaRequest("POST", "/repos/owner/repo/issues", body);

    // Assert
    expect(mockFetch).toHaveBeenCalledWith(
      "http://gitea:3000/api/v1/repos/owner/repo/issues",
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
    const result = await giteaRequest("DELETE", "/repos/owner/repo/issues/1");

    // Assert
    expect(result).toBeNull();
  });

  it("should return parsed JSON for successful responses", async () => {
    // Arrange
    const responseData = { id: 1, title: "Test" };
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => responseData,
    });

    // Act
    const result = await giteaRequest("GET", "/repos/owner/repo/issues/1");

    // Assert
    expect(result).toEqual(responseData);
  });

  it("should throw on non-OK response", async () => {
    // Arrange
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => "Not Found",
    });

    // Act & Assert
    await expect(
      giteaRequest("GET", "/repos/owner/repo/issues/999")
    ).rejects.toThrow("Gitea API error (404): Not Found");
  });

  it("should not include body for GET requests", async () => {
    // Arrange
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });

    // Act
    await giteaRequest("GET", "/user");

    // Assert
    const callArgs = mockFetch.mock.calls[0][1];
    expect(callArgs.body).toBeUndefined();
  });
});
