import { View, StyleSheet, Alert } from 'react-native';
import { Button, Text, ActivityIndicator, useTheme } from 'react-native-paper';
import { useState, useEffect } from 'react';
import { useAuthStore } from '../../stores/auth';
import { spacing } from '../../theme';
import { config, validateConfig, fetchOAuth2ClientId } from '../../config';
import { getGlobalRuntimeConfig } from '../../hooks/useRuntimeConfig';

export default function LoginScreen() {
  const [isLoading, setIsLoading] = useState(false);
  const [configReady, setConfigReady] = useState(!!config.oauth2.clientId);
  const startOAuthFlow = useAuthStore((state) => state.startOAuthFlow);
  const theme = useTheme();

  // Eagerly discover the OAuth2 client ID on mount so the warning
  // disappears once the conductor is reachable.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const rc = await getGlobalRuntimeConfig();
      const id = await fetchOAuth2ClientId(rc.conductorUrl);
      if (!cancelled && id) setConfigReady(true);
    })();
    return () => { cancelled = true; };
  }, []);

  const handleOAuthLogin = async () => {
    // Validate configuration before attempting OAuth
    const validation = validateConfig();
    if (!validation.isValid) {
      Alert.alert(
        'Configuration Error',
        `Please configure the app:\n\n${validation.errors.join('\n')}`,
        [{ text: 'OK' }]
      );
      return;
    }

    setIsLoading(true);
    try {
      const result = await startOAuthFlow();
      
      if (!result.success) {
        Alert.alert(
          'Authentication Failed',
          result.error || 'Failed to authenticate with Gitea',
          [{ text: 'OK' }]
        );
      }
    } catch (error) {
      Alert.alert(
        'Error',
        error instanceof Error ? error.message : 'An unexpected error occurred',
        [{ text: 'OK' }]
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text variant="displaySmall" style={styles.title}>
          Welcome to CueMarshal
        </Text>
        <Text variant="bodyLarge" style={styles.subtitle}>
          Sign in with your Gitea account
        </Text>

        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" />
            <Text variant="bodyMedium" style={styles.loadingText}>
              Authenticating...
            </Text>
          </View>
        ) : (
          <Button
            mode="contained"
            onPress={handleOAuthLogin}
            style={styles.button}
            icon="git"
          >
            Sign in with Gitea
          </Button>
        )}

        <Text variant="bodySmall" style={styles.infoText}>
          You will be redirected to Gitea to authenticate
        </Text>

        {!configReady && (
          <View style={[
            styles.warningContainer,
            { backgroundColor: theme.colors.errorContainer }
          ]}>
            <Text variant="bodySmall" style={[
              styles.warningText,
              { color: theme.colors.onErrorContainer }
            ]}>
              ⚠️ OAuth2 client ID not yet available. Make sure the platform is running.
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    width: '100%',
    maxWidth: 400,
    padding: spacing.lg,
  },
  title: {
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  subtitle: {
    textAlign: 'center',
    marginBottom: spacing.xl,
    opacity: 0.7,
  },
  button: {
    marginTop: spacing.md,
  },
  loadingContainer: {
    alignItems: 'center',
    marginVertical: spacing.xl,
  },
  loadingText: {
    marginTop: spacing.md,
    opacity: 0.7,
  },
  infoText: {
    textAlign: 'center',
    marginTop: spacing.md,
    opacity: 0.6,
  },
  warningContainer: {
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: 8,
  },
  warningText: {
    textAlign: 'center',
  },
});
