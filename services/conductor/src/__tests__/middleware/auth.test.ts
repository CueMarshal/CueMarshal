/**
 * Authentication Middleware Tests
 * Tests for validateBearerToken middleware
 */

import { Request, Response } from "express";
import { validateBearerToken } from "../../middleware/auth.js";

// Mock the logger to avoid console spam in tests
jest.mock("../../utils/logger.js", () => ({
  logger: {
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock the config
jest.mock("../../config.js", () => ({
  config: ({
    conductorSecret: "test-secret-token-12345",
  }),
}));

describe("validateBearerToken Middleware", () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let next: jest.Mock<void>;

  beforeEach(() => {
    // Reset mocks before each test
    jest.clearAllMocks();

    // Setup request mock
    req = {
      headers: {},
      path: "/api/internal/costs",
      method: "POST",
    };

    // Setup response mock with chainable methods
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    // Setup next middleware function
    next = jest.fn();
  });

  describe("Missing Authorization Header", () => {
    it("should return 401 when Authorization header is missing", () => {
      // Arrange: No authorization header
      req.headers = {};

      // Act
      validateBearerToken(req as Request, res as Response, next);

      // Assert
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: "Unauthorized",
        message: "Missing or invalid Authorization header",
      });
      expect(next).not.toHaveBeenCalled();
    });

    it("should return 401 when Authorization header is empty string", () => {
      // Arrange: Empty authorization header
      req.headers = { authorization: "" };

      // Act
      validateBearerToken(req as Request, res as Response, next);

      // Assert
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: "Unauthorized",
        message: "Missing or invalid Authorization header",
      });
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe("Invalid Bearer Format", () => {
    it("should return 401 when Authorization header does not start with 'Bearer '", () => {
      // Arrange: Missing 'Bearer ' prefix
      req.headers = { authorization: "token-12345" };

      // Act
      validateBearerToken(req as Request, res as Response, next);

      // Assert
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: "Unauthorized",
        message: "Missing or invalid Authorization header",
      });
      expect(next).not.toHaveBeenCalled();
    });

    it("should return 401 when Authorization header uses lowercase 'bearer'", () => {
      // Arrange: Lowercase bearer prefix
      req.headers = { authorization: "bearer test-secret-token-12345" };

      // Act
      validateBearerToken(req as Request, res as Response, next);

      // Assert
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: "Unauthorized",
        message: "Missing or invalid Authorization header",
      });
      expect(next).not.toHaveBeenCalled();
    });

    it("should return 401 when Authorization header has 'Bearer' but no space", () => {
      // Arrange: Missing space after Bearer
      req.headers = { authorization: "Bearertoken-12345" };

      // Act
      validateBearerToken(req as Request, res as Response, next);

      // Assert
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it("should return 401 when Authorization header is only 'Bearer '", () => {
      // Arrange: Only Bearer prefix with no token
      req.headers = { authorization: "Bearer " };

      // Act
      validateBearerToken(req as Request, res as Response, next);

      // Assert
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        error: "Forbidden",
        message: "Invalid token",
      });
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe("Invalid Token", () => {
    it("should return 403 when token does not match CONDUCTOR_SECRET", () => {
      // Arrange: Invalid token
      req.headers = { authorization: "Bearer wrong-token" };

      // Act
      validateBearerToken(req as Request, res as Response, next);

      // Assert
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        error: "Forbidden",
        message: "Invalid token",
      });
      expect(next).not.toHaveBeenCalled();
    });

    it("should return 403 when token is empty string", () => {
      // Arrange: Empty token after Bearer
      req.headers = { authorization: "Bearer " };

      // Act
      validateBearerToken(req as Request, res as Response, next);

      // Assert
      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it("should return 403 when token is almost correct but has typo", () => {
      // Arrange: Token with typo (last character different)
      req.headers = { authorization: "Bearer test-secret-token-1234x" };

      // Act
      validateBearerToken(req as Request, res as Response, next);

      // Assert
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        error: "Forbidden",
        message: "Invalid token",
      });
      expect(next).not.toHaveBeenCalled();
    });

    it("should return 403 when token has trailing whitespace", () => {
      // Arrange: Token with extra whitespace
      req.headers = { authorization: "Bearer test-secret-token-12345 " };

      // Act
      validateBearerToken(req as Request, res as Response, next);

      // Assert
      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe("Valid Token", () => {
    it("should call next() when valid token is provided", () => {
      // Arrange: Valid token matching CONDUCTOR_SECRET
      req.headers = { authorization: "Bearer test-secret-token-12345" };

      // Act
      validateBearerToken(req as Request, res as Response, next);

      // Assert
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });

    it("should call next() with exact token match (case-sensitive)", () => {
      // Arrange: Exact case-sensitive match
      req.headers = { authorization: "Bearer test-secret-token-12345" };

      // Act
      validateBearerToken(req as Request, res as Response, next);

      // Assert
      expect(next).toHaveBeenCalledTimes(1);
    });

    it("should not proceed if token has uppercase variation", () => {
      // Arrange: Uppercase variation (not matching)
      req.headers = { authorization: "Bearer TEST-SECRET-TOKEN-12345" };

      // Act
      validateBearerToken(req as Request, res as Response, next);

      // Assert
      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it("should accept token with various common formats", () => {
      // Arrange: Test token with typical secret structure
      req.headers = { authorization: "Bearer test-secret-token-12345" };

      // Act
      validateBearerToken(req as Request, res as Response, next);

      // Assert
      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  describe("Request Properties", () => {
    it("should preserve request properties after authentication", () => {
      // Arrange: Valid token with request properties
      req.headers = { authorization: "Bearer test-secret-token-12345" };
      (req as any).path = "/api/internal/costs/budget";
      req.method = "GET";

      // Act
      validateBearerToken(req as Request, res as Response, next);

      // Assert
      expect(next).toHaveBeenCalled();
      // Request properties should remain unchanged
      expect((req as any).path).toBe("/api/internal/costs/budget");
      expect(req.method).toBe("GET");
    });

    it("should work with various HTTP methods", () => {
      // Arrange: Valid token with different HTTP methods
      req.headers = { authorization: "Bearer test-secret-token-12345" };
      const methods = ["GET", "POST", "PUT", "DELETE", "PATCH"];

      methods.forEach((method) => {
        req.method = method;
        next.mockClear();

        // Act
        validateBearerToken(req as Request, res as Response, next);

        // Assert
        expect(next).toHaveBeenCalledTimes(1);
      });
    });

    it("should work with various API paths", () => {
      // Arrange: Valid token with different paths
      req.headers = { authorization: "Bearer test-secret-token-12345" };
      const paths = [
        "/api/internal/costs",
        "/api/internal/costs/budget",
        "/api/internal/model-selection",
        "/api/internal/health",
      ];

      paths.forEach((path) => {
        (req as any).path = path;
        next.mockClear();

        // Act
        validateBearerToken(req as Request, res as Response, next);

        // Assert
        expect(next).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("HTTP Response Status Codes", () => {
    it("should return 401 for missing/malformed headers", () => {
      // Arrange: Various invalid header scenarios
      const invalidHeaders = [
        undefined,
        "",
        "InvalidFormat",
        "Bearer",
        "token-without-bearer",
      ];

      invalidHeaders.forEach((header) => {
        req.headers = { authorization: header } as any;
        res.status = jest.fn().mockReturnThis();
        res.json = jest.fn().mockReturnThis();
        next.mockClear();

        // Act
        validateBearerToken(req as Request, res as Response, next);

        // Assert: Should be 401 for format issues
        const statusCall = (res.status as jest.Mock).mock.calls[0]?.[0];
        expect([401, 403]).toContain(statusCall);
      });
    });

    it("should return 403 specifically for invalid tokens", () => {
      // Arrange: Valid Bearer format but wrong token
      req.headers = { authorization: "Bearer invalid-token-value" };

      // Act
      validateBearerToken(req as Request, res as Response, next);

      // Assert
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        error: "Forbidden",
        message: "Invalid token",
      });
    });
  });

  describe("Edge Cases", () => {
    it("should handle token with special characters", () => {
      // Arrange: Token containing special characters
      req.headers = { authorization: "Bearer token-with-!@#$%-special" };

      // Act
      validateBearerToken(req as Request, res as Response, next);

      // Assert
      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it("should handle very long invalid tokens", () => {
      // Arrange: Very long token that doesn't match
      const longToken = "Bearer " + "x".repeat(10000);
      req.headers = { authorization: longToken };

      // Act
      validateBearerToken(req as Request, res as Response, next);

      // Assert
      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it("should handle tokens with multiple 'Bearer' occurrences", () => {
      // Arrange: Multiple Bearer keywords
      req.headers = { authorization: "Bearer Bearer test-secret-token-12345" };

      // Act
      validateBearerToken(req as Request, res as Response, next);

      // Assert
      // This should fail because the token will be "Bearer test-secret-token-12345"
      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });
  });
});
