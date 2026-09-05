import React, { useEffect } from 'react';
import { Alert } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as Notifications from 'expo-notifications';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { SocketProvider } from './src/context/SocketContext';
import RootNavigator from './src/navigation/RootNavigator';
import AppDialogHost, { showDialog } from './src/components/AppDialog';
import { FeatureProvider } from './src/context/FeatureContext';

// All existing application alerts use this bridge. It preserves their callback
// signatures while replacing the platform's white dialog with the app modal.
(Alert as any).alert = (title?: string, message?: string, buttons?: any[]) => showDialog(title, message, buttons);

// Configure notifications
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export default function App() {
  return (
    <FeatureProvider>
      <AuthProvider>
        <SocketProvider>
          <StatusBar style="light" backgroundColor="#0A0E1A" />
          <RootNavigator />
          <AppDialogHost />
        </SocketProvider>
      </AuthProvider>
    </FeatureProvider>
  );
}
