import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, Alert, ActivityIndicator,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { COLORS } from '../../constants';

// ─── Field component OUTSIDE RegisterScreen so it doesn't get recreated on every keystroke ───
const Field = ({
  label, field, placeholder, keyboardType = 'default',
  secureTextEntry = false, hint = '', value, onChangeText, error,
}: any) => (
  <View style={styles.fieldContainer}>
    <Text style={styles.label}>{label}</Text>
    <View style={[styles.inputWrapper, error && styles.inputError]}>
      <TextInput
        style={styles.input}
        placeholder={placeholder}
        placeholderTextColor={COLORS.textMuted}
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        autoCapitalize={field === 'email' || field === 'password' || field === 'confirmPassword' ? 'none' : 'words'}
        secureTextEntry={secureTextEntry}
        autoCorrect={false}
      />
    </View>
    {hint && !error ? <Text style={styles.hint}>{hint}</Text> : null}
    {error ? <Text style={styles.errorText}>{error}</Text> : null}
  </View>
);

export default function RegisterScreen({ navigation }: any) {
  const { register } = useAuth();
  const [form, setForm] = useState({
    firstName: '', lastName: '', email: '',
    phone: '', password: '', confirmPassword: '',
    dateOfBirth: '', displayName: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const update = (field: string, value: string) => {
    setForm((f) => ({ ...f, [field]: value }));
    setErrors((e) => ({ ...e, [field]: '' }));
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.firstName.trim()) e.firstName = 'First name is required';
    if (!form.lastName.trim()) e.lastName = 'Last name is required';
    if (!form.email) e.email = 'Email is required';
    else if (!/\S+@\S+\.\S+/.test(form.email)) e.email = 'Enter a valid email';
    if (!form.phone) e.phone = 'Phone number is required';
    else if (!/^(\+63|0)[0-9]{10}$/.test(form.phone)) e.phone = 'Enter a valid PH phone number (e.g. 09171234567)';
    if (!form.password) e.password = 'Password is required';
    else if (form.password.length < 8) e.password = 'At least 8 characters';
    else if (!/[A-Z]/.test(form.password)) e.password = 'Must include an uppercase letter';
    else if (!/[0-9]/.test(form.password)) e.password = 'Must include a number';
    if (form.password !== form.confirmPassword) e.confirmPassword = 'Passwords do not match';
    if (form.dateOfBirth && !/^\d{4}-\d{2}-\d{2}$/.test(form.dateOfBirth)) e.dateOfBirth = 'Use format YYYY-MM-DD';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleRegister = async () => {
    if (!validate()) return;
    setLoading(true);
    try {
      await register({
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim().toLowerCase(),
        phone: form.phone.trim(),
        password: form.password,
        dateOfBirth: form.dateOfBirth || undefined,
        displayName: form.displayName.trim() || undefined,
      });
    } catch (err: any) {
      const msg = err.response?.data?.error || 'Registration failed. Please try again.';
      Alert.alert('Registration Failed', msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.title}>Create Account</Text>
          <Text style={styles.subtitle}>Join Saturday Nights Billiard</Text>
        </View>

        {/* Form */}
        <View style={styles.form}>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Field
                label="First Name" field="firstName" placeholder="Juan"
                value={form.firstName} onChangeText={(t: string) => update('firstName', t)}
                error={errors.firstName}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Field
                label="Last Name" field="lastName" placeholder="dela Cruz"
                value={form.lastName} onChangeText={(t: string) => update('lastName', t)}
                error={errors.lastName}
              />
            </View>
          </View>

          <Field
            label="Display Name (optional)" field="displayName" placeholder="JuanShark"
            hint="This shows on your gamified profile"
            value={form.displayName} onChangeText={(t: string) => update('displayName', t)}
            error={errors.displayName}
          />

          <Field
            label="Email Address" field="email" placeholder="juan@email.com"
            keyboardType="email-address"
            value={form.email} onChangeText={(t: string) => update('email', t)}
            error={errors.email}
          />

          <Field
            label="Phone Number" field="phone" placeholder="09171234567"
            keyboardType="phone-pad" hint="Philippine number format"
            value={form.phone} onChangeText={(t: string) => update('phone', t)}
            error={errors.phone}
          />

          <Field
            label="Date of Birth (optional)" field="dateOfBirth" placeholder="YYYY-MM-DD"
            hint="Get a free hour on your birthday! 🎂"
            value={form.dateOfBirth} onChangeText={(t: string) => update('dateOfBirth', t)}
            error={errors.dateOfBirth}
          />

          {/* Password with show/hide */}
          <View style={styles.fieldContainer}>
            <Text style={styles.label}>Password</Text>
            <View style={[styles.inputWrapper, errors.password && styles.inputError]}>
              <TextInput
                style={styles.input}
                placeholder="Min 8 chars, 1 uppercase, 1 number"
                placeholderTextColor={COLORS.textMuted}
                value={form.password}
                onChangeText={(t) => update('password', t)}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.eyeBtn}>
                <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={18} color={COLORS.textMuted} />
              </TouchableOpacity>
            </View>
            {errors.password ? <Text style={styles.errorText}>{errors.password}</Text> : null}
          </View>

          <View style={styles.fieldContainer}>
            <Text style={styles.label}>Confirm Password</Text>
            <View style={[styles.inputWrapper, errors.confirmPassword && styles.inputError]}>
              <TextInput
                style={styles.input}
                placeholder="Repeat your password"
                placeholderTextColor={COLORS.textMuted}
                value={form.confirmPassword}
                onChangeText={(t) => update('confirmPassword', t)}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
            {errors.confirmPassword ? <Text style={styles.errorText}>{errors.confirmPassword}</Text> : null}
          </View>

          {/* Membership note */}
          <View style={styles.membershipNote}>
            <Ionicons name="information-circle-outline" size={16} color={COLORS.primary} />
            <Text style={styles.membershipNoteText}>
              Registering gives you a Basic Membership. You can join tournaments, earn loyalty rewards, and top-up credits.
            </Text>
          </View>

          <TouchableOpacity
            style={[styles.registerBtn, loading && styles.registerBtnDisabled]}
            onPress={handleRegister}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator color="#000" />
            ) : (
              <Text style={styles.registerBtnText}>Create Account</Text>
            )}
          </TouchableOpacity>

          <View style={styles.loginRow}>
            <Text style={styles.loginText}>Already have an account? </Text>
            <TouchableOpacity onPress={() => navigation.navigate('Login')}>
              <Text style={styles.loginLink}>Sign In</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  scroll: { flexGrow: 1, padding: 24, paddingTop: 60 },
  header: { marginBottom: 32 },
  backBtn: { marginBottom: 16 },
  title: { fontSize: 26, fontWeight: '800', color: COLORS.textPrimary },
  subtitle: { fontSize: 14, color: COLORS.textSecondary, marginTop: 4 },
  form: { gap: 14 },
  row: { flexDirection: 'row', gap: 12 },
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
  input: { flex: 1, height: 50, color: COLORS.textPrimary, fontSize: 15 },
  eyeBtn: { padding: 4 },
  hint: { fontSize: 11, color: COLORS.textMuted },
  errorText: { fontSize: 12, color: COLORS.error },
  membershipNote: {
    flexDirection: 'row', gap: 8,
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: COLORS.primary + '40',
  },
  membershipNoteText: { flex: 1, fontSize: 12, color: COLORS.textSecondary, lineHeight: 18 },
  registerBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 12, height: 52,
    justifyContent: 'center', alignItems: 'center',
    marginTop: 8,
  },
  registerBtnDisabled: { opacity: 0.6 },
  registerBtnText: { color: '#000', fontSize: 16, fontWeight: '700' },
  loginRow: { flexDirection: 'row', justifyContent: 'center' },
  loginText: { color: COLORS.textSecondary, fontSize: 14 },
  loginLink: { color: COLORS.primary, fontSize: 14, fontWeight: '700' },
});
