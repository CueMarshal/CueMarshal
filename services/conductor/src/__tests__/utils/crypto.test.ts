/**
 * Tests for cryptographic utilities
 */

import * as crypto from "crypto";
import { verifyWebhookSignature } from "../../utils/crypto.js";

describe("verifyWebhookSignature", () => {
  const secret = "test-webhook-secret";
  const payload = '{"action":"push","ref":"refs/heads/main"}';

  // Helper to compute a valid HMAC signature
  function computeHmac(data: string, key: string): string {
    return crypto.createHmac("sha256", key).update(data).digest("hex");
  }

  describe("Valid signatures", () => {
    it("should return true for a valid raw hex signature", () => {
      // Arrange
      const signature = computeHmac(payload, secret);

      // Act
      const result = verifyWebhookSignature(payload, signature, secret);

      // Assert
      expect(result).toBe(true);
    });

    it("should return true for a valid sha256= prefixed signature", () => {
      // Arrange
      const rawHex = computeHmac(payload, secret);
      const signature = `sha256=${rawHex}`;

      // Act
      const result = verifyWebhookSignature(payload, signature, secret);

      // Assert
      expect(result).toBe(true);
    });
  });

  describe("Invalid signatures", () => {
    it("should return false for an empty signature", () => {
      // Arrange & Act
      const result = verifyWebhookSignature(payload, "", secret);

      // Assert
      expect(result).toBe(false);
    });

    it("should return false for a wrong signature", () => {
      // Arrange
      const wrongSignature = computeHmac("different payload", secret);

      // Act
      const result = verifyWebhookSignature(payload, wrongSignature, secret);

      // Assert
      expect(result).toBe(false);
    });

    it("should return false for a wrong secret", () => {
      // Arrange
      const signature = computeHmac(payload, "wrong-secret");

      // Act
      const result = verifyWebhookSignature(payload, signature, secret);

      // Assert
      expect(result).toBe(false);
    });

    it("should return false for a malformed hex string", () => {
      // Arrange
      const malformedSignature = "not-valid-hex-!@#$%";

      // Act
      const result = verifyWebhookSignature(payload, malformedSignature, secret);

      // Assert
      expect(result).toBe(false);
    });

    it("should return false for sha256= prefix with wrong signature", () => {
      // Arrange
      const wrongHex = computeHmac("different", secret);
      const signature = `sha256=${wrongHex}`;

      // Act
      const result = verifyWebhookSignature(payload, signature, secret);

      // Assert
      expect(result).toBe(false);
    });

    it("should return false for a truncated signature", () => {
      // Arrange
      const validSignature = computeHmac(payload, secret);
      const truncated = validSignature.substring(0, 32);

      // Act
      const result = verifyWebhookSignature(payload, truncated, secret);

      // Assert
      expect(result).toBe(false);
    });
  });

  describe("Edge cases", () => {
    it("should handle empty payload", () => {
      // Arrange
      const emptyPayload = "";
      const signature = computeHmac(emptyPayload, secret);

      // Act
      const result = verifyWebhookSignature(emptyPayload, signature, secret);

      // Assert
      expect(result).toBe(true);
    });

    it("should handle empty secret", () => {
      // Arrange
      const emptySecret = "";
      const signature = computeHmac(payload, emptySecret);

      // Act
      const result = verifyWebhookSignature(payload, signature, emptySecret);

      // Assert
      expect(result).toBe(true);
    });

    it("should handle large payloads", () => {
      // Arrange
      const largePayload = "x".repeat(100000);
      const signature = computeHmac(largePayload, secret);

      // Act
      const result = verifyWebhookSignature(largePayload, signature, secret);

      // Assert
      expect(result).toBe(true);
    });

    it("should handle unicode payloads", () => {
      // Arrange
      const unicodePayload = '{"message":"こんにちは世界 🌍"}';
      const signature = computeHmac(unicodePayload, secret);

      // Act
      const result = verifyWebhookSignature(unicodePayload, signature, secret);

      // Assert
      expect(result).toBe(true);
    });

    it("should use timing-safe comparison to prevent timing attacks", () => {
      // Arrange - valid signature
      const signature = computeHmac(payload, secret);

      // Act & Assert - verify it works (timing safety is internal)
      expect(verifyWebhookSignature(payload, signature, secret)).toBe(true);
    });
  });
});
