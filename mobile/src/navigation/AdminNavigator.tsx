import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../constants';

import AdminDashboardScreen from '../screens/admin/AdminDashboardScreen';
import UserManagementScreen from '../screens/admin/UserManagementScreen';
import TournamentManagementScreen from '../screens/admin/TournamentManagementScreen';
import AnnouncementsScreen from '../screens/admin/AnnouncementsScreen';
import ReportsScreen from '../screens/admin/ReportsScreen';
import PaymentVerificationScreen from '../screens/staff/PaymentVerificationScreen';
import AdminNotificationsScreen from '../screens/admin/AdminNotificationsScreen';
import { useFeatures } from '../context/FeatureContext';

const Tab = createBottomTabNavigator();

export function AdminNavigator() {
  const { hasModule } = useFeatures();
  return (
    <Tab.Navigator
      backBehavior="history"
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: {
          backgroundColor: COLORS.surface,
          borderTopColor: COLORS.surfaceBorder,
          borderTopWidth: 1,
          paddingBottom: 8,
          paddingTop: 8,
          height: 65,
        },
        tabBarActiveTintColor: COLORS.rankElite,
        tabBarInactiveTintColor: COLORS.textMuted,
        tabBarLabelStyle: { fontSize: 10, fontWeight: '600' },
        tabBarIcon: ({ color, size, focused }) => {
          const icons: Record<string, keyof typeof Ionicons.glyphMap> = {
            Dashboard: focused ? 'stats-chart' : 'stats-chart-outline',
            Users: focused ? 'people' : 'people-outline',
            Tournaments: focused ? 'trophy' : 'trophy-outline',
            Announce: focused ? 'megaphone' : 'megaphone-outline',
            Reports: focused ? 'bar-chart' : 'bar-chart-outline',
            Payments: focused ? 'card' : 'card-outline',
            Notifications: focused ? 'notifications' : 'notifications-outline',
          };
          // Safe fallback using a known valid Ionicons name
          const iconName = icons[route.name] ?? 'ellipse-outline';
          return <Ionicons name={iconName} size={size} color={color} />;
        },
      })}
    >
      {hasModule('REPORTS_ANALYTICS') && <Tab.Screen name="Dashboard" component={AdminDashboardScreen} />}
      <Tab.Screen name="Users" component={UserManagementScreen} />
      {hasModule('TOURNAMENTS') && <Tab.Screen name="Tournaments" component={TournamentManagementScreen} />}
      {hasModule('REPORTS_ANALYTICS') && <Tab.Screen name="Reports" component={ReportsScreen} />}
      {hasModule('CREDITS_PAYMENTS') && <Tab.Screen name="Payments" component={PaymentVerificationScreen} />}
      <Tab.Screen name="Announce" component={AnnouncementsScreen} options={{ tabBarButton: () => null }} />
      {hasModule('NOTIFICATIONS') && <Tab.Screen name="Notifications" component={AdminNotificationsScreen} options={{ tabBarButton: () => null }} />}
    </Tab.Navigator>
  );
}

export default AdminNavigator;
