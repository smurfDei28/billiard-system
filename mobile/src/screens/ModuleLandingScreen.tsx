import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { COLORS } from '../constants';
import { useFeatures } from '../context/FeatureContext';
import { useAuth } from '../context/AuthContext';

const readable = (value: string) => value.toLowerCase().split('_').map((part) => part[0].toUpperCase() + part.slice(1)).join(' ');

export default function ModuleLandingScreen() {
  const { enabledModules } = useFeatures();
  const { logout } = useAuth();
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Saturday Nights Billiard</Text>
      <Text style={styles.subtitle}>Modules included in this installation</Text>
      <View style={styles.list}>
        {enabledModules.map((moduleName) => (
          <View key={moduleName} style={styles.module}>
            <Text style={styles.moduleText}>{readable(moduleName)}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.help}>Use the available tabs below to open your purchased modules.</Text>
      <TouchableOpacity style={styles.logout} onPress={logout}>
        <Text style={styles.logoutText}>Sign Out</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: 24, paddingTop: 64 },
  title: { color: COLORS.textPrimary, fontSize: 26, fontWeight: '900' },
  subtitle: { color: COLORS.textSecondary, marginTop: 6, marginBottom: 20 },
  list: { gap: 10 },
  module: { padding: 16, borderRadius: 12, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.primary + '55' },
  moduleText: { color: COLORS.textPrimary, fontWeight: '700' },
  help: { color: COLORS.textMuted, marginTop: 20, lineHeight: 20 },
  logout: { marginTop: 28, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: COLORS.error, alignItems: 'center' },
  logoutText: { color: COLORS.error, fontWeight: '800' },
});

