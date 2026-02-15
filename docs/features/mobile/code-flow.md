# Mobile App Code Flow

This document explains how the different parts of the mobile app connect and work together.

## Authentication Flow

```
User Opens App
    ↓
app/_layout.tsx (Root Layout)
    ├─→ Initialize Auth (check SecureStore for saved token)
    │   ↓
    │   Validate token with Gitea
    │   ↓
    ├─→ Check: Is user authenticated? (useAuthStore)
    │   
    ├─→ NO: Redirect to app/auth/login.tsx
    │       ↓
    │       User clicks "Sign in with Gitea"
    │       ↓
    │       useAuthStore.startOAuthFlow()
    │       ↓
    │       Browser opens to Gitea OAuth page
    │       ↓
    │       User authenticates in Gitea
    │       ↓
    │       Gitea redirects: cuemarshal://oauth?code=...
    │       ↓
    │       App exchanges code for token (PKCE)
    │       ↓
    │       Fetch user info from Gitea
    │       ↓
    │       Store in SecureStore
    │       ↓
    │       Auth guard detects token
    │       ↓
    │       Redirect to app/tabs/chat.tsx
    │
    └─→ YES: Allow access to app/tabs/*
            ↓
            Show Bottom Tab Navigator
            ├─→ Chat Tab (default)
            ├─→ Dashboard Tab
            └─→ Profile Tab
```

## Chat Flow

```
Chat Screen (app/tabs/chat.tsx)
    ↓
User types message in TextInput
    ↓
User clicks Send IconButton
    ↓
handleSend() called
    ↓
useChatStore.sendMessage(message)
    ↓
stores/chat.ts
    ├─→ Add user message to messages array
    ├─→ Set isLoading = true
    ├─→ Call API (currently mocked)
    ├─→ Add assistant response to messages array
    └─→ Set isLoading = false
    ↓
Chat Screen re-renders
    ↓
FlatList displays messages
    ↓
Each message rendered as ChatBubble component
    ├─→ User messages: right-aligned, primary color
    └─→ Assistant messages: left-aligned, surface variant
```

## Theme System

```
User's Device
    ↓
Operating System Theme (Light/Dark)
    ↓
React Native useColorScheme() hook
    ↓
hooks/useTheme.ts
    ├─→ Detects color scheme
    └─→ Returns appropriate theme
        ├─→ Light Mode: theme/index.ts → lightTheme
        └─→ Dark Mode: theme/index.ts → darkTheme
    ↓
app/_layout.tsx
    ↓
<PaperProvider theme={theme}>
    ↓
All child components receive theme
    ↓
Components use theme colors automatically
```

## Navigation Structure

```
app/_layout.tsx (Root)
├── PaperProvider (Material Design 3)
└── Stack Navigator
    ├── app/auth/* (Auth Group)
    │   └── app/auth/login.tsx
    │
    └── app/tabs/* (Main App Group)
        └── Bottom Tab Navigator (app/tabs/_layout.tsx)
            ├── Tab 1: app/tabs/chat.tsx
            │   └── Icon: "chat"
            ├── Tab 2: app/tabs/dashboard.tsx
            │   └── Icon: "view-dashboard"
            └── Tab 3: app/tabs/profile.tsx
                └── Icon: "account"
```

## Component Hierarchy

```
app/_layout.tsx
└── PaperProvider (theme)
    └── Stack
        └── Tabs (_layout.tsx)
            └── Individual Tab Screen (e.g., chat.tsx)
                ├── KeyboardAvoidingView
                ├── View (messagesContainer)
                │   ├── FlatList
                │   │   └── ChatBubble (multiple)
                │   │       └── Card
                │   │           └── Text
                │   └── ActivityIndicator (when loading)
                └── View (inputContainer)
                    ├── TextInput
                    └── IconButton (send)
```

## State Management Flow

### Auth Store

```
stores/auth.ts (Zustand)
    ↓
State: { token, user }
    ↓
Actions:
├─→ login(token, user)
│   └── Updates state
│       └── Triggers re-render in app/_layout.tsx
│           └── Auth guard redirects to main app
│
└─→ logout()
    └── Clears state
        └── Triggers re-render in app/_layout.tsx
            └── Auth guard redirects to login
```

### Chat Store

```
stores/chat.ts (Zustand)
    ↓
State: { messages[], isLoading }
    ↓
Actions:
├─→ sendMessage(msg)
│   ├── Add user message
│   ├── Set loading = true
│   ├── API call (mocked)
│   ├── Add assistant message
│   └── Set loading = false
│
└─→ clearMessages()
    └── Reset messages to []
```

## Data Flow Example: Sending a Message

```
1. User Action
   └── Types "Hello" in TextInput
       └── Presses Send button

2. Component Handler
   └── handleSend() in chat.tsx
       └── Calls useChatStore.sendMessage("Hello")

3. Store Update
   └── stores/chat.ts
       ├── messages.push({ role: 'user', content: 'Hello', timestamp: ... })
       ├── isLoading = true
       ├── Simulate API call (1 second delay)
       ├── messages.push({ role: 'assistant', content: '...', timestamp: ... })
       └── isLoading = false

4. Component Re-render
   └── chat.tsx re-renders
       ├── FlatList gets new messages array
       └── Renders two new ChatBubble components
           ├── User message (right, primary color)
           └── Assistant message (left, surface color)

5. UI Update
   └── User sees conversation on screen
```

## Styling System

```
Individual Screen/Component
    ↓
StyleSheet.create({ ... })
    ├── Uses spacing from theme/index.ts
    │   └── spacing.md, spacing.lg, etc.
    ├── Uses colors from useTheme()
    │   └── theme.colors.primary, etc.
    └── Component-specific styles
        └── Applied to View, Text, etc.
```

## Type Safety

```
TypeScript Interfaces
    ↓
stores/auth.ts
├── interface AuthState
└── create<AuthState>(...)

stores/chat.ts
├── interface Message
├── interface ChatState
└── create<ChatState>(...)

components/ChatBubble.tsx
├── interface Message
├── interface ChatBubbleProps
└── function ChatBubble({ message }: ChatBubbleProps)
```

## Key Integration Points

1. **Auth Guard** → Monitors `useAuthStore` and controls navigation
2. **Theme Provider** → Wraps entire app, provides theme to all components
3. **Bottom Tabs** → Persistent navigation between 3 main screens
4. **Chat Store** → Manages message state, ready for API integration
5. **Material Design** → react-native-paper provides consistent UI components
