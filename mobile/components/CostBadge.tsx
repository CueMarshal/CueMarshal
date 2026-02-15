import { View, StyleSheet } from "react-native";
import { Text } from "react-native-paper";

export function CostBadge({ costs }: { costs: any }) {
  return (
    <View style={styles.container}>
      <Text variant="bodyLarge">
        Total: ${costs.total_cost_usd?.toFixed(2) || "0.00"}
      </Text>
      {costs.breakdown_by_model && (
        <View style={styles.breakdown}>
          {Object.entries(costs.breakdown_by_model).map(([tier, data]: [string, any]) => (
            <Text key={tier} variant="bodySmall">
              {tier}: ${data.cost?.toFixed(2) || "0.00"}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 8,
  },
  breakdown: {
    marginTop: 8,
  },
});
