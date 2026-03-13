/**
 * BFF (Backend For Frontend) Auth Router
 *
 * Provides server-side OAuth2 endpoints so that frontends (landing page,
 * mobile app) never need to know or fetch the OAuth2 client ID.  The
 * client ID is read from /tokens/oauth2_client_id (written by init-gitea)
 * and injected server-side into all Gitea OAuth interactions.
 *
 * Endpoints:
 *   GET  /api/auth/authorize  – build & return the Gitea authorization URL
 *   POST /api/auth/token      – exchange an authorization code for a token
 *   GET  /api/auth/user       – fetch user info from Gitea with a Bearer token
 */

import { Router, Request, Response } from "express";
import { readFile } from "fs/promises";
import { logger } from "../utils/logger.js";
import { config } from "../config.js";

const router = Router();

// ---------------------------------------------------------------------------
// Cached OAuth2 client ID (read from filesystem, rarely changes)
// ---------------------------------------------------------------------------
let _cachedClientId: string | null = null;

async function getOAuth2ClientId(): Promise<string | null> {
  if (_cachedClientId) return _cachedClientId;
  try {
    const raw = await readFile("/tokens/oauth2_client_id", "utf-8");
    _cachedClientId = raw.trim();
    return _cachedClientId;
  } catch {
    logger.warn("BFF auth: could not read /tokens/oauth2_client_id");
    return null;
  }
}

// ---------------------------------------------------------------------------
// GET /api/auth/authorize
//
// Query parameters:
//   redirect_uri   – where Gitea should redirect after consent
//   code_challenge  – PKCE S256 challenge (generated client-side)
//   state           – CSRF state token (generated client-side)
//   scopes          – space-separated scope list (optional, defaults below)
//
// Returns JSON:
//   { authorizeUrl: "https://..." }
// ---------------------------------------------------------------------------
router.get("/authorize", async (req: Request, res: Response) => {
  try {
    const clientId = await getOAuth2ClientId();
    if (!clientId) {
      res.status(503).json({
        error: "OAuth2 client ID is not available. Platform may still be initializing.",
      });
      return;
    }

    const {
      redirect_uri,
      code_challenge,
      state,
      scopes,
    } = req.query as Record<string, string | undefined>;

    if (!redirect_uri || !code_challenge || !state) {
      res.status(400).json({
        error: "Missing required query parameters: redirect_uri, code_challenge, state",
      });
      return;
    }

    const scopeString =
      scopes || "read:user read:repository write:repository read:issue write:issue";

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri,
      response_type: "code",
      scope: scopeString,
      state,
      code_challenge,
      code_challenge_method: "S256",
    });

    // Build the authorization URL using the external-facing host
    // (the browser cannot reach internal K8s service names).
    // nginx proxies /login/* to Gitea, so we use the request's origin.
    const proto = req.headers["x-forwarded-proto"] || req.protocol || "http";
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    const externalBase = `${proto}://${host}`;
    const authorizeUrl = `${externalBase}/login/oauth/authorize?${params.toString()}`;

    res.json({ authorizeUrl });
  } catch (error) {
    logger.error({ error }, "BFF auth: /authorize failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/token
//
// Body (JSON):
//   code           – authorization code from Gitea callback
//   code_verifier  – PKCE verifier (matches the challenge sent to /authorize)
//   redirect_uri   – must match the original redirect_uri
//
// Returns JSON:
//   { access_token: "..." }   on success
//   { error: "..." }          on failure
// ---------------------------------------------------------------------------
router.post("/token", async (req: Request, res: Response) => {
  try {
    const clientId = await getOAuth2ClientId();
    if (!clientId) {
      res.status(503).json({
        error: "OAuth2 client ID is not available. Platform may still be initializing.",
      });
      return;
    }

    const { code, code_verifier, redirect_uri } = req.body || {};

    if (!code || !code_verifier || !redirect_uri) {
      res.status(400).json({
        error: "Missing required body fields: code, code_verifier, redirect_uri",
      });
      return;
    }

    // Validate redirect_uri against known-good origins (defense-in-depth per RFC 6749 §10.6)
    const ALLOWED_REDIRECT_PREFIXES = [
      "cuemarshal://",     // React Native deep-link scheme
      "cuemarshal-dev://", // Expo Go dev scheme
    ];
    if (config.nodeEnv !== "development") {
      const isAllowed = ALLOWED_REDIRECT_PREFIXES.some((prefix) =>
        (redirect_uri as string).startsWith(prefix)
      );
      if (!isAllowed) {
        logger.warn({ redirect_uri }, "BFF auth: rejected disallowed redirect_uri");
        res.status(400).json({ error: "redirect_uri not allowed" });
        return;
      }
    }

    // Build form-encoded body for Gitea token endpoint
    const body = new URLSearchParams();
    body.append("client_id", clientId);
    body.append("code", code);
    body.append("code_verifier", code_verifier);
    body.append("grant_type", "authorization_code");
    body.append("redirect_uri", redirect_uri);

    const tokenRes = await fetch(
      `${config.giteaUrl}/login/oauth/access_token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      }
    );

    if (!tokenRes.ok) {
      const errorBody = await tokenRes.text();
      logger.error(
        { status: tokenRes.status, body: errorBody },
        "BFF auth: Gitea token exchange failed"
      );
      res.status(tokenRes.status).json({
        error: `Token exchange failed: ${tokenRes.status} ${tokenRes.statusText}`,
      });
      return;
    }

    const data = (await tokenRes.json()) as Record<string, unknown>;

    if (data.access_token) {
      res.json({ access_token: data.access_token });
    } else {
      res.status(502).json({ error: "No access token in Gitea response" });
    }
  } catch (error) {
    logger.error({ error }, "BFF auth: /token failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ---------------------------------------------------------------------------
// GET /api/auth/user
//
// Headers:
//   Authorization: Bearer <gitea_token>
//
// Returns JSON user object from Gitea
// ---------------------------------------------------------------------------
router.get("/user", async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res.status(401).json({ error: "Missing or invalid Authorization header" });
      return;
    }

    const token = authHeader.slice(7);

    const userRes = await fetch(`${config.giteaUrl}/api/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });

    if (!userRes.ok) {
      res.status(userRes.status).json({
        error: `Failed to fetch user info: ${userRes.status}`,
      });
      return;
    }

    const userData = (await userRes.json()) as Record<string, unknown>;

    res.json({
      id: userData.id,
      username: userData.login || userData.username,
      email: userData.email,
      full_name: userData.full_name || userData.login,
      avatar_url: userData.avatar_url,
    });
  } catch (error) {
    logger.error({ error }, "BFF auth: /user failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
