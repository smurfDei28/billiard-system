import React, { useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from '../context/AuthContext';

// Auth Screens
import SplashScreen from '../screens/auth/SplashScreen';
import LoginScreen from '../screens/auth/LoginScreen';
import RegisterScreen from '../screens/auth/RegisterScreen';
import VerifyEmailScreen from '../screens/auth/VerifyEmailScreen';
import EmailVerifiedSuccessScreen from '../screens/auth/EmailVerifiedSuccessScreen';
import PlayerProfileScreen from '../screens/member/PlayerProfileScreen';

// Role Navigators
import MemberNavigator from './MemberNavigator';
import StaffNavigator from './StaffNavigator';
import AdminNavigator from './AdminNavigator';
import TVNavigator from './TVNavigator';

const Stack = createNativeStackNavigator();
const linking = {
  prefixes: ['saturdaynights://'],
  config: {
    screens: {
      EmailVerifiedSuccess: 'email-verified',
    },
  },
};

export default function RootNavigator() {
  const { user, isLoading } = useAuth();
  const [splashDone, setSplashDone] = useState(false);

  // Stage 1: Splash Screen — shows on every app open
  if (!splashDone || isLoading) {
    return <SplashScreen onFinish={() => setSplashDone(true)} />;
  }

  return (
    <NavigationContainer linking={linking}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!user ? (
          // Stage 2 & 3: Registration and Login
          <>
            <Stack.Screen name="Login" component={LoginScreen} />
            <Stack.Screen name="Register" component={RegisterScreen} />
            <Stack.Screen name="VerifyEmail" component={VerifyEmailScreen} />
            <Stack.Screen name="EmailVerifiedSuccess" component={EmailVerifiedSuccessScreen} />
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
        {user && (user.role === 'ADMIN' || user.role === 'STAFF') && (
          <Stack.Screen name="TV" component={TVNavigator} />
        )}
        {user && <Stack.Screen name="PlayerProfile" component={PlayerProfileScreen} />}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
