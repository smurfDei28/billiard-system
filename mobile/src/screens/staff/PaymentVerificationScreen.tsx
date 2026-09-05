import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../context/AuthContext';
import { API_URL, COLORS } from '../../constants';

type HistoryFilter = 'ALL' | 'SUCCESSFUL' | 'FAILED' | 'PENDING' | 'CANCELLED';

const imageUrl = (url?: string) => url?.startsWith('http') ? url : `${API_URL}${url || ''}`;
const isAcquireMockSandbox = (payment: any) => String(payment?.referenceNo || '').startsWith('ACQUIREMOCK-');
const sandboxStatus = (payment: any) => String(payment?.notes || '').match(/(?:^|\s|\|)status=(paid|failed|pending|cancelled)(?:\s|\||$)/i)?.[1]?.toLowerCase();
const transactionStatus = (payment: any) => {
  const providerStatus = isAcquireMockSandbox(payment) ? sandboxStatus(payment) : undefined;
  if (providerStatus === 'paid') return { filter: 'SUCCESSFUL' as const, label: 'Successful', color: COLORS.success };
  if (providerStatus === 'failed') return { filter: 'FAILED' as const, label: 'Failed', color: COLORS.error };
  if (providerStatus === 'cancelled') return { filter: 'CANCELLED' as const, label: 'Cancelled', color: COLORS.error };
  if (providerStatus === 'pending') return { filter: 'PENDING' as const, label: 'Pending', color: COLORS.warning };
  if (payment.status === 'APPROVED') return { filter: 'SUCCESSFUL' as const, label: 'Approved', color: COLORS.success };
  if (payment.status === 'REJECTED') return { filter: 'FAILED' as const, label: 'Rejected', color: COLORS.error };
  if (payment.status === 'NEEDS_INFORMATION') return { filter: 'PENDING' as const, label: 'More information needed', color: COLORS.warning };
  return { filter: 'PENDING' as const, label: 'Pending', color: COLORS.warning };
};

