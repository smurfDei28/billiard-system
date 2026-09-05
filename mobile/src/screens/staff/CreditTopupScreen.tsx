// CreditTopupScreen.tsx
import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput, Alert, ActivityIndicator, KeyboardAvoidingView, Platform, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../context/AuthContext';
import { COLORS } from '../../constants';

const QUICK_AMOUNTS = [50, 100, 200, 300, 500, 1000];
export default function CreditTopupScreen() {
  const [searchQuery, setSearchQuery] = useState('');
  const [foundMember, setFoundMember] = useState<any>(null);
  const [memberResults, setMemberResults] = useState<any[]>([]);
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [confirmVisible, setConfirmVisible] = useState(false);

  // Typeahead member search (username/displayName, name, email, phone)
  React.useEffect(() => {
    const q = searchQuery.trim();
    if (!q) {
      setMemberResults([]);
      return;
    }

    const handle = setTimeout(async () => {
      try {
        const res = await api.get(`/api/users/search?q=${encodeURIComponent(q)}&role=MEMBER`);
        setMemberResults(Array.isArray(res.data) ? res.data : []);
      } catch {
        // ignore typeahead errors
      }
    }, 250);

    return () => clearTimeout(handle);
  }, [searchQuery]);

  const searchMember = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    setFoundMember(null);
    try {
      const res = await api.get(`/api/users/search?q=${encodeURIComponent(searchQuery.trim())}&role=MEMBER`);
      const results = Array.isArray(res.data) ? res.data : [];
      setMemberResults(results);
      if (results.length === 1) {
        setFoundMember(results[0]);
        setMemberResults([]);
      } else if (results.length === 0) {
        Alert.alert('Not Found', 'No member found for that search.');
      }
    } catch { Alert.alert('Error', 'Search failed'); }
    finally { setSearching(false); }
  };

  const requestTopup = () => {
    if (!foundMember) return Alert.alert('Error', 'Search for a member first');
    const amt = Number(amount);
    if (!Number.isInteger(amt) || amt <= 0) return Alert.alert('Error', 'Enter a whole-number cash amount greater than zero.');
    setConfirmVisible(true);
  };

  const topup = async () => {
    if (!foundMember) return Alert.alert('Error', 'Search for a member first');
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return Alert.alert('Error', 'Enter a valid amount');
    if (amt < 1) return Alert.alert('Error', 'Minimum top-up is ₱1');

    if (!Number.isInteger(amt)) return Alert.alert('Error', 'Enter a whole-number cash amount greater than zero.');
    setLoading(true);
    try {
      const res = await api.post('/api/credits/topup', {
        userId: foundMember.id,
        amount: amt,
        paymentMethod: 'CASH',
      });
      Alert.alert(
        '✅ Top-up Successful',
        `Added ₱${amt} credits to ${foundMember.firstName}'s account.\nNew balance: ${res.data.balance} credits`
      );
      // Refresh member data
      const updatedMember = { ...foundMember, membership: { ...foundMember.membership, creditBalance: res.data.balance } };
      setFoundMember(updatedMember);
      setAmount('');
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.error || 'Top-up failed');
    } finally { setLoading(false); setConfirmVisible(false); }
  };

  return (
    <KeyboardAvoidingView style={s.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={s.header}>
        <Text style={s.title}>💳 Credit Top-up</Text>
        <Text style={s.subtitle}>Confirm cash received before adding member credits</Text>
      </View>

      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.content} >
        {/* Search Member */}
        <View style={s.card}>
          <Text style={s.cardTitle}>Find Member</Text>
          <View style={s.searchRow}>
            <TextInput
              style={s.searchInput}
              placeholder="Name, email, or phone..."
              placeholderTextColor={COLORS.textMuted}
              value={searchQuery}
              onChangeText={(t) => { setSearchQuery(t); setFoundMember(null); }}
              onSubmitEditing={searchMember}
            />
            <TouchableOpacity style={s.searchBtn} onPress={searchMember} disabled={searching}>
              {searching ? <ActivityIndicator color={COLORS.textPrimary} size="small" /> : <Ionicons name="search" size={20} color={COLORS.textPrimary} />}
            </TouchableOpacity>
          </View>

          {!foundMember && memberResults.length > 0 && (
            <View style={s.searchResults}>
              {memberResults.slice(0, 8).map((m: any) => (
                <TouchableOpacity
                  key={m.id}
                  style={s.searchResultRow}
                  onPress={() => { setFoundMember(m); setSearchQuery(m.gamifiedProfile?.displayName || m.email); setMemberResults([]); }}
                >
                  <Ionicons name="person-circle" size={22} color={COLORS.textMuted} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.searchResultName}>
                      {m.gamifiedProfile?.displayName || `${m.firstName} ${m.lastName}`}
                    </Text>
                    <Text style={s.searchResultMeta} numberOfLines={1}>
                      {m.email} · {m.phone}
                    </Text>
                  </View>
                  <Text style={s.searchResultCredits}>{(m.membership?.creditBalance || 0).toFixed(0)}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {foundMember && (
            <View style={s.memberCard}>
              <View style={s.memberAvatar}>
                <Text style={s.memberAvatarTxt}>{foundMember.firstName?.charAt(0)}{foundMember.lastName?.charAt(0)}</Text>
              </View>
              <View style={s.memberInfo}>
                <Text style={s.memberName}>{foundMember.firstName} {foundMember.lastName}</Text>
                <Text style={s.memberEmail}>{foundMember.email}</Text>
                <Text style={s.memberPhone}>{foundMember.phone}</Text>
                <View style={s.memberBalance}>
                  <Ionicons name="wallet" size={14} color={COLORS.primary} />
                  <Text style={s.memberBalanceTxt}>
                    {foundMember.membership?.creditBalance?.toFixed(0) || 0} credits
                    (PHP value)
                  </Text>
                </View>
                <View style={s.memberPlan}>
                  <Text style={s.memberPlanTxt}>📋 {foundMember.membership?.plan || 'BASIC'} · {foundMember.gamifiedProfile?.rank || 'Rookie'}</Text>
                </View>
              </View>
            </View>
          )}
        </View>

        {foundMember && (
          <>
            {/* Amount */}
            <View style={s.card}>
              <Text style={s.cardTitle}>Cash Amount / Credits to Add</Text>
              <Text style={s.cardHint}>1 Credit = PHP 1</Text>
              <TextInput
                style={s.amountInput}
                placeholder="0"
                placeholderTextColor={COLORS.textMuted}
                value={amount}
                onChangeText={(value) => setAmount(value.replace(/[^0-9]/g, ''))}
                keyboardType="number-pad"
              />
              <Text style={s.amountSub}>
                {amount && !isNaN(Number(amount))
                  ? `= PHP ${Number(amount).toFixed(2)} in credits`
                  : 'Enter amount above'}
              </Text>

              <Text style={s.quickLabel}>Quick Amounts</Text>
              <View style={s.quickRow}>
                {QUICK_AMOUNTS.map(q => (
                  <TouchableOpacity key={q} style={[s.quickBtn, amount === String(q) && s.quickBtnActive]} onPress={() => setAmount(String(q))}>
                    <Text style={[s.quickBtnTxt, amount === String(q) && s.quickBtnTxtActive]}>₱{q}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Payment Method */}
            <View style={s.card}>
              <Text style={s.cardTitle}>Payment Method</Text>
              <View style={s.cashOnly}>
                <Ionicons name="cash-outline" size={22} color={COLORS.primary} />
                <View style={s.cashOnlyCopy}>
                  <Text style={s.cashOnlyTitle}>Cash received at the counter</Text>
                  <Text style={s.cashOnlyHint}>Credits are added only after staff confirmation.</Text>
                </View>
              </View>
            </View>

            {/* Summary & Confirm */}
            {amount && Number(amount) > 0 && (
              <View style={s.summary}>
                <Text style={s.summaryTitle}>Summary</Text>
                <View style={s.summaryRow}><Text style={s.summaryLabel}>Member</Text><Text style={s.summaryVal}>{foundMember.firstName} {foundMember.lastName}</Text></View>
                <View style={s.summaryRow}><Text style={s.summaryLabel}>Amount</Text><Text style={[s.summaryVal, { color: COLORS.primary }]}>₱{Number(amount).toFixed(2)}</Text></View>
                <View style={s.summaryRow}><Text style={s.summaryLabel}>Credits Added</Text><Text style={[s.summaryVal, { color: COLORS.success }]}>+{Number(amount).toFixed(0)}</Text></View>
                <View style={s.summaryRow}><Text style={s.summaryLabel}>New Balance</Text><Text style={s.summaryVal}>{((foundMember.membership?.creditBalance || 0) + Number(amount)).toFixed(0)} credits</Text></View>
                <View style={s.summaryRow}><Text style={s.summaryLabel}>Payment</Text><Text style={s.summaryVal}>CASH</Text></View>
              </View>
            )}

            <TouchableOpacity style={[s.topupBtn, (loading || !amount) && s.topupBtnDis]} onPress={requestTopup} disabled={loading || !amount}>
              {loading ? <ActivityIndicator color="#000" /> : (
                <><Ionicons name="cash-outline" size={20} color="#000" /><Text style={s.topupBtnTxt}>Confirm Cash Top-Up</Text></>
              )}
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
      <Modal visible={confirmVisible} transparent animationType="fade" onRequestClose={() => setConfirmVisible(false)}>
        <View style={s.overlay}>
          <View style={s.confirmModal}>
            <Text style={s.confirmTitle}>Confirm Cash Credit Top-Up?</Text>
            <Text style={s.confirmText}>
              Confirm that PHP {Number(amount).toFixed(0)} cash was received from {foundMember?.firstName} {foundMember?.lastName} before adding the same number of credits.
            </Text>
            <View style={s.confirmActions}>
              <TouchableOpacity style={s.cancelBtn} onPress={() => setConfirmVisible(false)} disabled={loading}>
                <Text style={s.cancelBtnTxt}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.confirmBtn, loading && s.topupBtnDis]} onPress={topup} disabled={loading}>
                {loading ? <ActivityIndicator color="#000" /> : <Text style={s.confirmBtnTxt}>Confirm</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { paddingTop: 60, paddingHorizontal: 20, paddingBottom: 16, backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.surfaceBorder },
  title: { fontSize: 22, fontWeight: '800', color: COLORS.textPrimary },
  subtitle: { fontSize: 13, color: COLORS.textSecondary },
  content: { padding: 16, gap: 14 },
  card: { backgroundColor: COLORS.surface, borderRadius: 16, padding: 16, gap: 12, borderWidth: 1, borderColor: COLORS.surfaceBorder },
  cardTitle: { fontSize: 15, fontWeight: '700', color: COLORS.textPrimary },
  cardHint: { fontSize: 12, color: COLORS.textMuted },
  searchRow: { flexDirection: 'row', gap: 10 },
  searchInput: { flex: 1, backgroundColor: COLORS.surfaceLight, borderRadius: 10, paddingHorizontal: 14, height: 46, color: COLORS.textPrimary, borderWidth: 1, borderColor: COLORS.surfaceBorder },
  searchBtn: { width: 46, height: 46, backgroundColor: COLORS.surfaceLight, borderRadius: 10, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: COLORS.surfaceBorder },
  searchResults: { backgroundColor: COLORS.surfaceLight, borderRadius: 12, borderWidth: 1, borderColor: COLORS.surfaceBorder, overflow: 'hidden' },
  searchResultRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderBottomWidth: 1, borderBottomColor: COLORS.surfaceBorder },
  searchResultName: { fontSize: 13, fontWeight: '700', color: COLORS.textPrimary },
  searchResultMeta: { fontSize: 11, color: COLORS.textMuted },
  searchResultCredits: { fontSize: 12, fontWeight: '800', color: COLORS.primary, minWidth: 40, textAlign: 'right' },
  memberCard: { flexDirection: 'row', gap: 12, backgroundColor: COLORS.surfaceLight, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: COLORS.primary + '40' },
  memberAvatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: COLORS.primary + '20', justifyContent: 'center', alignItems: 'center' },
  memberAvatarTxt: { fontSize: 16, fontWeight: '800', color: COLORS.primary },
  memberInfo: { flex: 1, gap: 3 },
  memberName: { fontSize: 16, fontWeight: '800', color: COLORS.textPrimary },
  memberEmail: { fontSize: 12, color: COLORS.textSecondary },
  memberPhone: { fontSize: 12, color: COLORS.textMuted },
  memberBalance: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  memberBalanceTxt: { fontSize: 13, fontWeight: '700', color: COLORS.primary },
  memberPlan: {},
  memberPlanTxt: { fontSize: 11, color: COLORS.textMuted },
  amountInput: { fontSize: 48, fontWeight: '900', color: COLORS.primary, textAlign: 'center', borderBottomWidth: 2, borderBottomColor: COLORS.primary, paddingVertical: 8 },
  amountSub: { fontSize: 13, color: COLORS.textSecondary, textAlign: 'center' },
  quickLabel: { fontSize: 13, fontWeight: '600', color: COLORS.textSecondary },
  quickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  quickBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: COLORS.surfaceLight, borderWidth: 1, borderColor: COLORS.surfaceBorder },
  quickBtnActive: { backgroundColor: COLORS.primary + '20', borderColor: COLORS.primary },
  quickBtnTxt: { fontSize: 13, fontWeight: '700', color: COLORS.textMuted },
  quickBtnTxtActive: { color: COLORS.primary },
  cashOnly: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: COLORS.primary + '12', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: COLORS.primary + '45' },
  cashOnlyCopy: { flex: 1, gap: 2 },
  cashOnlyTitle: { fontSize: 13, fontWeight: '700', color: COLORS.textPrimary },
  cashOnlyHint: { fontSize: 12, color: COLORS.textSecondary },
  payRow: { flexDirection: 'row', gap: 8 },
  payBtn: { flex: 1, alignItems: 'center', gap: 4, backgroundColor: COLORS.surfaceLight, borderRadius: 10, padding: 10, borderWidth: 1, borderColor: COLORS.surfaceBorder },
  payBtnActive: { borderColor: COLORS.primary, backgroundColor: COLORS.primary + '15' },
  payIcon: { fontSize: 18 },
  payTxt: { fontSize: 10, color: COLORS.textMuted, fontWeight: '600' },
  payTxtActive: { color: COLORS.primary },
  refInput: { backgroundColor: COLORS.surfaceLight, borderRadius: 10, paddingHorizontal: 14, height: 44, color: COLORS.textPrimary, borderWidth: 1, borderColor: COLORS.surfaceBorder },
  summary: { backgroundColor: COLORS.surface, borderRadius: 16, padding: 16, gap: 10, borderWidth: 1, borderColor: COLORS.surfaceBorder },
  summaryTitle: { fontSize: 15, fontWeight: '700', color: COLORS.textPrimary, marginBottom: 4 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between' },
  summaryLabel: { fontSize: 13, color: COLORS.textMuted },
  summaryVal: { fontSize: 13, fontWeight: '700', color: COLORS.textPrimary },
  topupBtn: { backgroundColor: COLORS.primary, borderRadius: 14, height: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  topupBtnDis: { opacity: 0.5 },
  topupBtnTxt: { color: '#000', fontWeight: '800', fontSize: 16 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'center', padding: 24 },
  confirmModal: { backgroundColor: COLORS.surface, borderRadius: 16, padding: 20, gap: 14, borderWidth: 1, borderColor: COLORS.surfaceBorder },
  confirmTitle: { color: COLORS.textPrimary, fontSize: 18, fontWeight: '800' },
  confirmText: { color: COLORS.textSecondary, fontSize: 14, lineHeight: 20 },
  confirmActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  cancelBtn: { minHeight: 44, paddingHorizontal: 16, justifyContent: 'center', alignItems: 'center', borderRadius: 10, borderWidth: 1, borderColor: COLORS.surfaceBorder },
  cancelBtnTxt: { color: COLORS.textSecondary, fontWeight: '700' },
  confirmBtn: { minHeight: 44, paddingHorizontal: 18, justifyContent: 'center', alignItems: 'center', borderRadius: 10, backgroundColor: COLORS.primary },
  confirmBtnTxt: { color: '#000', fontWeight: '800' },
});
