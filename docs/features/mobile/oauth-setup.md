# OAuth2 Configuration Guide

This guide explains how to configure OAuth2 authentication for the CueMarshal mobile app.

## Prerequisites

1. A running Gitea instance
2. Admin access to Gitea
3. The mobile app repository cloned

## Step 1: Register OAuth2 Application in Gitea

1. Log in to Gitea as an administrator
2. Navigate to: **Settings** → **Applications** → **Manage OAuth2 Applications**
3. Click **Create a new OAuth2 Application**
4. Fill in the following details:
   - **Application Name**: `CueMarshal Mobile App`
   - **Redirect URI**: `cuemarshal://oauth`
   - **Confidential Client**: No (public client for mobile apps)
5. Click **Create Application**
6. Save the generated **Client ID** (no secret needed for PKCE public clients)

## Step 2: Configure the Mobile App

### Option A: Using app.json (for development)

Edit `mobile/app.json` and update the `extra` section:

```json
{
  "expo": {
    "extra": {
      "giteaUrl": "http://your-gitea-url:3000",
      "conductorUrl": "http://your-conductor-url:4000",
      "oauth2ClientId": "YOUR_CLIENT_ID_HERE",
      "oauth2RedirectUri": "cuemarshal://oauth"
    }
  }
}
```

### Option B: Production configuration

For production builds, the app reads its OAuth configuration from the Expo `extra` field via `Constants.expoConfig.extra`. It does **not** currently read from environment variables.

To configure production:

- Ensure your production build uses an Expo app config (`app.json` or `app.config.*`) that defines the `extra` values: `giteaUrl`, `conductorUrl`, `oauth2ClientId`, and `oauth2RedirectUri`.
- If you use environment variables in your build system (e.g., with EAS), map them into the `extra` section of your Expo app config so that `Constants.expoConfig.extra` contains the correct values at runtime.
- **Note**: The mobile app uses PKCE (public client) and does not require or use a client secret.

The important point is that `mobile/config/index.ts` reads only from `Constants.expoConfig.extra`, so all URLs and the client ID must be available there.

## Step 3: Configure URL Scheme

The app uses a custom URL scheme (`cuemarshal://`) to handle OAuth redirects. This is already configured in `app.json`:

**Note**: Custom URL schemes like `cuemarshal://oauth` do not work in Expo Go. You must use a development build or standalone build to test OAuth authentication.

```json
{
  "expo": {
    "scheme": "cuemarshal"
  }
}
```

### For iOS

If building a standalone app, the scheme is automatically registered.

### For Android

The scheme is automatically registered through the Expo config plugin.

## Step 4: Test OAuth Flow

1. Start the development server:
   ```bash
   cd mobile
   npm start
   ```

2. Open the app on your device or simulator

3. On the login screen, tap **Sign in with Gitea**

4. You'll be redirected to Gitea in a browser

5. Log in with your Gitea credentials

6. Authorize the application

7. You'll be redirected back to the app

8. The app will fetch your user information and log you in

## OAuth Flow Details

### Authorization Code Flow with PKCE

The app uses the OAuth 2.0 Authorization Code flow with PKCE (Proof Key for Code Exchange) for enhanced security:

1. **Generate Code Verifier**: Random string
2. **Generate Code Challenge**: SHA256 hash of verifier
3. **Authorization Request**: Redirect to Gitea with challenge
4. **User Authorization**: User logs in and authorizes
5. **Authorization Code**: Gitea redirects back with code
6. **Token Exchange**: Exchange code for access token using verifier
7. **Fetch User Info**: Get user details from Gitea API
8. **Store Securely**: Save token in Expo SecureStore

### Security Features

- **PKCE**: Prevents authorization code interception
- **Secure Storage**: Tokens stored in platform-specific secure storage
- **Token Validation**: Tokens validated on app startup
- **Auto Logout**: Invalid tokens automatically cleared

## API Endpoints Used

| Endpoint | Purpose |
|----------|---------|
| `GET /login/oauth/authorize` | Start authorization |
| `POST /login/oauth/access_token` | Exchange code for token |
| `GET /api/v1/user` | Fetch user information |

## Scopes Requested

The app requests the following OAuth2 scopes:

- `read:user` - Read user profile information
- `read:repository` - Read repository data
- `write:repository` - Create and modify repositories
- `read:issue` - Read issues
- `write:issue` - Create and modify issues

## Troubleshooting

### "Configuration Error" on Login

**Problem**: OAuth2 credentials not configured

**Solution**: Ensure `app.json` has valid `oauth2ClientId` and other configuration

### "Authentication Failed" Error

**Problem**: Invalid OAuth2 credentials or network issue

**Solution**: 
1. Verify Client ID and Secret are correct
2. Check Gitea URL is accessible from the device
3. Ensure redirect URI matches exactly: `cuemarshal://oauth`

### Redirect Not Working

**Problem**: App doesn't open after Gitea authorization

**Solution**:
1. Verify URL scheme is registered in `app.json`
2. Rebuild the app after changing scheme configuration
3. Check redirect URI in Gitea matches `cuemarshal://oauth`

### Token Invalid After Restart

**Problem**: User logged out after app restart

**Solution**: This is normal if the token expired. Gitea access tokens may have an expiration time.

## Development vs Production

### Development

- Use `app.json` configuration for quick testing
- Use localhost URLs if running Gitea locally
- For iOS simulator, use `http://localhost:3000`
- For Android emulator, use `http://10.0.2.2:3000`

### Production

- Use environment variables for sensitive data
- Use HTTPS URLs for Gitea and Conductor
- Register separate OAuth2 application for production
- Configure proper domain for redirect URI

## Additional Resources

- [Gitea OAuth2 Documentation](https://docs.gitea.io/en-us/oauth2-provider/)
- [Expo AuthSession Guide](https://docs.expo.dev/guides/authentication/)
- [OAuth 2.0 PKCE RFC](https://tools.ietf.org/html/rfc7636)