export default function PaymentVerificationScreen() {
  const [payments, setPayments] = useState<any[]>([]);
  const [filter, setFilter] = useState<HistoryFilter>('ALL');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [remarks, setRemarks] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/api/payments/review?q=${encodeURIComponent(query)}`);
      setPayments(data || []);
    } catch (err: any) {
      Alert.alert('Could not load transactions', err.response?.data?.error || 'Please check your connection and try again.');
    } finally { setLoading(false); }
  }, [query]);

  useEffect(() => { load(); }, [load]);

  const reviewManualPayment = async (id: string, decision: 'APPROVE' | 'REJECT') => {
    if (decision === 'REJECT' && !remarks[id]?.trim()) return Alert.alert('Reason required', 'Enter remarks for the member.');
    try {
      await api.patch(`/api/payments/${id}/review`, { decision, remarks: remarks[id] || '' });
      Alert.alert(decision === 'APPROVE' ? 'Payment approved' : 'Payment updated');
      load();
    } catch (err: any) { Alert.alert('Review failed', err.response?.data?.error || 'Please try again.'); }
  };

  const visiblePayments = useMemo(() => payments.filter((payment) => filter === 'ALL' || transactionStatus(payment).filter === filter), [filter, payments]);

  return <ScrollView style={s.container} contentContainerStyle={s.content}>
    <View style={s.header}><Text style={s.title}>Transaction History</Text><Text style={s.subtitle}>View member top-up and payment transactions.</Text></View>
    <View style={s.filters}>{(['ALL', 'SUCCESSFUL', 'FAILED', 'PENDING', 'CANCELLED'] as HistoryFilter[]).map((item) => <TouchableOpacity key={item} onPress={() => setFilter(item)} style={[s.filter, filter === item && s.filterActive]}><Text style={[s.filterText, filter === item && s.filterTextActive]}>{item === 'ALL' ? 'All' : item[0] + item.slice(1).toLowerCase()}</Text></TouchableOpacity>)}</View>
    <View style={s.search}><Ionicons name="search" size={18} color={COLORS.textMuted} /><TextInput value={query} onChangeText={setQuery} onSubmitEditing={load} placeholder="Search reference, member, email" placeholderTextColor={COLORS.textMuted} style={s.searchInput} returnKeyType="search" /></View>
    {loading ? <ActivityIndicator color={COLORS.primary} size="large" /> : visiblePayments.length === 0 ? <Text style={s.empty}>No transactions found.</Text> : visiblePayments.map((payment) => {
      const state = transactionStatus(payment); const sandbox = isAcquireMockSandbox(payment); const canReviewManualPayment = payment.status === 'PENDING' && !sandbox;
      const addedCredits = payment.purpose === 'CREDIT_TOPUP' && state.filter === 'SUCCESSFUL' ? `+${Number(payment.amount).toFixed(0)} Credits` : null;
      return <View key={payment.id} style={s.card}>
        <View style={s.cardTop}><View style={s.member}><Text style={s.name}>{payment.user?.firstName} {payment.user?.lastName}</Text><Text style={s.meta}>{payment.user?.email || 'Member'}</Text></View><Text style={[s.badge, { color: state.color }]}>{state.label}</Text></View>
        <Text style={s.amount}>{sandbox ? 'GCash Sandbox / Mock' : payment.method === 'GCASH' ? 'GCash' : payment.method} • ₱{Number(payment.amount).toFixed(2)}</Text>
        {addedCredits ? <Text style={s.credits}>{addedCredits}</Text> : null}
        <Text style={s.meta}>{String(payment.purpose || '').replace(/_/g, ' ')} • {new Date(payment.createdAt).toLocaleString('en-PH')}</Text>
        <Text style={s.reference}>Reference: {payment.referenceNo}</Text>
        {payment.order ? <Text style={s.reference}>Order: {payment.order.receiptNumber || payment.order.id}</Text> : null}
        {sandbox ? <Text style={s.sandbox}>AcquireMock Sandbox • Provider-controlled</Text> : null}
        {payment.notes ? <Text style={s.notes}>{payment.notes}</Text> : null}
        {payment.receiptUrl ? <Image source={{ uri: imageUrl(payment.receiptUrl) }} style={s.receipt} /> : null}
        {canReviewManualPayment ? <View style={s.manualReview}><Text style={s.manualReviewText}>Manual proof payment — staff review required.</Text><TextInput value={remarks[payment.id] || ''} onChangeText={(text) => setRemarks({ ...remarks, [payment.id]: text })} placeholder="Staff remarks (required for rejection)" placeholderTextColor={COLORS.textMuted} style={s.input} /><View style={s.actions}><TouchableOpacity style={s.reject} onPress={() => reviewManualPayment(payment.id, 'REJECT')}><Text style={s.rejectText}>Reject</Text></TouchableOpacity><TouchableOpacity style={s.approve} onPress={() => reviewManualPayment(payment.id, 'APPROVE')}><Text style={s.approveText}>Approve</Text></TouchableOpacity></View></View> : payment.reviewerRemarks ? <Text style={s.notes}>Staff remarks: {payment.reviewerRemarks}</Text> : null}
      </View>;
    })}
  </ScrollView>;
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background }, content: { padding: 16, gap: 12, paddingBottom: 30 }, header: { paddingTop: 48 }, title: { fontSize: 24, fontWeight: '800', color: COLORS.textPrimary }, subtitle: { color: COLORS.textSecondary, marginTop: 4 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 }, filter: { paddingHorizontal: 10, paddingVertical: 8, backgroundColor: COLORS.surface, borderRadius: 9, borderWidth: 1, borderColor: COLORS.surfaceBorder }, filterActive: { borderColor: COLORS.primary, backgroundColor: COLORS.primary + '18' }, filterText: { fontSize: 10, fontWeight: '800', color: COLORS.textMuted }, filterTextActive: { color: COLORS.primary },
  search: { height: 45, backgroundColor: COLORS.surfaceLight, borderColor: COLORS.surfaceBorder, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, alignItems: 'center', flexDirection: 'row', gap: 8 }, searchInput: { flex: 1, color: COLORS.textPrimary }, empty: { color: COLORS.textMuted, textAlign: 'center', marginTop: 30 },
  card: { backgroundColor: COLORS.surface, borderColor: COLORS.surfaceBorder, borderWidth: 1, borderRadius: 15, padding: 14, gap: 8 }, cardTop: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 }, member: { flex: 1 }, name: { color: COLORS.textPrimary, fontWeight: '800', fontSize: 16 }, meta: { color: COLORS.textMuted, fontSize: 12 }, amount: { color: COLORS.primary, fontWeight: '800' }, credits: { color: COLORS.success, fontWeight: '800' }, badge: { fontSize: 11, fontWeight: '900', textAlign: 'right' }, reference: { color: COLORS.textSecondary, fontSize: 12 }, sandbox: { color: COLORS.gold, fontSize: 12, fontWeight: '800' }, notes: { color: COLORS.textSecondary, fontSize: 12 }, receipt: { height: 220, width: '100%', resizeMode: 'contain', backgroundColor: COLORS.surfaceLight, borderRadius: 10 },
  manualReview: { gap: 8, paddingTop: 4, borderTopWidth: 1, borderColor: COLORS.surfaceBorder }, manualReviewText: { color: COLORS.textMuted, fontSize: 12 }, input: { height: 44, borderRadius: 9, borderWidth: 1, borderColor: COLORS.surfaceBorder, backgroundColor: COLORS.surfaceLight, paddingHorizontal: 12, color: COLORS.textPrimary }, actions: { flexDirection: 'row', gap: 7 }, approve: { flex: 1, height: 45, borderRadius: 10, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.primary }, reject: { flex: 1, height: 45, borderRadius: 10, justifyContent: 'center', alignItems: 'center', borderColor: COLORS.error, borderWidth: 1 }, approveText: { fontWeight: '800', color: '#00150f', fontSize: 11 }, rejectText: { fontWeight: '800', color: COLORS.error, fontSize: 11 },
});
