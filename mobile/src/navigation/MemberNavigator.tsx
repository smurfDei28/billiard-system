import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../constants';

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
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        tabBarIcon: ({ color, size, focused }) => {
          const icons: Record<string, keyof typeof Ionicons.glyphMap> = {
            Home: focused ? 'home' : 'home-outline',
            Profile: focused ? 'person' : 'person-outline',
            Tournaments: focused ? 'trophy' : 'trophy-outline',
            Queue: focused ? 'time' : 'time-outline',
            Notifications: focused ? 'notifications' : 'notifications-outline',
          };
          return <Ionicons name={icons[route.name] || 'circle'} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen name="Home" component={MemberHomeScreen} />
      <Tab.Screen name="Tournaments" component={TournamentListScreen} />
      <Tab.Screen name="Queue" component={QueueScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
      <Tab.Screen name="Notifications" component={NotificationsScreen} />
    </Tab.Navigator>
  );
}
