/**
 * Cryptographic utilities for webhook verification
 */

import * as crypto from "crypto";

/**
 * Verify Gitea webhook HMAC signature
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  if (!signature) {
    return false;
  }

  // Gitea sends raw hex HMAC in x-gitea-signature (no prefix)
  // Also handle "sha256=" prefix for compatibility
  const expectedSignature = signature.startsWith("sha256=")
    ? signature.substring(7)
    : signature;

  const computedSignature = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");

  // Use timing-safe comparison
  try {
    return crypto.timingSafeEqual(
      Buffer.from(computedSignature, "hex"),
      Buffer.from(expectedSignature, "hex")
    );
  } catch {
    return false;
  }
}
