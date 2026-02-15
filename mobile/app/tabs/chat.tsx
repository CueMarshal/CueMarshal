import { View, StyleSheet, FlatList, KeyboardAvoidingView, Platform } from 'react-native';
import { TextInput, IconButton, ActivityIndicator, Text } from 'react-native-paper';
import { useState, useRef } from 'react';
import { useChatStore } from '../../stores/chat';
import { ChatBubble } from '../../components/ChatBubble';
import { spacing } from '../../theme';
import { useAppTheme } from '../../hooks/useTheme';

export default function ChatScreen() {
  const [input, setInput] = useState('');
  const { messages, isLoading, sendMessage } = useChatStore();
  const { theme } = useAppTheme();
  const flatListRef = useRef<FlatList>(null);

  const handleSend = async () => {
    if (input.trim()) {
      const message = input.trim();
      setInput('');
      await sendMessage(message);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={100}
    >
      <View style={styles.messagesContainer}>
        {messages.length === 0 ? (
          <View style={styles.emptyState}>
            <Text variant="headlineSmall" style={styles.emptyTitle}>
              Start a conversation
            </Text>
            <Text variant="bodyMedium" style={styles.emptySubtitle}>
              Ask me anything about your projects and tasks
            </Text>
          </View>
        ) : (
          <FlatList
            ref={flatListRef}
            data={messages}
            keyExtractor={(item) => item.timestamp.toString()}
            renderItem={({ item }) => <ChatBubble message={item} />}
            contentContainerStyle={styles.messagesList}
            inverted={false}
            onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
            onLayout={() => flatListRef.current?.scrollToEnd({ animated: false })}
          />
        )}
        {isLoading && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="small" />
            <Text variant="bodySmall" style={styles.loadingText}>
              Thinking...
            </Text>
          </View>
        )}
      </View>

      <View style={[
        styles.inputContainer, 
        { 
          backgroundColor: theme.colors.surface,
          borderTopColor: theme.colors.outlineVariant,
        }
      ]}>
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder="Type a message..."
          mode="outlined"
          style={styles.input}
          multiline
          maxLength={1000}
          onSubmitEditing={handleSend}
          disabled={isLoading}
        />
        <IconButton
          icon="send"
          size={24}
          onPress={handleSend}
          disabled={!input.trim() || isLoading}
          mode="contained"
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  messagesContainer: {
    flex: 1,
  },
  messagesList: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  emptyTitle: {
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  emptySubtitle: {
    textAlign: 'center',
    opacity: 0.7,
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md,
    gap: spacing.sm,
  },
  loadingText: {
    opacity: 0.7,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: spacing.sm,
    gap: spacing.sm,
    borderTopWidth: 1,
  },
  input: {
    flex: 1,
  },
});
