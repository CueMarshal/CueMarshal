import { View, StyleSheet } from "react-native";
import { Card, Text, useTheme } from "react-native-paper";

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatBubbleProps {
  message: Message;
}

export function ChatBubble({ message }: ChatBubbleProps) {
  const isUser = message.role === 'user';
  const theme = useTheme();

  return (
    <View style={[styles.container, isUser ? styles.userContainer : styles.assistantContainer]}>
      <Card style={[
        styles.card,
        { backgroundColor: isUser ? theme.colors.primary : theme.colors.surfaceVariant }
      ]}>
        <Card.Content>
          <Text style={{ color: isUser ? theme.colors.onPrimary : theme.colors.onSurfaceVariant }}>
            {message.content}
          </Text>
        </Card.Content>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 4,
    maxWidth: '80%',
  },
  userContainer: {
    alignSelf: 'flex-end',
  },
  assistantContainer: {
    alignSelf: 'flex-start',
  },
  card: {
    elevation: 2,
  },
});
