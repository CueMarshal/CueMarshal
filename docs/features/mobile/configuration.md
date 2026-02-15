# Mobile App Configuration Guide

## Single Base URL Design

The mobile app now uses **one base URL** instead of separate Gitea and Conductor URLs. This simplifies configuration and deployment.

### Architecture

```
Mobile App → http://localhost:8180 (nginx)
                ├─ /api/* → conductor:4000/api/*
                └─ /*     → gitea:3000/*
```

All requests flow through nginx, which proxies to the appropriate backend service.

---

## Platform-Specific Defaults

### iOS & Web
```
Base URL: http://localhost:8180
```

### Android Emulator
```
Base URL: http://10.0.2.2:8180
```
Android emulators cannot use `localhost` - they require `10.0.2.2` which maps to the host machine's localhost.

### Production
```
Base URL: https://your-domain.com
```

---

## Configuration Methods

### Method 1: Build-Time Configuration (app.json)

Edit `mobile/app.json`:

```json
{
  "expo": {
    "extra": {
      "baseUrl": "http://10.0.2.2:8180",
      "oauth2ClientId": "your-client-id",
      "oauth2RedirectUri": "cuemarshal://oauth"
    }
  }
}
```

Then rebuild:

```bash
cd mobile
npx expo prebuild --clean
```

### Method 2: Runtime Configuration (Settings UI)

1. Launch the mobile app
2. Navigate to **Profile** tab
3. Tap **Server URL**
4. Enter your server URL:
   - Android emulator: `http://10.0.2.2:8180`
   - Physical device on same network: `http://192.168.x.x:8180`
   - Production: `https://your-domain.com`
5. Tap **Save**

The URL is stored in SecureStore and persists across app restarts.

---

## Testing Different Configurations

### Testing on Android Emulator

```bash
cd mobile
npm start

# In another terminal:
# Press 'a' to open in Android emulator

# In the app:
# 1. Go to Profile tab
# 2. Tap "Server URL"
# 3. Ensure it shows: http://10.0.2.2:8180
# 4. If not, update and save
```

### Testing on Physical Device

Find your host machine's IP:

```bash
# On Linux/Mac
ip addr show | grep inet

# On Windows (WSL)
ip route show | grep -i default | awk '{print $3}'
```

Then in the mobile app:
1. Profile → Server URL
2. Enter: `http://192.168.x.x:8180` (replace with your IP)
3. Save

### Testing on iOS Simulator

```bash
cd mobile
npm start

# In another terminal:
# Press 'i' to open in iOS simulator

# Server URL should auto-default to: http://localhost:8180
```

---

## URL Format Requirements

Valid formats:
- `http://localhost:8180` ✅
- `http://10.0.2.2:8180` ✅
- `http://192.168.1.100:8180` ✅
- `https://cuemarshal.example.com` ✅

Invalid formats:
- `localhost:8180` ❌ (missing protocol)
- `http://localhost:8180/` ❌ (trailing slash removed automatically)
- `http://gitea:3000` ❌ (Docker internal name, not accessible from mobile)

---

## How It Works

### URL Resolution

1. **App Launch:**
   - Check SecureStore for saved `base_url`
   - If found: use saved URL
   - If not found: use platform-appropriate default

2. **URL Derivation:**
   ```typescript
   baseUrl = "http://10.0.2.2:8180"
   giteaUrl = baseUrl                    // http://10.0.2.2:8180
   conductorUrl = baseUrl + "/api"        // http://10.0.2.2:8180/api
   ```

3. **API Requests:**
   - OAuth: `${giteaUrl}/login/oauth/authorize`
   - Chat: `${conductorUrl}/chat` → nginx → `conductor:4000/api/chat`
   - Projects: `${conductorUrl}/projects` → nginx → `conductor:4000/api/projects`

### Runtime Updates

When user changes URL in settings:
1. New URL saved to SecureStore
2. Global runtime config updated immediately
3. All subsequent API calls use new URL
4. No app restart required

---

## Troubleshooting

### "Cannot connect to server"

**Android Emulator:**
- Ensure URL is `http://10.0.2.2:8180` (not localhost)
- Verify docker services running: `docker ps`
- Check nginx is accessible from host: `curl http://localhost:8180/health`

**iOS Simulator:**
- Ensure URL is `http://localhost:8180`
- Verify port 8180 is not blocked by firewall

**Physical Device:**
- Ensure device is on same network as host machine
- Find host IP: `ip addr show | grep inet`
- Use host IP in URL: `http://192.168.1.x:8180`
- Ensure firewall allows port 8180

### "OAuth redirect fails"

Ensure the OAuth2 application in Gitea has the redirect URI:
```
cuemarshal://oauth
```

Configure in Gitea:
1. Go to Gitea settings → Applications
2. Create OAuth2 Application
3. Redirect URI: `cuemarshal://oauth`
4. Copy Client ID to app.json

### "Reset to Default not working"

Tap the "Reset to Default" button in the URL dialog. This will:
- Clear saved URL from SecureStore
- Restore platform-appropriate default
- Update immediately (no restart needed)

---

## Network Requirements

Mobile app requires access to:

| Service | Path | Port | Protocol |
|---------|------|------|----------|
| Nginx | / | 8180 | HTTP |
| Gitea (via nginx) | / | 8180 | HTTP |
| Conductor (via nginx) | /api/ | 8180 | HTTP |

**Firewall Rules:**
- Allow inbound TCP port 8180 from mobile device IP range
- For production: Use HTTPS (port 443) with valid SSL certificate

---

## Production Deployment

### 1. Configure Domain

Update `app.json` for production build:

```json
{
  "extra": {
    "baseUrl": "https://cuemarshal.yourdomain.com"
  }
}
```

### 2. SSL Certificate

Nginx should have valid SSL certificate for the domain. See `infrastructure/nginx/self-signed-cert.sh` for SSL setup.

### 3. OAuth2 Configuration

Update redirect URI in Gitea to match production domain:
```
cuemarshal://oauth  (keep this for app redirect)
```

### 4. Build Production App

```bash
cd mobile

# iOS
eas build --platform ios --profile production

# Android
eas build --platform android --profile production
```

---

## Migration from Old Config

If you have an existing deployment with separate `giteaUrl` and `conductorUrl` in `app.json`:

### Before
```json
{
  "extra": {
    "giteaUrl": "http://localhost:3000",
    "conductorUrl": "http://localhost:4000"
  }
}
```

### After
```json
{
  "extra": {
    "baseUrl": "http://localhost:8180"
  }
}
```

No data migration needed - the change is configuration only.

---

## Benefits

1. **Simplified Configuration**: One URL instead of two
2. **Platform Awareness**: Auto-detects iOS vs Android emulator requirements
3. **Runtime Flexibility**: Change URL without rebuilding app
4. **Production Ready**: Same URL scheme works for development and production
5. **CORS Handled**: Nginx manages CORS, no conductor code changes needed

---

## Support

For issues or questions:
1. Check nginx is running: `docker ps | grep nginx`
2. Check nginx logs: `docker logs cuemarshal-nginx`
3. Verify port mapping: `docker port cuemarshal-nginx`
4. Test API directly: `curl http://localhost:8180/api/health`
