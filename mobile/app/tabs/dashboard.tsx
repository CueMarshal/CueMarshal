import { View, StyleSheet, ScrollView, useColorScheme, RefreshControl, ActivityIndicator } from 'react-native';
import { useState, useEffect, useCallback } from 'react';
import { api } from '../../services/api';
import { Text, Card } from 'react-native-paper';
import { StatusIndicator } from '../../components/StatusIndicator';
import { CostBadge } from '../../components/CostBadge';
import { spacing, semanticColors, colors } from '../../theme';

export default function DashboardScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const themeSemanticColors = isDark ? semanticColors.dark : semanticColors.light;

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [data, setData] = useState<{
    services: Array<{ name: string, status: string }>;
    costs: any;
    stats: any;
    activity: any[];
  }>({
    services: [],
    costs: { total_cost_usd: 0, breakdown_by_model: {} },
    stats: { totalTasks: 0, completedTasks: 0, activeTasks: 0, pendingTasks: 0 },
    activity: []
  });

  const fetchData = async () => {
    try {
      const dashboardData = await api.getDashboardData();

      // Transform API response to UI model
      const services: Array<{ name: string, status: string }> = [];
      if (dashboardData.health?.services) {
        // Map health check services
        Object.entries(dashboardData.health.services).forEach(([name, info]: [string, any]) => {
          services.push({
            name: name.charAt(0).toUpperCase() + name.slice(1),
            status: info.status
          });
        });
      }

      setData({
        services,
        costs: dashboardData.costs || { total_cost_usd: 0, breakdown_by_model: {} },
        stats: {
          totalTasks: dashboardData.metrics?.total_tasks || 0,
          completedTasks: dashboardData.metrics?.completed_tasks || 0,
          activeTasks: dashboardData.metrics?.active_tasks || 0,
          pendingTasks: dashboardData.metrics?.pending_tasks || 0,
        },
        activity: dashboardData.recent_activity || []
      });
    } catch (error) {
      console.error('Failed to fetch dashboard data:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchData();
  }, []);

  const themeColors = isDark ? colors.dark : colors.light;

  if (loading && !refreshing) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={themeColors.primary} />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    >
      <View style={styles.content}>
        {/* System Health */}
        <Card style={styles.card}>
          <Card.Title title="System Health" />
          <Card.Content>
            <View style={styles.statusRow}>
              {data.services.map((service) => (
                <StatusIndicator
                  key={service.name}
                  name={service.name}
                  status={service.status as any}
                />
              ))}
              {data.services.length === 0 && (
                <Text variant="bodyMedium">No service status available</Text>
              )}
            </View>
          </Card.Content>
        </Card>

        {/* LLM Costs */}
        <Card style={styles.card}>
          <Card.Title title="LLM Costs (This Month)" />
          <Card.Content>
            <CostBadge costs={data.costs} />
          </Card.Content>
        </Card>

        {/* Task Statistics */}
        <Card style={styles.card}>
          <Card.Title title="Task Overview" />
          <Card.Content>
            <View style={styles.statsRow}>
              <View style={styles.statItem}>
                <Text variant="headlineMedium">{data.stats.totalTasks}</Text>
                <Text variant="bodySmall">Total Tasks</Text>
              </View>
              <View style={styles.statItem}>
                <Text variant="headlineMedium" style={{ color: themeSemanticColors.success }}>
                  {data.stats.completedTasks}
                </Text>
                <Text variant="bodySmall">Completed</Text>
              </View>
            </View>
            <View style={styles.statsRow}>
              <View style={styles.statItem}>
                <Text variant="headlineMedium" style={{ color: themeSemanticColors.info }}>
                  {data.stats.activeTasks}
                </Text>
                <Text variant="bodySmall">In Progress</Text>
              </View>
              <View style={styles.statItem}>
                <Text variant="headlineMedium">{data.stats.pendingTasks}</Text>
                <Text variant="bodySmall">Pending</Text>
              </View>
            </View>
          </Card.Content>
        </Card>

        {/* Activity Feed */}
        <Card style={styles.card}>
          <Card.Title title="Recent Activity" />
          <Card.Content>
            {data.activity.map((item) => (
              <Text key={item.id} variant="bodySmall" style={styles.activityItem} numberOfLines={1}>
                • {item.type === 'pr' ? 'PR' : 'Issue'} #{item.id} {item.state === 'closed' ? 'completed' : 'opened'}: {item.title}
              </Text>
            ))}
            {data.activity.length === 0 && (
              <Text variant="bodySmall" style={{ opacity: 0.6 }}>No recent activity</Text>
            )}
          </Card.Content>
        </Card>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: spacing.md,
  },
  card: {
    marginBottom: spacing.md,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginVertical: spacing.sm,
  },
  statItem: {
    alignItems: 'center',
  },
  activityItem: {
    marginVertical: spacing.xs,
    opacity: 0.8,
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  statusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
});
