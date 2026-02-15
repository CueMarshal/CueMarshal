import { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { PaperProvider, ActivityIndicator } from 'react-native-paper';
import { View, StyleSheet } from 'react-native';
import { useAppTheme } from '../hooks/useTheme';
import { useAuthStore } from '../stores/auth';

export default function RootLayout() {
  const { theme } = useAppTheme();
  const { token, isInitialized, initialize } = useAuthStore();
  const segments = useSegments();
  const router = useRouter();

  // Initialize auth on app startup
  useEffect(() => {
    initialize();
  }, []);

  // Handle navigation based on auth state
  useEffect(() => {
    if (!isInitialized) return;

    const inAuthGroup = segments[0] === 'auth';

    if (!token && !inAuthGroup) {
      // Redirect to login if not authenticated
      router.replace('/auth/login');
    } else if (token && inAuthGroup) {
      // Redirect to main app if authenticated
      router.replace('/tabs/chat');
    }
  }, [token, segments, isInitialized]);

  // Show loading screen while initializing
  if (!isInitialized) {
    return (
      <PaperProvider theme={theme}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" />
        </View>
      </PaperProvider>
    );
  }

  return (
    <PaperProvider theme={theme}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="auth" />
        <Stack.Screen name="tabs" />
      </Stack>
    </PaperProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
