import { View, StyleSheet } from "react-native";
import { Text } from "react-native-paper";

export function StatusIndicator({ name, status }: { name: string; status: string }) {
  const color = status === "healthy" ? "#4caf50" : "#f44336";
  
  return (
    <View style={styles.container}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text variant="bodySmall">{name}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    padding: 4,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
});
