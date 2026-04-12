import React, { useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from '../context/AuthContext';

// Auth Screens
import SplashScreen from '../screens/auth/SplashScreen';
import LoginScreen from '../screens/auth/LoginScreen';
import RegisterScreen from '../screens/auth/RegisterScreen';

// Role Navigators
import MemberNavigator from './MemberNavigator';
import StaffNavigator from './StaffNavigator';
import AdminNavigator from './AdminNavigator';
import TVNavigator from './TVNavigator';

const Stack = createNativeStackNavigator();

export default function RootNavigator() {
  const { user, isLoading } = useAuth();
  const [splashDone, setSplashDone] = useState(false);

  // Stage 1: Splash Screen — shows on every app open
  if (!splashDone || isLoading) {
    return <SplashScreen onFinish={() => setSplashDone(true)} />;
  }

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!user ? (
          // Stage 2 & 3: Registration and Login
          <>
            <Stack.Screen name="Login" component={LoginScreen} />
            <Stack.Screen name="Register" component={RegisterScreen} />
          </>
        ) : user.role === 'ADMIN' ? (
          // Stage 4: Landing Page (Admin Dashboard)
          <Stack.Screen name="Admin" component={AdminNavigator} />
        ) : user.role === 'STAFF' ? (
          // Stage 4: Landing Page (Staff Home)
          <Stack.Screen name="Staff" component={StaffNavigator} />
        ) : (
          // Stage 4: Landing Page (Member Home)
          <Stack.Screen name="Member" component={MemberNavigator} />
        )}
        <Stack.Screen name="TV" component={TVNavigator} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
