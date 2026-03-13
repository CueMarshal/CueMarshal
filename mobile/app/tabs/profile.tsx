import { View, StyleSheet, ScrollView } from 'react-native';
import { List, Button, Avatar, Text, Switch, Divider, useTheme, Dialog, Portal, TextInput, Snackbar } from 'react-native-paper';
import { useState } from 'react';
import { useAuthStore } from '../../stores/auth';
import { spacing } from '../../theme';
import { useRuntimeConfig } from '../../hooks/useRuntimeConfig';

export default function ProfileScreen() {
  const { user, logout } = useAuthStore();
  const theme = useTheme();
  const { config: runtimeConfig, saveBaseUrl, resetToDefault } = useRuntimeConfig();
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [darkModeEnabled, setDarkModeEnabled] = useState(false);
  const [showUrlDialog, setShowUrlDialog] = useState(false);
  const [editedUrl, setEditedUrl] = useState('');
  const [snackbar, setSnackbar] = useState<{ visible: boolean; message: string }>({ visible: false, message: '' });

  const showMessage = (message: string) => setSnackbar({ visible: true, message });

  const handleLogout = async () => {
    await logout();
  };

  const handleOpenUrlDialog = () => {
    setEditedUrl(runtimeConfig.baseUrl);
    setShowUrlDialog(true);
  };

  const handleSaveUrl = async () => {
    if (!editedUrl.trim()) {
      return;
    }

    try {
      await saveBaseUrl(editedUrl);
      setShowUrlDialog(false);
      showMessage('Server URL updated successfully');
    } catch (error) {
      console.error('Failed to save URL:', error);
      showMessage('Failed to save URL');
    }
  };

  const handleResetUrl = async () => {
    await resetToDefault();
    setEditedUrl(runtimeConfig.baseUrl);
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Avatar.Text
          size={80}
          label={user?.username?.substring(0, 2).toUpperCase() || 'U'}
        />
        <Text variant="headlineSmall" style={styles.username}>
          {user?.username || 'User'}
        </Text>
        <Text variant="bodyMedium" style={styles.email}>
          {user?.email || 'user@example.com'}
        </Text>
      </View>

      <View style={styles.content}>
        <List.Section>
          <List.Subheader>Settings</List.Subheader>
          
          {/* Note: These toggles are UI-only and not yet connected to actual functionality */}
          <List.Item
            title="Notifications"
            description="Enable push notifications (not yet implemented)"
            right={() => (
              <Switch
                value={notificationsEnabled}
                onValueChange={setNotificationsEnabled}
                disabled
              />
            )}
          />

          <List.Item
            title="Dark Mode"
            description="Use dark theme (follows system setting)"
            right={() => (
              <Switch
                value={darkModeEnabled}
                onValueChange={setDarkModeEnabled}
                disabled
              />
            )}
          />

          <Divider />

          <List.Item
            title="Server URL"
            description={runtimeConfig.baseUrl}
            left={(props) => <List.Icon {...props} icon="server" />}
            right={(props) => <List.Icon {...props} icon="chevron-right" />}
            onPress={handleOpenUrlDialog}
          />

          <List.Item
            title="Account"
            description="Manage your account settings"
            left={(props) => <List.Icon {...props} icon="account-cog" />}
            onPress={() => {}}
          />

          <List.Item
            title="Privacy"
            description="Privacy and security settings"
            left={(props) => <List.Icon {...props} icon="shield-account" />}
            onPress={() => {}}
          />

          <List.Item
            title="About"
            description="App version and information"
            left={(props) => <List.Icon {...props} icon="information" />}
            onPress={() => {}}
          />
        </List.Section>

        <View style={styles.logoutContainer}>
          <Button
            mode="outlined"
            onPress={handleLogout}
            style={[styles.logoutButton, { borderColor: theme.colors.error }]}
            icon="logout"
          >
            Sign Out
          </Button>
        </View>
      </View>

      <Portal>
        <Dialog visible={showUrlDialog} onDismiss={() => setShowUrlDialog(false)}>
          <Dialog.Title>Configure Server URL</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium" style={styles.dialogHint}>
              Enter the base URL for your CueMarshal deployment. Use:
            </Text>
            <Text variant="bodySmall" style={styles.dialogHint}>
              • iOS/Web: http://localhost:8180
            </Text>
            <Text variant="bodySmall" style={styles.dialogHint}>
              • Android Emulator: http://10.0.2.2:8180
            </Text>
            <Text variant="bodySmall" style={[styles.dialogHint, { marginBottom: spacing.md }]}>
              • Production: https://your-domain.com
            </Text>
            
            <TextInput
              label="Server URL"
              value={editedUrl}
              onChangeText={setEditedUrl}
              mode="outlined"
              placeholder="http://10.0.2.2:8180"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
            
            <Button
              mode="text"
              onPress={handleResetUrl}
              style={{ marginTop: spacing.sm }}
            >
              Reset to Default ({Platform.OS === 'android' ? '10.0.2.2:8180' : 'localhost:8180'})
            </Button>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setShowUrlDialog(false)}>Cancel</Button>
            <Button onPress={handleSaveUrl}>Save</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      <Snackbar
        visible={snackbar.visible}
        onDismiss={() => setSnackbar((s) => ({ ...s, visible: false }))}
        duration={3000}
      >
        {snackbar.message}
      </Snackbar>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    alignItems: 'center',
    padding: spacing.xl,
  },
  username: {
    marginTop: spacing.md,
  },
  email: {
    opacity: 0.7,
    marginTop: spacing.xs,
  },
  content: {
    flex: 1,
  },
  logoutContainer: {
    padding: spacing.lg,
    marginTop: spacing.xl,
  },
  logoutButton: {
    // borderColor is set dynamically using theme
  },
  dialogHint: {
    marginTop: spacing.xs,
    opacity: 0.7,
  },
});
