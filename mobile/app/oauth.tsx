import { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import { ActivityIndicator, Text } from 'react-native-paper';
import * as WebBrowser from 'expo-web-browser';
import { useRouter } from 'expo-router';

// Complete the auth session so expo-auth-session can capture the redirect params
WebBrowser.maybeCompleteAuthSession();

/**
 * OAuth callback route
 * Handles the cuemarshal://oauth?code=... deep link redirect from Gitea.
 * The actual token exchange is handled by AuthSession.promptAsync() in auth.ts;
 * this route just needs to exist so Expo Router doesn't show "Page not found".
 */
export default function OAuthCallback() {
  const router = useRouter();

  useEffect(() => {
    // After auth session completes, navigate back to the root
    // so the auth state check in _layout.tsx handles routing
    const timeout = setTimeout(() => {
      router.replace('/');
    }, 1000);
    return () => clearTimeout(timeout);
  }, []);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" />
      <Text style={styles.text}>Completing authentication...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  text: {
    marginTop: 16,
    fontSize: 16,
  },
});
