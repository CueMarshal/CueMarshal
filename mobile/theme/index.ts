import { MD3LightTheme, MD3DarkTheme, MD3Theme } from 'react-native-paper';

// Color Palette - "Professional Indigo & Slate"
export const colors = {
  light: {
    primary: '#4338ca', // Deep Indigo
    primaryContainer: '#e0e7ff', // Very light Indigo wash
    secondary: '#0f172a', // Slate 900 for high contrast accents
    secondaryContainer: '#e2e8f0', // Slate 200
    tertiary: '#0891b2', // Cyan/Teal for distinct actions
    tertiaryContainer: '#cffafe',
    background: '#f8fafc', // Slate 50 - Soft off-white
    surface: '#ffffff', // Pure white for cards
    surfaceVariant: '#f1f5f9', // Slate 100 - Subtle contrast for dashboard cards
    surfaceDisabled: '#e2e8f0',
    error: '#b91c1c',
    errorContainer: '#fee2e2',
    onPrimary: '#ffffff',
    onPrimaryContainer: '#312e81',
    onSecondary: '#ffffff',
    onSecondaryContainer: '#0f172a',
    onTertiary: '#ffffff',
    onTertiaryContainer: '#0e7490',
    onBackground: '#0f172a',
    onSurface: '#0f172a',
    onSurfaceVariant: '#475569', // Slate 600 - Softer text for labels
    onSurfaceDisabled: '#94a3b8',
    onError: '#ffffff',
    onErrorContainer: '#7f1d1d',
    outline: '#94a3b8', // Slate 400
    outlineVariant: '#cbd5e1', // Slate 300
    shadow: '#000000',
    scrim: '#000000',
    inverseSurface: '#334155',
    inverseOnSurface: '#f1f5f9',
    inversePrimary: '#818cf8',
    backdrop: 'rgba(0, 0, 0, 0.4)',
    elevation: {
      level0: 'transparent',
      level1: '#ffffff',
      level2: '#f8fafc',
      level3: '#f1f5f9',
      level4: '#e2e8f0',
      level5: '#cbd5e1',
    },
  },
  dark: {
    primary: '#818cf8', // Lighter Indigo for Dark Mode
    primaryContainer: '#312e81', // Indigo 900
    secondary: '#cbd5e1', // Slate 300
    secondaryContainer: '#334155', // Slate 700
    tertiary: '#22d3ee', // Cyan 400
    tertiaryContainer: '#0e7490',
    background: '#0f172a', // Slate 900 - Rich dark blue-grey
    surface: '#1e293b', // Slate 800 - Lighter card background
    surfaceVariant: '#334155', // Slate 700
    surfaceDisabled: '#475569',
    error: '#f87171',
    errorContainer: '#7f1d1d',
    onPrimary: '#312e81',
    onPrimaryContainer: '#e0e7ff',
    onSecondary: '#0f172a',
    onSecondaryContainer: '#e2e8f0',
    onTertiary: '#064e3b',
    onTertiaryContainer: '#cffafe',
    onBackground: '#f8fafc',
    onSurface: '#f8fafc',
    onSurfaceVariant: '#cbd5e1',
    onSurfaceDisabled: '#64748b',
    onError: '#450a0a',
    onErrorContainer: '#fecaca',
    outline: '#64748b',
    outlineVariant: '#475569',
    shadow: '#000000',
    scrim: '#000000',
    inverseSurface: '#f1f5f9',
    inverseOnSurface: '#0f172a',
    inversePrimary: '#4338ca',
    backdrop: 'rgba(0, 0, 0, 0.4)',
    elevation: {
      level0: 'transparent',
      level1: '#1e293b',
      level2: '#334155',
      level3: '#475569',
      level4: '#64748b',
      level5: '#94a3b8',
    },
  },
};

// Typography - Tweaked for slightly more modern feel
export const typography = {
  displayLarge: {
    fontSize: 57,
    lineHeight: 64,
    fontWeight: '400' as const,
    letterSpacing: -0.25,
  },
  displayMedium: {
    fontSize: 45,
    lineHeight: 52,
    fontWeight: '400' as const,
  },
  displaySmall: {
    fontSize: 36,
    lineHeight: 44,
    fontWeight: '400' as const,
  },
  headlineLarge: {
    fontSize: 32,
    lineHeight: 40,
    fontWeight: '600' as const, // Slightly bolder headers
  },
  headlineMedium: {
    fontSize: 28,
    lineHeight: 36,
    fontWeight: '600' as const,
  },
  headlineSmall: {
    fontSize: 24,
    lineHeight: 32,
    fontWeight: '600' as const,
  },
  titleLarge: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '500' as const,
  },
  titleMedium: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '600' as const, // Increased weight for emphasis
    letterSpacing: 0.15,
  },
  titleSmall: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600' as const,
    letterSpacing: 0.1,
  },
  bodyLarge: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '400' as const,
    letterSpacing: 0.5,
  },
  bodyMedium: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '400' as const,
    letterSpacing: 0.25,
  },
  bodySmall: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '400' as const,
    letterSpacing: 0.4,
  },
  labelLarge: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600' as const, // Bolder labels
    letterSpacing: 0.1,
  },
  labelMedium: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600' as const,
    letterSpacing: 0.5,
  },
  labelSmall: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '600' as const,
    letterSpacing: 0.5,
  },
};

// Spacing
export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

// Semantic colors
export const semanticColors = {
  light: {
    success: '#15803d', // Green 700 - darker/sharper
    info: '#0284c7', // Sky 600
    warning: '#b45309', // Amber 700 - less neon orange
  },
  dark: {
    success: '#4ade80', // Green 400
    info: '#38bdf8', // Sky 400
    warning: '#fbbf24', // Amber 400
  },
};

// Create theme objects
export const lightTheme: MD3Theme = {
  ...MD3LightTheme,
  colors: colors.light,
  fonts: typography as any, // Cast to any to satisfy type overlap if custom props exist
};

export const darkTheme: MD3Theme = {
  ...MD3DarkTheme,
  colors: colors.dark,
  fonts: typography as any,
};