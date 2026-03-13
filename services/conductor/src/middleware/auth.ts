/**
 * Authentication Middleware
 * Validates Bearer tokens from Authorization header against CONDUCTOR_SECRET
 * Used for protecting internal API endpoints
 */

import { Request, Response, NextFunction } from "express";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";


/**
 * Validates Bearer token from Authorization header
 * Returns 401 if token is missing or malformed
 * Returns 403 if token is invalid
 * Calls next() on valid token
 */
export const validateBearerToken = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const authHeader = req.headers.authorization;

  // Check if Authorization header exists and starts with "Bearer "
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    logger.warn(
      { path: req.path, method: req.method },
      "Missing or invalid Authorization header"
    );
    res.status(401).json({ error: "Unauthorized", message: "Missing or invalid Authorization header" });
    return;
  }

  // Extract token (everything after "Bearer ")
  const token = authHeader.substring(7);

  // Validate token against CONDUCTOR_SECRET
  if (token !== config.conductorSecret) {
    logger.warn(
      { path: req.path, method: req.method },
      "Bearer token validation failed"
    );
    res.status(403).json({ error: "Forbidden", message: "Invalid token" });
    return;
  }

  // Token is valid, proceed to next middleware/route handler
  logger.debug({ path: req.path, method: req.method }, "Bearer token validated");
  next();
};

/**
 * Validates Bearer token for mobile clients.
 * Accepts either the Conductor shared secret or a valid Gitea OAuth token.
 */
export const validateMobileToken = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    logger.warn(
      { path: req.path, method: req.method },
      "Missing or invalid Authorization header"
    );
    res.status(401).json({ error: "Unauthorized", message: "Missing or invalid Authorization header" });
    return;
  }

  const token = authHeader.substring(7);

  if (token === config.conductorSecret) {
    (req as any).user = { id: "internal", username: "internal" };
    (req as any).authToken = token;
    next();
    return;
  }

  try {
    const response = await fetch(`${config.giteaUrl}/api/v1/user`, {
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      logger.warn(
        { path: req.path, method: req.method, status: response.status },
        "Gitea token validation failed"
      );
      res.status(403).json({ error: "Forbidden", message: "Invalid token" });
      return;
    }

    const user = (await response.json()) as {
      id?: number | string;
      login?: string;
      username?: string;
    };
    (req as any).user = {
      id: String(user.id ?? user.login ?? "unknown"),
      username: user.login || user.username || "unknown",
    };
    (req as any).authToken = token;
    next();
  } catch (error) {
    logger.error({ error }, "Failed to validate Gitea token");
    res.status(503).json({ error: "Unavailable", message: "Auth service unavailable" });
  }
};

/**
 * Alias for validateBearerToken for consistency with existing internal.ts
 * Both names can be used interchangeably
 */
export const validateInternalAuth = validateBearerToken;
