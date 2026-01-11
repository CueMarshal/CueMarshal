/**
 * Tests for shared authentication utilities
 */

import { validateBearerToken, getAuthContext } from "../auth.js";

describe("validateBearerToken", () => {
  const expectedToken = "test-secret-token-123";

  describe("Valid tokens", () => {
    it("should return true for a valid Bearer token", () => {
      // Arrange
      const authHeader = `Bearer ${expectedToken}`;

      // Act
      const result = validateBearerToken(authHeader, expectedToken);

      // Assert
      expect(result).toBe(true);
    });
  });

  describe("Invalid tokens", () => {
    it("should return false for undefined auth header", () => {
      // Act
      const result = validateBearerToken(undefined, expectedToken);

      // Assert
      expect(result).toBe(false);
    });

    it("should return false for empty auth header", () => {
      // Act
      const result = validateBearerToken("", expectedToken);

      // Assert
      expect(result).toBe(false);
    });

    it("should return false for wrong token value", () => {
      // Arrange
      const authHeader = "Bearer wrong-token";

      // Act
      const result = validateBearerToken(authHeader, expectedToken);

      // Assert
      expect(result).toBe(false);
    });

    it("should return false for missing Bearer prefix", () => {
      // Arrange
      const authHeader = expectedToken;

      // Act
      const result = validateBearerToken(authHeader, expectedToken);

      // Assert
      expect(result).toBe(false);
    });

    it("should return false for wrong auth scheme", () => {
      // Arrange
      const authHeader = `Basic ${expectedToken}`;

      // Act
      const result = validateBearerToken(authHeader, expectedToken);

      // Assert
      expect(result).toBe(false);
    });

    it("should return false for extra spaces in header", () => {
      // Arrange
      const authHeader = `Bearer  ${expectedToken}`;

      // Act
      const result = validateBearerToken(authHeader, expectedToken);

      // Assert
      expect(result).toBe(false);
    });

    it("should return false for lowercase bearer", () => {
      // Arrange
      const authHeader = `bearer ${expectedToken}`;

      // Act
      const result = validateBearerToken(authHeader, expectedToken);

      // Assert
      expect(result).toBe(false);
    });
  });
});

describe("getAuthContext", () => {
  describe("From environment variables", () => {
    it("should extract token from GITEA_TOKEN", () => {
      // Arrange
      const env = { GITEA_TOKEN: "gitea-token-123" } as NodeJS.ProcessEnv;

      // Act
      const context = getAuthContext(env);

      // Assert
      expect(context.token).toBe("gitea-token-123");
    });

    it("should extract token from CONDUCTOR_SECRET when GITEA_TOKEN is not set", () => {
      // Arrange
      const env = { CONDUCTOR_SECRET: "conductor-secret-456" } as NodeJS.ProcessEnv;

      // Act
      const context = getAuthContext(env);

      // Assert
      expect(context.token).toBe("conductor-secret-456");
    });

    it("should prefer GITEA_TOKEN over CONDUCTOR_SECRET", () => {
      // Arrange
      const env = {
        GITEA_TOKEN: "gitea-token",
        CONDUCTOR_SECRET: "conductor-secret",
      } as NodeJS.ProcessEnv;

      // Act
      const context = getAuthContext(env);

      // Assert
      expect(context.token).toBe("gitea-token");
    });
  });

  describe("From headers", () => {
    it("should extract userId and role from headers", () => {
      // Arrange
      const env = {} as NodeJS.ProcessEnv;
      const headers = {
        "x-user-id": "user-123",
        "x-agent-role": "developer",
      };

      // Act
      const context = getAuthContext(env, headers);

      // Assert
      expect(context.userId).toBe("user-123");
      expect(context.role).toBe("developer");
    });

    it("should extract authorization from headers as fallback", () => {
      // Arrange
      const env = {} as NodeJS.ProcessEnv;
      const headers = {
        authorization: "Bearer header-token",
      };

      // Act
      const context = getAuthContext(env, headers);

      // Assert
      expect(context.token).toBe("Bearer header-token");
    });
  });

  describe("Missing values", () => {
    it("should return undefined fields for empty env and no headers", () => {
      // Arrange
      const env = {} as NodeJS.ProcessEnv;

      // Act
      const context = getAuthContext(env);

      // Assert
      expect(context.token).toBeUndefined();
      expect(context.userId).toBeUndefined();
      expect(context.role).toBeUndefined();
    });

    it("should return undefined userId and role when headers are not provided", () => {
      // Arrange
      const env = { GITEA_TOKEN: "token" } as NodeJS.ProcessEnv;

      // Act
      const context = getAuthContext(env);

      // Assert
      expect(context.token).toBe("token");
      expect(context.userId).toBeUndefined();
      expect(context.role).toBeUndefined();
    });
  });
});
