import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import TVDisplayScreen from '../screens/tv/TVDisplayScreen';

const Stack = createNativeStackNavigator();

export default function TVNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="TVDisplay" component={TVDisplayScreen} />
    </Stack.Navigator>
  );
}
