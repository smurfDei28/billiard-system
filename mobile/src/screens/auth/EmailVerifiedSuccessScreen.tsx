import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../constants';

export default function EmailVerifiedSuccessScreen({ navigation }: any) {
  const checkScale = useRef(new Animated.Value(0)).current;
  const contentOpacity = useRef(new Animated.Value(0)).current;
  const contentOffset = useRef(new Animated.Value(16)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.spring(checkScale, { toValue: 1, tension: 70, friction: 6, useNativeDriver: true }),
      Animated.parallel([
        Animated.timing(contentOpacity, { toValue: 1, duration: 260, useNativeDriver: true }),
        Animated.timing(contentOffset, { toValue: 0, duration: 260, useNativeDriver: true }),
      ]),
    ]).start();
  }, [checkScale, contentOpacity, contentOffset]);

  const exitToLogin = () => {
    navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
  };

  return (
    <View style={styles.container}>
      <View style={styles.glow} />
      <View style={styles.content}>
        <Animated.View style={[styles.successRing, { transform: [{ scale: checkScale }] }]}>
          <View style={styles.successInner}>
            <Ionicons name="checkmark" size={56} color={COLORS.primary} />
          </View>
        </Animated.View>

        <Animated.View style={{ opacity: contentOpacity, transform: [{ translateY: contentOffset }], alignItems: 'center' }}>
          <Text style={styles.eyebrow}>SATURDAY NIGHTS BILLIARD</Text>
          <Text style={styles.title}>Email Verified{`\n`}Successfully</Text>
          <Text style={styles.description}>
            Your email has been verified and your account is now active. You can sign in and continue using the application.
          </Text>

          <View style={styles.statusCard}>
            <Ionicons name="shield-checkmark-outline" size={21} color={COLORS.primary} />
            <Text style={styles.statusText}>Your account is ready to use</Text>
          </View>
        </Animated.View>
      </View>

      <Animated.View style={[styles.footer, { opacity: contentOpacity, transform: [{ translateY: contentOffset }] }]}>
        <TouchableOpacity style={styles.exitButton} onPress={exitToLogin} activeOpacity={0.84}>
          <Text style={styles.exitButtonText}>Exit Now</Text>
          <Ionicons name="arrow-forward" size={19} color="#06110E" />
        </TouchableOpacity>
        <Text style={styles.footerNote}>You can now sign in with your account.</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background, padding: 24 },
  glow: { position: 'absolute', width: 330, height: 330, borderRadius: 165, backgroundColor: COLORS.primary, opacity: 0.075, top: '16%', alignSelf: 'center' },
  content: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  successRing: { width: 122, height: 122, borderRadius: 61, padding: 7, backgroundColor: COLORS.primary + '28', marginBottom: 29 },
  successInner: { flex: 1, borderRadius: 54, borderWidth: 3, borderColor: COLORS.primary, backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center' },
  eyebrow: { color: COLORS.primary, fontSize: 11, fontWeight: '800', letterSpacing: 2.2, marginBottom: 13 },
  title: { color: COLORS.textPrimary, fontSize: 29, lineHeight: 36, fontWeight: '900', textAlign: 'center' },
  description: { maxWidth: 340, color: COLORS.textSecondary, fontSize: 15, lineHeight: 23, textAlign: 'center', marginTop: 17 },
  statusCard: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 27, paddingHorizontal: 16, paddingVertical: 13, borderRadius: 12, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.surfaceBorder },
  statusText: { color: COLORS.textPrimary, fontSize: 13, fontWeight: '700' },
  footer: { width: '100%', paddingBottom: 12 },
  exitButton: { height: 54, borderRadius: 13, backgroundColor: COLORS.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  exitButtonText: { color: '#06110E', fontSize: 16, fontWeight: '800' },
  footerNote: { color: COLORS.textMuted, fontSize: 12, textAlign: 'center', marginTop: 13 },
});
