import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  RefreshControl, ActivityIndicator, Alert, Modal, TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../context/AuthContext';
import { COLORS } from '../../constants';

const STATUS_COLORS: Record<string, string> = {
  PENDING: '#f59e0b',
  APPROVED: COLORS.success,
  DECLINED: COLORS.error,
  CANCELLED: COLORS.textMuted,
  COMPLETED: COLORS.info,
};

export default function StaffReservationScreen() {
  const [reservations, setReservations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<'PENDING' | 'ALL'>('PENDING');
  const [declineModal, setDeclineModal] = useState<{ id: string; name: string } | null>(null);
  const [declineNote, setDeclineNote] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  const fetchReservations = useCallback(async () => {
    try {
      const url = filter === 'PENDING'
        ? '/api/reservations/pending'
        : '/api/reservations';
      const res = await api.get(url);
      setReservations(res.data);
    } catch {}
    finally { setLoading(false); setRefreshing(false); }
  }, [filter]);

  useEffect(() => { fetchReservations(); }, [filter]);

  const approveReservation = async (id: string, memberName: string) => {
    Alert.alert(
      'Approve Reservation',
      `Approve ${memberName}'s reservation?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Approve', onPress: async () => {
            setActionLoading(true);
            try {
              await api.patch(`/api/reservations/${id}/approve`);
              Alert.alert('✅ Approved', `${memberName} has been notified.`);
              fetchReservations();
            } catch (err: any) {
              Alert.alert('Error', err.response?.data?.error || 'Failed to approve');
            } finally { setActionLoading(false); }
          }
        }
      ]
    );
  };

  const submitDecline = async () => {
    if (!declineModal) return;
    setActionLoading(true);
    try {
      await api.patch(`/api/reservations/${declineModal.id}/decline`, {
        declineNote: declineNote.trim() || undefined,
      });
      Alert.alert('Declined', `${declineModal.name}'s reservation has been declined and they have been notified.`);
      setDeclineModal(null);
      setDeclineNote('');
      fetchReservations();
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.error || 'Failed to decline');
    } finally { setActionLoading(false); }
  };

  if (loading) return (
    <View style={s.center}><ActivityIndicator size="large" color={COLORS.primary} /></View>
  );

  return (
    <View style={s.container}>
      <View style={s.header}>
        <Text style={s.title}>📅 Reservations</Text>
        <View style={s.filterRow}>
          {(['PENDING', 'ALL'] as const).map((f) => (
            <TouchableOpacity
              key={f}
              style={[s.filterBtn, filter === f && s.filterBtnActive]}
              onPress={() => setFilter(f)}
            >
              <Text style={[s.filterTxt, filter === f && s.filterTxtActive]}>{f}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={s.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchReservations(); }} tintColor={COLORS.primary} />}
      >
        {reservations.length === 0 && (
          <View style={s.empty}>
            <Text style={s.emptyTxt}>{filter === 'PENDING' ? 'No pending reservations 🎉' : 'No reservations found.'}</Text>
          </View>
        )}
        {reservations.map((r: any) => (
          <View key={r.id} style={s.card}>
            <View style={s.cardTop}>
              <View style={s.memberInfo}>
                <Text style={s.memberName}>{r.user?.firstName} {r.user?.lastName}</Text>
                <Text style={s.memberContact}>{r.user?.phone} · {r.user?.email}</Text>
              </View>
              <View style={[s.statusBadge, { backgroundColor: STATUS_COLORS[r.status] + '25' }]}>
                <Text style={[s.statusTxt, { color: STATUS_COLORS[r.status] }]}>{r.status}</Text>
              </View>
            </View>

            <View style={s.tableInfo}>
              <Ionicons name="tablet-portrait-outline" size={14} color={COLORS.textMuted} />
              <Text style={s.tableInfoTxt}>
                Table {r.table?.tableNumber} ({r.table?.type}) · ₱{r.table?.ratePerHour}/hr
              </Text>
            </View>

            <View style={s.timeInfo}>
              <Ionicons name="time-outline" size={14} color={COLORS.textMuted} />
              <Text style={s.timeInfoTxt}>
                {new Date(r.startTime).toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' })}{' '}
                {new Date(r.startTime).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })}
                {' → '}
                {new Date(r.endTime).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })}
              </Text>
            </View>

            {r.notes && <Text style={s.notes}>📝 {r.notes}</Text>}

            {r.status === 'PENDING' && (
              <View style={s.actions}>
                <TouchableOpacity
                  style={s.approveBtn}
                  onPress={() => approveReservation(r.id, `${r.user?.firstName} ${r.user?.lastName}`)}
                  disabled={actionLoading}
                >
                  <Ionicons name="checkmark" size={16} color="#fff" />
                  <Text style={s.approveTxt}>Approve</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={s.declineBtn}
                  onPress={() => setDeclineModal({ id: r.id, name: `${r.user?.firstName} ${r.user?.lastName}` })}
                  disabled={actionLoading}
                >
                  <Ionicons name="close" size={16} color={COLORS.error} />
                  <Text style={s.declineTxt}>Decline</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        ))}
      </ScrollView>

      {/* Decline Modal */}
      <Modal visible={!!declineModal} transparent animationType="fade">
        <View style={s.overlay}>
          <View style={s.dialogBox}>
            <Text style={s.dialogTitle}>Decline Reservation</Text>
            <Text style={s.dialogBody}>
              Decline <Text style={{ fontWeight: '700' }}>{declineModal?.name}</Text>'s reservation? They will be notified.
            </Text>
            <View style={s.fieldGroup}>
              <Text style={s.fieldLabel}>Reason (optional)</Text>
              <TextInput
                style={s.noteInput}
                value={declineNote}
                onChangeText={setDeclineNote}
                placeholder="e.g. Table not available at that time"
                placeholderTextColor={COLORS.textMuted}
              />
            </View>
            <View style={s.dialogActions}>
              <TouchableOpacity style={s.dialogBack} onPress={() => { setDeclineModal(null); setDeclineNote(''); }}>
                <Text style={s.dialogBackTxt}>Back</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.dialogDecline} onPress={submitDecline} disabled={actionLoading}>
                {actionLoading ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.dialogDeclineTxt}>Decline</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background },
  header: { paddingTop: 60, paddingHorizontal: 20, paddingBottom: 14, backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.surfaceBorder, gap: 12 },
  title: { fontSize: 22, fontWeight: '800', color: COLORS.textPrimary },
  filterRow: { flexDirection: 'row', gap: 8 },
  filterBtn: { paddingHorizontal: 16, paddingVertical: 7, borderRadius: 20, borderWidth: 1, borderColor: COLORS.surfaceBorder, backgroundColor: COLORS.surface },
  filterBtnActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  filterTxt: { fontSize: 13, fontWeight: '600', color: COLORS.textMuted },
  filterTxtActive: { color: '#000' },
  list: { padding: 16, gap: 12 },
  card: { backgroundColor: COLORS.surface, borderRadius: 16, padding: 16, gap: 10, borderWidth: 1, borderColor: COLORS.surfaceBorder },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  memberInfo: { flex: 1 },
  memberName: { fontSize: 15, fontWeight: '700', color: COLORS.textPrimary },
  memberContact: { fontSize: 12, color: COLORS.textMuted },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  statusTxt: { fontSize: 11, fontWeight: '700' },
  tableInfo: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tableInfoTxt: { fontSize: 13, color: COLORS.textSecondary },
  timeInfo: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  timeInfoTxt: { fontSize: 13, color: COLORS.textSecondary },
  notes: { fontSize: 12, color: COLORS.textMuted },
  actions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  approveBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: COLORS.success, borderRadius: 10, paddingVertical: 10 },
  approveTxt: { color: '#fff', fontWeight: '700', fontSize: 14 },
  declineBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 10, paddingVertical: 10, borderWidth: 1, borderColor: COLORS.error },
  declineTxt: { color: COLORS.error, fontWeight: '700', fontSize: 14 },
  empty: { padding: 40, alignItems: 'center' },
  emptyTxt: { color: COLORS.textMuted, fontSize: 14 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  dialogBox: { backgroundColor: COLORS.surface, borderRadius: 18, padding: 22, gap: 14, width: '100%' },
  dialogTitle: { fontSize: 17, fontWeight: '800', color: COLORS.textPrimary },
  dialogBody: { fontSize: 14, color: COLORS.textSecondary, lineHeight: 21 },
  fieldGroup: { gap: 6 },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: COLORS.textSecondary },
  noteInput: { borderWidth: 1, borderColor: COLORS.surfaceBorder, borderRadius: 10, paddingHorizontal: 12, height: 46, color: COLORS.textPrimary, fontSize: 14 },
  dialogActions: { flexDirection: 'row', gap: 10 },
  dialogBack: { flex: 1, height: 44, borderRadius: 10, borderWidth: 1, borderColor: COLORS.surfaceBorder, justifyContent: 'center', alignItems: 'center' },
  dialogBackTxt: { color: COLORS.textSecondary, fontWeight: '600' },
  dialogDecline: { flex: 1, height: 44, borderRadius: 10, backgroundColor: COLORS.error, justifyContent: 'center', alignItems: 'center' },
  dialogDeclineTxt: { color: '#fff', fontWeight: '700' },
});
