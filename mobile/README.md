# CueMarshal Mobile App

React Native Expo application for the CueMarshal platform.

## Features

- 🎨 **Material Design 3** UI with react-native-paper
- 🌓 **Dark/Light Mode** support with automatic detection
- 🧭 **File-based routing** using Expo Router
- 🔐 **OAuth2 Authentication** with Gitea (PKCE flow)
- 💬 **Chat interface** for natural language interactions
- 📊 **Dashboard** with system metrics and status
- 👤 **Profile & Settings** management
- 🔒 **Secure token storage** with Expo SecureStore

## Quick Start

### Prerequisites

- Node.js 18+
- Expo CLI
- iOS Simulator (Mac) or Android Emulator
- Running Gitea instance with OAuth2 configured

### Installation

```bash
cd mobile
npm install
```

### Configuration

**Important**: You must configure OAuth2 before running the app. See [OAUTH_SETUP.md](OAUTH_SETUP.md) for detailed instructions.

Quick config in `app.json`:

```json
{
  "expo": {
    "extra": {
      "giteaUrl": "http://your-gitea-url:3000",
      "conductorUrl": "http://your-conductor-url:4000",
      "oauth2ClientId": "YOUR_CLIENT_ID",
      "oauth2RedirectUri": "cuemarshal://oauth"
    }
  }
}
```

### Run the App

```bash
npm start
```

**Note**: OAuth authentication with custom URL schemes (`cuemarshal://oauth`) requires a development build or standalone build. It will not work in Expo Go. To test OAuth:

- Build a development client: `npx expo run:ios` or `npx expo run:android`
- Or use EAS Build for a development build
- Or test with a standalone production build

For Expo Go testing, you would need to modify the OAuth redirect to use `AuthSession.makeRedirectUri()` with proxy support.

## Authentication

The app uses **OAuth2 Authorization Code flow with PKCE** for secure authentication:

1. User taps "Sign in with Gitea"
2. Browser opens to Gitea authorization page
3. User authenticates with Gitea credentials
4. Gitea redirects back to app with authorization code
5. App exchanges code for access token
6. Token stored securely in platform keychain
7. User profile fetched and displayed

For complete setup instructions, see [OAUTH_SETUP.md](OAUTH_SETUP.md).

## Project Structure

```
mobile/
├── app/                    # Expo Router screens
│   ├── _layout.tsx         # Root layout with auth guard
│   ├── index.tsx           # Entry point
│   ├── auth/               # Authentication screens
│   │   ├── _layout.tsx
│   │   └── login.tsx
│   └── tabs/               # Main app tabs
│       ├── _layout.tsx     # Bottom tab navigator
│       ├── chat.tsx        # Chat interface (primary screen)
│       ├── dashboard.tsx   # System status & metrics
│       └── profile.tsx     # User profile & settings
├── components/             # Reusable UI components
│   ├── ChatBubble.tsx
│   ├── CostBadge.tsx
│   └── StatusIndicator.tsx
├── stores/                 # Zustand state management
│   ├── auth.ts
│   └── chat.ts
├── theme/                  # Design system
│   └── index.ts           # Colors, typography, spacing
└── hooks/                  # Custom hooks
    └── useTheme.ts        # Theme hook for dark/light mode

```

## Setup

```bash
cd mobile
npm install
npm start
```

Then:
- Press `i` for iOS simulator
- Press `a` for Android emulator
- Scan QR code with Expo Go app on your device

## Navigation Structure

The app uses a **bottom tab navigator** with 3 main tabs:

1. **Chat** - Primary interface for natural language interactions
2. **Dashboard** - System health, metrics, and activity feed
3. **Profile** - User settings and account management

Authentication is handled via an **auth guard** in the root layout that automatically redirects unauthenticated users to the login screen.

## Design System

### Colors
- Full Material Design 3 color palette
- Separate themes for light and dark modes
- Automatic theme detection based on system preferences

### Typography
- Material Design 3 typography scale
- Standardized font sizes and weights

### Spacing
- Consistent spacing values: xs (4), sm (8), md (16), lg (24), xl (32), xxl (48)

## State Management

Uses **Zustand** for lightweight, hook-based state management:

- `useAuthStore` - Authentication state (token, user, login/logout)
- `useChatStore` - Chat messages and send functionality

## Development

```bash
# Type checking
npx tsc --noEmit

# Start development server
npm start

# Build for production
npx expo build:ios
npx expo build:android
```

See full documentation in [../docs/features/mobile/overview.md](../docs/features/mobile/overview.md)
