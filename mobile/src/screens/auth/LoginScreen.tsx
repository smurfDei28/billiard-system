import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, Alert, ActivityIndicator,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../context/AuthContext';
import { COLORS } from '../../constants';

export default function LoginScreen({ navigation }: any) {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [forgotModal, setForgotModal] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);

  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!email) newErrors.email = 'Email is required';
    else if (!/\S+@\S+\.\S+/.test(email)) newErrors.email = 'Enter a valid email';
    if (!password) newErrors.password = 'Password is required';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleLogin = async () => {
    if (!validate()) return;
    setLoading(true);
    try {
      await login(email.trim().toLowerCase(), password);
    } catch (err: any) {
      const data = err.response?.data;
      const msg = data?.error || 'Login failed. Please try again.';

      if (data?.requiresEmailVerification && data?.email) {
        navigation.navigate('VerifyEmail', {
          email: data.email,
          message: msg,
        });
      } else {
        Alert.alert('Login Failed', msg);
      }
    } finally {
      setLoading(false);
    }
  };

  const requestPasswordReset = async () => {
    const target = (forgotEmail || email).trim().toLowerCase();
    if (!target) return Alert.alert('Missing Email', 'Enter your email address first.');

    setForgotLoading(true);
    try {
      await api.post('/api/auth/forgot-password', { email: target });
      setForgotModal(false);
      setForgotEmail('');
      Alert.alert('Check your email', 'If your email is verified, we sent a password reset link.');
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.error || 'Failed to request password reset.');
    } finally {
      setForgotLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scroll} >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.logoContainer}>
            <Text style={styles.logoIcon}>🎱</Text>
          </View>
          <Text style={styles.title}>Saturday Nights</Text>
          <Text style={styles.subtitle}>Billiard Hall</Text>
          <Text style={styles.tagline}>Sign in to your account</Text>
        </View>

        {/* Form */}
        <View style={styles.form}>
          {/* Email */}
          <View style={styles.fieldContainer}>
            <Text style={styles.label}>Email Address</Text>
            <View style={[styles.inputWrapper, errors.email ? styles.inputError : null]}>
              <Ionicons name="mail-outline" size={18} color={COLORS.textMuted} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="your@email.com"
                placeholderTextColor={COLORS.textMuted}
                value={email}
                onChangeText={(t) => { setEmail(t); setErrors((e) => ({ ...e, email: '' })); }}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
            {errors.email ? <Text style={styles.errorText}>{errors.email}</Text> : null}
          </View>

          {/* Password */}
          <View style={styles.fieldContainer}>
            <Text style={styles.label}>Password</Text>
            <View style={[styles.inputWrapper, errors.password ? styles.inputError : null]}>
              <Ionicons name="lock-closed-outline" size={18} color={COLORS.textMuted} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="••••••••"
                placeholderTextColor={COLORS.textMuted}
                value={password}
                onChangeText={(t) => { setPassword(t); setErrors((e) => ({ ...e, password: '' })); }}
                secureTextEntry={!showPassword}
              />
              <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.eyeBtn}>
                <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={18} color={COLORS.textMuted} />
              </TouchableOpacity>
            </View>
            {errors.password ? <Text style={styles.errorText}>{errors.password}</Text> : null}
          </View>

          <View style={{ alignItems: 'flex-end', marginTop: -8 }}>
            <TouchableOpacity onPress={() => { setForgotEmail(email); setForgotModal(true); }}>
              <Text style={{ color: COLORS.primary, fontWeight: '700', fontSize: 13 }}>Forgot password?</Text>
            </TouchableOpacity>
          </View>

          {/* Login Button */}
          <TouchableOpacity
            style={[styles.loginBtn, loading && styles.loginBtnDisabled]}
            onPress={handleLogin}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator color="#000" />
            ) : (
              <Text style={styles.loginBtnText}>Sign In</Text>
            )}
          </TouchableOpacity>

          {/* Register Link */}
          <View style={styles.registerRow}>
            <Text style={styles.registerText}>Don't have an account? </Text>
            <TouchableOpacity onPress={() => navigation.navigate('Register')}>
              <Text style={styles.registerLink}>Register</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>

      {/* Forgot Password Modal */}
      {forgotModal && (
        <View style={{
          position: 'absolute', left: 0, right: 0, top: 0, bottom: 0,
          backgroundColor: '#000000AA', justifyContent: 'center', padding: 24,
        }}>
          <View style={{ backgroundColor: COLORS.surface, borderRadius: 16, padding: 16, gap: 12, borderWidth: 1, borderColor: COLORS.surfaceBorder }}>
            <Text style={{ fontSize: 16, fontWeight: '800', color: COLORS.textPrimary }}>Reset Password</Text>
            <Text style={{ fontSize: 13, color: COLORS.textSecondary }}>
              Enter your verified email. We’ll send a reset link.
            </Text>
            <View style={[styles.inputWrapper]}>
              <Ionicons name="mail-outline" size={18} color={COLORS.textMuted} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="your@email.com"
                placeholderTextColor={COLORS.textMuted}
                value={forgotEmail}
                onChangeText={setForgotEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
            <TouchableOpacity
              style={[styles.loginBtn, forgotLoading && styles.loginBtnDisabled]}
              onPress={requestPasswordReset}
              disabled={forgotLoading}
            >
              {forgotLoading ? <ActivityIndicator color="#000" /> : <Text style={styles.loginBtnText}>Send Reset Link</Text>}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setForgotModal(false)} style={{ alignItems: 'center', paddingVertical: 6 }}>
              <Text style={{ color: COLORS.textMuted, fontWeight: '600' }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  header: { alignItems: 'center', marginBottom: 40 },
  logoContainer: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: COLORS.surfaceLight,
    justifyContent: 'center', alignItems: 'center',
    marginBottom: 16,
    borderWidth: 2, borderColor: COLORS.primary,
  },
  logoIcon: { fontSize: 36 },
  title: { fontSize: 28, fontWeight: '800', color: COLORS.textPrimary, letterSpacing: 1 },
  subtitle: { fontSize: 16, color: COLORS.primary, fontWeight: '600', marginTop: 2 },
  tagline: { fontSize: 14, color: COLORS.textSecondary, marginTop: 8 },
  form: { gap: 16 },
  fieldContainer: { gap: 6 },
  label: { fontSize: 13, fontWeight: '600', color: COLORS.textSecondary },
  inputWrapper: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: 12, borderWidth: 1,
    borderColor: COLORS.surfaceBorder,
    paddingHorizontal: 14,
  },
  inputError: { borderColor: COLORS.error },
  inputIcon: { marginRight: 10 },
  input: {
    flex: 1, height: 50,
    color: COLORS.textPrimary,
    fontSize: 15,
  },
  eyeBtn: { padding: 4 },
  errorText: { fontSize: 12, color: COLORS.error, marginTop: 2 },
  loginBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 12, height: 52,
    justifyContent: 'center', alignItems: 'center',
    marginTop: 8,
  },
  loginBtnDisabled: { opacity: 0.6 },
  loginBtnText: { color: '#000', fontSize: 16, fontWeight: '700' },
  registerRow: { flexDirection: 'row', justifyContent: 'center', marginTop: 8 },
  registerText: { color: COLORS.textSecondary, fontSize: 14 },
  registerLink: { color: COLORS.primary, fontSize: 14, fontWeight: '700' },
});
