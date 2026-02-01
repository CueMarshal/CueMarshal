/**
 * Tests for API route registration
 */

import { registerRoutes } from "../../api/routes.js";

// Mock all route modules
jest.mock("../../api/webhooks.js", () => ({
  __esModule: true,
  default: jest.fn(),
}));
jest.mock("../../api/chat.js", () => ({
  __esModule: true,
  default: jest.fn(),
}));
jest.mock("../../api/mobile.js", () => ({
  __esModule: true,
  default: jest.fn(),
}));
jest.mock("../../api/internal.js", () => ({
  __esModule: true,
  default: jest.fn(),
}));

describe("registerRoutes", () => {
  let mockApp: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockApp = {
      use: jest.fn(),
      get: jest.fn(),
    };
  });

  describe("Route registration", () => {
    it("should register webhooks router at /webhooks", () => {
      // Act
      registerRoutes(mockApp);

      // Assert
      const webhooksCall = mockApp.use.mock.calls.find(
        (call: any[]) => call[0] === "/webhooks"
      );
      expect(webhooksCall).toBeDefined();
    });

    it("should register chat router at /api/chat", () => {
      // Act
      registerRoutes(mockApp);

      // Assert
      const chatCall = mockApp.use.mock.calls.find(
        (call: any[]) => call[0] === "/api/chat"
      );
      expect(chatCall).toBeDefined();
    });

    it("should register mobile router at /api", () => {
      // Act
      registerRoutes(mockApp);

      // Assert
      const mobileCall = mockApp.use.mock.calls.find(
        (call: any[]) => call[0] === "/api"
      );
      expect(mobileCall).toBeDefined();
    });

    it("should register internal router at /api/internal", () => {
      // Act
      registerRoutes(mockApp);

      // Assert
      const internalCall = mockApp.use.mock.calls.find(
        (call: any[]) => call[0] === "/api/internal"
      );
      expect(internalCall).toBeDefined();
    });
  });

  describe("Hello endpoint", () => {
    it("should register GET /hello", () => {
      // Act
      registerRoutes(mockApp);

      // Assert
      const helloCall = mockApp.get.mock.calls.find(
        (call: any[]) => call[0] === "/hello"
      );
      expect(helloCall).toBeDefined();
    });

    it("should return a greeting with timestamp", () => {
      // Arrange
      registerRoutes(mockApp);
      const helloCall = mockApp.get.mock.calls.find(
        (call: any[]) => call[0] === "/hello"
      );
      const handler = helloCall[1];
      const mockRes = {
        json: jest.fn(),
      };

      // Act
      handler({}, mockRes);

      // Assert
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Hello from CueMarshal!",
          timestamp: expect.any(String),
        })
      );
    });
  });

  describe("Health endpoint", () => {
    it("should register GET /health", () => {
      // Act
      registerRoutes(mockApp);

      // Assert
      const healthCall = mockApp.get.mock.calls.find(
        (call: any[]) => call[0] === "/health"
      );
      expect(healthCall).toBeDefined();
    });

    it("should return healthy status with version and uptime", () => {
      // Arrange
      registerRoutes(mockApp);
      const healthCall = mockApp.get.mock.calls.find(
        (call: any[]) => call[0] === "/health"
      );
      const handler = healthCall[1];
      const mockRes = {
        json: jest.fn(),
      };

      // Act
      handler({}, mockRes);

      // Assert
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "healthy",
          version: "1.0.0",
          uptime: expect.any(Number),
        })
      );
    });
  });
});
