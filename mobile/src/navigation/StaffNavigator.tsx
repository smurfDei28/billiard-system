import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../constants';
import StaffReservationScreen from '../screens/staff/StaffReservationScreen';
import StaffHomeScreen from '../screens/staff/StaffHomeScreen';
import POSScreen from '../screens/staff/POSScreen';
import InventoryScreen from '../screens/staff/InventoryScreen';
import CreditTopupScreen from '../screens/staff/CreditTopupScreen';
import StaffQueueScreen from '../screens/staff/StaffQueueScreen';
import PaymentVerificationScreen from '../screens/staff/PaymentVerificationScreen';
import StaffTournamentOperationsScreen from '../screens/staff/StaffTournamentOperationsScreen';
import StaffNotificationsScreen from '../screens/staff/StaffNotificationsScreen';
import MemberOrdersScreen from '../screens/staff/MemberOrdersScreen';
import { useFeatures } from '../context/FeatureContext';
import ModuleLandingScreen from '../screens/ModuleLandingScreen';

const Tab = createBottomTabNavigator();

export default function StaffNavigator() {
  const { hasModule } = useFeatures();
  const hasStaffModule = hasModule('TABLE_MANAGEMENT') || hasModule('POS_INVENTORY') || hasModule('RESERVATIONS') || hasModule('CREDITS_PAYMENTS') || hasModule('TOURNAMENTS');
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
        tabBarActiveTintColor: COLORS.gold,
        tabBarInactiveTintColor: COLORS.textMuted,
        tabBarLabelStyle: { fontSize: 10, fontWeight: '600' },
        tabBarIcon: ({ color, size, focused }) => {
          const icons: Record<string, keyof typeof Ionicons.glyphMap> = {
            Tables: focused ? 'grid' : 'grid-outline',
            POS: focused ? 'cart' : 'cart-outline',
            Inventory: focused ? 'cube' : 'cube-outline',
            Credits: focused ? 'wallet' : 'wallet-outline',
            Queue: focused ? 'list' : 'list-outline',
            Reservations: focused ? 'calendar' : 'calendar-outline',
            Payments: focused ? 'card' : 'card-outline',
            Matches: focused ? 'trophy' : 'trophy-outline',
            Notifications: focused ? 'notifications' : 'notifications-outline',
          };
          // Safe fallback using a known valid Ionicons name
          const iconName = icons[route.name] ?? 'ellipse-outline';
          return <Ionicons name={iconName} size={size} color={color} />;
        },
      })}
    >
      {!hasStaffModule && <Tab.Screen name="Modules" component={ModuleLandingScreen} />}
      {hasModule('TABLE_MANAGEMENT') && <Tab.Screen name="Tables" component={StaffHomeScreen} />}
      {hasModule('POS_INVENTORY') && <Tab.Screen name="POS" component={POSScreen} />}
      {hasModule('RESERVATIONS') && <Tab.Screen name="Queue" component={StaffQueueScreen} />}
      {hasModule('CREDITS_PAYMENTS') && <Tab.Screen name="Payments" component={PaymentVerificationScreen} />}
      {hasModule('TOURNAMENTS') && <Tab.Screen name="Matches" component={StaffTournamentOperationsScreen} />}
      {hasModule('POS_INVENTORY') && <Tab.Screen name="Inventory" component={InventoryScreen} options={{ tabBarButton: () => null }} />}
      {hasModule('CREDITS_PAYMENTS') && <Tab.Screen name="Credits" component={CreditTopupScreen} options={{ tabBarButton: () => null }} />}
      {hasModule('RESERVATIONS') && <Tab.Screen name="Reservations" component={StaffReservationScreen} options={{ tabBarButton: () => null }} />}
      {hasModule('NOTIFICATIONS') && <Tab.Screen name="Notifications" component={StaffNotificationsScreen} options={{ tabBarButton: () => null }} />}
      {hasModule('POS_INVENTORY') && <Tab.Screen name="MemberOrders" component={MemberOrdersScreen} options={{ tabBarButton: () => null }} />}
    </Tab.Navigator>
  );
}
