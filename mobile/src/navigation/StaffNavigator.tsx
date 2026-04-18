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

const Tab = createBottomTabNavigator();

export default function StaffNavigator() {
  return (
    <Tab.Navigator
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
          };
          // Safe fallback using a known valid Ionicons name
          const iconName = icons[route.name] ?? 'ellipse-outline';
          return <Ionicons name={iconName} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen name="Tables" component={StaffHomeScreen} />
      <Tab.Screen name="POS" component={POSScreen} />
      <Tab.Screen name="Inventory" component={InventoryScreen} />
      <Tab.Screen name="Credits" component={CreditTopupScreen} />
      <Tab.Screen name="Queue" component={StaffQueueScreen} />
      <Tab.Screen name="Reservations" component={StaffReservationScreen} />
    </Tab.Navigator>
  );
}
