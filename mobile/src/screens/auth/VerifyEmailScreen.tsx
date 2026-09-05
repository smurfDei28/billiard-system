import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../context/AuthContext';
import { COLORS } from '../../constants';

const RESEND_DELAY_SECONDS = 60;

export default function VerifyEmailScreen({ navigation, route }: any) {
  const email = route.params?.email as string | undefined;
  const initialMessage = route.params?.message as string | undefined;
  const deliveryFailed = Boolean(route.params?.deliveryFailed);
  const accountExists = Boolean(route.params?.accountExists);
  const [secondsRemaining, setSecondsRemaining] = useState(deliveryFailed || accountExists ? 0 : RESEND_DELAY_SECONDS);
  const [resending, setResending] = useState(false);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState(initialMessage || 'We sent a verification link to your email address.');
  const [error, setError] = useState(deliveryFailed ? initialMessage || 'We could not send the verification email yet. Please try again.' : '');

  const canResend = secondsRemaining === 0 && !resending;
  const countdownLabel = useMemo(
    () => `Resend available in 0:${String(secondsRemaining).padStart(2, '0')}`,
    [secondsRemaining]
  );

  useEffect(() => {
    if (secondsRemaining === 0) return;
    const timer = setInterval(() => {
      setSecondsRemaining((current) => Math.max(0, current - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [secondsRemaining]);

  const resendVerification = async () => {
    if (!email || !canResend) return;
    setResending(true);
    setError('');
    try {
      await api.post('/api/auth/resend-verification', { email });
      setMessage(`A new verification link was sent to ${email}.`);
      setSecondsRemaining(RESEND_DELAY_SECONDS);
    } catch (err: any) {
      setError(err.response?.data?.error || 'We could not send the verification email. Please try again shortly.');
    } finally {
      setResending(false);
    }
  };

  const checkVerification = async () => {
    if (!email) return;
    setChecking(true);
    setError('');
    try {
      const { data } = await api.post('/api/auth/verification-status', { email });
      if (data.verified) {
        navigation.replace('EmailVerifiedSuccess');
        return;
      }
      setMessage(data.message || 'Your email is not verified yet. Open the link in your inbox, then check again.');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Unable to check verification status. Please try again.');
    } finally {
      setChecking(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.logoCircle}>
          <Text style={styles.logo}>🎱</Text>
        </View>
        <Text style={styles.title}>Verify your email</Text>
        <Text style={styles.subtitle}>One quick step before you can play.</Text>

        <View style={styles.card}>
          <View style={styles.iconCircle}>
            <Ionicons name="mail-unread-outline" size={31} color={COLORS.primary} />
          </View>
          <Text style={styles.cardTitle}>Check your inbox</Text>
          <Text style={styles.bodyText}>
            We sent a verification link to
          </Text>
          <Text style={styles.email}>{email || 'your email address'}</Text>
          <Text style={styles.bodyText}>
            Open the link to activate your account. It expires after 24 hours.
          </Text>

          {!!message && <Text style={styles.message}>{message}</Text>}
          {!!error && <Text style={styles.error}>{error}</Text>}

          <TouchableOpacity
            style={[styles.primaryButton, (checking || !email) && styles.disabledButton]}
            onPress={checkVerification}
            disabled={checking || !email}
          >
            {checking ? <ActivityIndicator color="#06110E" /> : <Text style={styles.primaryButtonText}>I’ve verified my email</Text>}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.secondaryButton, !canResend && styles.disabledSecondaryButton]}
            onPress={resendVerification}
            disabled={!canResend || !email}
          >
            {resending ? <ActivityIndicator color={COLORS.primary} /> : <Text style={[styles.secondaryButtonText, !canResend && styles.mutedText]}>Resend verification email</Text>}
          </TouchableOpacity>
          {!canResend && <Text style={styles.countdown}>{countdownLabel}</Text>}
        </View>

        <TouchableOpacity style={styles.loginLink} onPress={() => navigation.replace('Login', { email })}>
          <Ionicons name="arrow-back" size={17} color={COLORS.textSecondary} />
          <Text style={styles.loginLinkText}>Back to sign in</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  logoCircle: { width: 72, height: 72, borderRadius: 36, alignSelf: 'center', alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.surface, borderWidth: 2, borderColor: COLORS.primary, marginBottom: 18 },
  logo: { fontSize: 32 },
  title: { color: COLORS.textPrimary, fontSize: 28, fontWeight: '800', textAlign: 'center' },
  subtitle: { color: COLORS.textSecondary, fontSize: 14, textAlign: 'center', marginTop: 7, marginBottom: 28 },
  card: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.surfaceBorder, borderRadius: 18, padding: 22, alignItems: 'center' },
  iconCircle: { width: 58, height: 58, borderRadius: 29, backgroundColor: COLORS.primary + '18', alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  cardTitle: { color: COLORS.textPrimary, fontSize: 19, fontWeight: '800', marginBottom: 8 },
  bodyText: { color: COLORS.textSecondary, fontSize: 14, lineHeight: 21, textAlign: 'center' },
  email: { color: COLORS.primary, fontSize: 15, fontWeight: '700', marginVertical: 5, textAlign: 'center' },
  message: { width: '100%', color: COLORS.info, fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 18, padding: 11, borderRadius: 10, backgroundColor: COLORS.info + '12' },
  error: { width: '100%', color: COLORS.error, fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 18, padding: 11, borderRadius: 10, backgroundColor: COLORS.error + '12' },
  primaryButton: { width: '100%', height: 51, borderRadius: 12, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center', marginTop: 22 },
  primaryButtonText: { color: '#06110E', fontSize: 15, fontWeight: '800' },
  secondaryButton: { width: '100%', height: 49, borderRadius: 12, borderWidth: 1, borderColor: COLORS.primary, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  secondaryButtonText: { color: COLORS.primary, fontSize: 14, fontWeight: '700' },
  countdown: { color: COLORS.textMuted, fontSize: 12, marginTop: 9 },
  disabledButton: { opacity: 0.6 },
  disabledSecondaryButton: { borderColor: COLORS.surfaceBorder },
  mutedText: { color: COLORS.textMuted },
  loginLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 24, padding: 10 },
  loginLinkText: { color: COLORS.textSecondary, fontSize: 14, fontWeight: '600' },
});
