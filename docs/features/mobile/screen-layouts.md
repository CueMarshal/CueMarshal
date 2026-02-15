# Screen UI Layouts

This document provides a visual representation of each screen's UI layout.

## Login Screen

```
┌─────────────────────────────────────────┐
│                                         │
│                                         │
│         Welcome to CueMarshal                 │
│    Sign in with your Gitea account      │
│                                         │
│                                         │
│  ┌─────────────────────────────────┐   │
│  │   🔑 Sign in with Gitea         │   │
│  └─────────────────────────────────┘   │
│                                         │
│  You will be redirected to Gitea to     │
│  authenticate                           │
│                                         │
│  ⚠️ OAuth2 configuration warning        │
│  (shown only if not configured)         │
│                                         │
└─────────────────────────────────────────┘
```

**Features:**
- Centered layout
- OAuth "Sign in with Gitea" button
- Loading state during authentication
- Configuration validation
- User-friendly error alerts
- Auto-redirect after successful OAuth login

---

## Chat Screen (Primary Interface)

```
┌─────────────────────────────────────────┐
│ ← Chat                              ⋮   │
├─────────────────────────────────────────┤
│                                         │
│  ┌──────────────────────────────┐       │
│  │ Hello! How can I help?       │       │
│  └──────────────────────────────┘       │
│                                         │
│       ┌──────────────────────────────┐  │
│       │ Create a new project         │  │
│       └──────────────────────────────┘  │
│                                         │
│  ┌──────────────────────────────┐       │
│  │ I've created a new project   │       │
│  │ for you...                   │       │
│  └──────────────────────────────┘       │
│                                         │
│  [Loading indicator when active]       │
│                                         │
├─────────────────────────────────────────┤
│ ┌─────────────────────────────┐  [📤]  │
│ │ Type a message...           │        │
│ └─────────────────────────────┘        │
└─────────────────────────────────────────┘
```

**Features:**
- ScrollView with message history
- User messages (right, primary color)
- Assistant messages (left, surface color)
- Text input with send button
- Loading indicator
- Empty state for new conversations
- Keyboard-aware layout

---

## Dashboard Screen

```
┌─────────────────────────────────────────┐
│ ← Dashboard                         ⋮   │
├─────────────────────────────────────────┤
│ ┌─────────────────────────────────────┐ │
│ │ System Health                       │ │
│ │                                     │ │
│ │ 🟢 Conductor                        │ │
│ │ 🟢 Gateway                          │ │
│ │ 🟢 Gitea                            │ │
│ │ 🟢 Redis                            │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ ┌─────────────────────────────────────┐ │
│ │ LLM Costs (This Month)              │ │
│ │                                     │ │
│ │ Total: $12.50                       │ │
│ │ Claude Sonnet: $8.20                │ │
│ │ Claude Haiku: $2.80                 │ │
│ │ GPT-4: $1.50                        │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ ┌─────────────────────────────────────┐ │
│ │ Task Overview                       │ │
│ │                                     │ │
│ │    24           18                  │ │
│ │  Total      Completed               │ │
│ │                                     │ │
│ │     4           2                   │ │
│ │ In Progress  Pending                │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ ┌─────────────────────────────────────┐ │
│ │ Recent Activity                     │ │
│ │                                     │ │
│ │ • PR #42 merged: feat(auth)...      │ │
│ │ • Task #38 completed: Write API...  │ │
│ │ • Issue #41 created: Add pass...    │ │
│ │ • PR #40 opened: fix(ui)...         │ │
│ └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

**Features:**
- Card-based layout
- System health indicators (color-coded)
- LLM cost tracking with breakdown
- Task statistics with color coding
- Recent activity feed
- ScrollView for all content

---

## Profile Screen

```
┌─────────────────────────────────────────┐
│ ← Profile                           ⋮   │
├─────────────────────────────────────────┤
│                                         │
│              ┌─────┐                    │
│              │ US  │                    │
│              └─────┘                    │
│                                         │
│              User                       │
│         user@example.com                │
│                                         │
│ ───────────────────────────────────     │
│  Settings                               │
│                                         │
│  Notifications              [Toggle]    │
│  Enable push notifications              │
│                                         │
│  Dark Mode                  [Toggle]    │
│  Use dark theme                         │
│                                         │
│ ─────────────────────────────────────   │
│                                         │
│  👤 Account                          >  │
│  Manage your account settings           │
│                                         │
│  🛡️ Privacy                          >  │
│  Privacy and security settings          │
│                                         │
│  ℹ️ About                            >  │
│  App version and information            │
│                                         │
│ ───────────────────────────────────     │
│                                         │
│  ┌─────────────────────────────────┐   │
│  │      🚪 Sign Out                │   │
│  └─────────────────────────────────┘   │
│                                         │
└─────────────────────────────────────────┘
```

**Features:**
- User avatar with initials
- User information display
- Toggle switches for settings
- List items for navigation
- Sign out button (error color border)
- ScrollView for all content

---

## Bottom Tab Navigation

```
┌─────────────────────────────────────────┐
│                                         │
│         [Current Screen Content]        │
│                                         │
│                                         │
├─────────────────────────────────────────┤
│   💬        📊        👤                │
│  Chat   Dashboard  Profile              │
└─────────────────────────────────────────┘
```

**Features:**
- 3 persistent tabs
- Material icons
- Active tab highlighted (primary color)
- Inactive tabs (muted color)
- Navigation state persists

---

## Navigation Flow

```
App Launch
    ↓
Check Authentication
    ↓
    ├─→ Not Authenticated → Login Screen
    │                           ↓
    │              Tap "Sign in with Gitea"
    │                           ↓
    │              Redirect to Gitea (OAuth)
    │                           ↓
    │                 User Authorizes App
    │                           ↓
    │           Redirect Back with Auth Code
    │                           ↓
    │          Exchange Code for Access Token
    │                           ↓
    └─→ Authenticated ──────────┴──→ Main App (Tabs)
                                         ↓
                                  ┌──────┴──────┐
                                  │             │
                              Chat Tab    Dashboard Tab
                                              │
                                         Profile Tab
                                              ↓
                                         Sign Out
                                              ↓
                                       Login Screen
```

---

## Design Highlights

### Color Usage
- **Primary Color**: Action buttons, active states, user messages
- **Surface Colors**: Backgrounds, cards
- **Error Color**: Destructive actions (logout)
- **Semantic Colors**: Success (green), Info (blue), Warning (orange)

### Typography
- **Display**: Screen titles
- **Headline**: Section headers
- **Title**: Card titles
- **Body**: Main content
- **Label**: Button text, small labels

### Spacing
- **xs (4px)**: Between related small items
- **sm (8px)**: Between form elements
- **md (16px)**: Between cards, sections
- **lg (24px)**: Screen padding
- **xl (32px)**: Large section gaps
- **xxl (48px)**: Hero spacing

All screens are fully responsive and support both light and dark modes automatically!
