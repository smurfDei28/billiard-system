import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../constants';
import ReservationScreen from '../screens/member/ReservationScreen';
import MemberHomeScreen from '../screens/member/MemberHomeScreen';
import ProfileScreen from '../screens/member/ProfileScreen';
import TournamentListScreen from '../screens/member/TournamentListScreen';
import QueueScreen from '../screens/member/QueueScreen';
import NotificationsScreen from '../screens/member/NotificationsScreen';

const Tab = createBottomTabNavigator();

export default function MemberNavigator() {
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
        tabBarActiveTintColor: COLORS.primary,
        tabBarInactiveTintColor: COLORS.textMuted,
        tabBarLabelStyle: { fontSize: 10, fontWeight: '600' },
        tabBarIcon: ({ color, size, focused }) => {
          const icons: Record<string, keyof typeof Ionicons.glyphMap> = {
            Home: focused ? 'home' : 'home-outline',
            Profile: focused ? 'person' : 'person-outline',
            Tournaments: focused ? 'trophy' : 'trophy-outline',
            Queue: focused ? 'time' : 'time-outline',
            Notifications: focused ? 'notifications' : 'notifications-outline',
            Reservations: focused ? 'calendar' : 'calendar-outline',
          };
          // Safe fallback using a known valid Ionicons name
          const iconName = icons[route.name] ?? 'ellipse-outline';
          return <Ionicons name={iconName} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen name="Home" component={MemberHomeScreen} />
      <Tab.Screen name="Tournaments" component={TournamentListScreen} />
      <Tab.Screen name="Queue" component={QueueScreen} />
      <Tab.Screen name="Reservations" component={ReservationScreen} />
      <Tab.Screen name="Notifications" component={NotificationsScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}
