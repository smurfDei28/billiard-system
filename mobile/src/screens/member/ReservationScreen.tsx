import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  RefreshControl, ActivityIndicator, Alert, Modal, TextInput, Platform,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
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

// ✅ All valid Ionicons names — 'ban' was causing the crash
const STATUS_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  PENDING: 'time-outline',
  APPROVED: 'checkmark-circle',
  DECLINED: 'close-circle',
  CANCELLED: 'close-circle-outline',
  COMPLETED: 'checkmark-done-circle',
};

// ─── DatePickerField ──────────────────────────────────────────────────────────
const DatePickerField = ({
  label, value, onChange, minimumDate,
}: {
  label: string;
  value: Date;
  onChange: (d: Date) => void;
  minimumDate?: Date;
}) => {
  const [show, setShow] = useState(false);
  const [mode, setMode] = useState<'date' | 'time'>('date');

  const handleChange = (_: any, selected?: Date) => {
    if (Platform.OS !== 'ios') setShow(false);
    if (!selected) return;
    if (minimumDate && selected < minimumDate) {
      Alert.alert('Invalid Date', 'Please select a future date and time.');
      return;
    }
    onChange(selected);
  };

  return (
    <View style={s.fieldGroup}>
      <Text style={s.fieldLabel}>{label}</Text>
      <View style={s.dateRow}>
        <TouchableOpacity style={[s.dateBtn, { flex: 1.3 }]} onPress={() => { setMode('date'); setShow(true); }}>
          <Ionicons name="calendar-outline" size={16} color={COLORS.primary} />
          <Text style={s.dateBtnTxt}>
            {value.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' })}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.dateBtn, { flex: 1 }]} onPress={() => { setMode('time'); setShow(true); }}>
          <Ionicons name="time-outline" size={16} color={COLORS.primary} />
          <Text style={s.dateBtnTxt}>
            {value.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })}
          </Text>
        </TouchableOpacity>
      </View>
      {show && (
        <DateTimePicker
          value={value}
          mode={mode}
          display={Platform.OS === 'ios' ? 'inline' : 'default'}
          minimumDate={minimumDate}
          onChange={handleChange}
        />
      )}
    </View>
  );
};

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function ReservationScreen() {
  const [reservations, setReservations] = useState<any[]>([]);
  const [tables, setTables] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [createModal, setCreateModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const defaultStart = new Date(Date.now() + 60 * 60 * 1000);
  const defaultEnd = new Date(Date.now() + 2 * 60 * 60 * 1000);

  const [form, setForm] = useState({
    tableId: '',
    startTime: defaultStart,
    endTime: defaultEnd,
    notes: '',
  });

  const fetchData = useCallback(async () => {
    try {
      const [rRes, tRes] = await Promise.all([
        api.get('/api/reservations/my'),
        api.get('/api/tables'),
      ]);

      setReservations(Array.isArray(rRes.data) ? rRes.data : []);

      // ✅ Handle both array response and { tables: [] } response shapes
      const rawTables = Array.isArray(tRes.data)
        ? tRes.data
        : Array.isArray(tRes.data?.tables)
        ? tRes.data.tables
        : [];

      const available = rawTables.filter((t: any) => t.status !== 'MAINTENANCE');
      setTables(available);
    } catch (err) {
      console.error('[ReservationScreen] fetchData error:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, []);

  const openCreateModal = () => {
    const start = new Date(Date.now() + 60 * 60 * 1000);
    const end = new Date(Date.now() + 2 * 60 * 60 * 1000);
    setForm({ tableId: tables[0]?.id || '', startTime: start, endTime: end, notes: '' });
    setCreateModal(true);
  };

  const submitReservation = async () => {
    if (!form.tableId) return Alert.alert('Error', 'Please select a table.');

    const now = new Date();
    if (form.startTime <= now)
      return Alert.alert('Invalid Time', 'Start time must be in the future.');
    if (form.endTime <= form.startTime)
      return Alert.alert('Invalid Time', 'End time must be after start time.');

    setSubmitting(true);
    try {
      await api.post('/api/reservations', {
        tableId: form.tableId,
        startTime: form.startTime.toISOString(),
        endTime: form.endTime.toISOString(),
        notes: form.notes.trim() || undefined,
      });
      setCreateModal(false);
      fetchData();
      Alert.alert(
        '✅ Request Sent',
        'Your reservation request has been submitted and is awaiting staff approval. You will be notified once it is reviewed.'
      );
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.error || 'Failed to submit reservation');
    } finally { setSubmitting(false); }
  };

  const selectedTable = tables.find((t) => t.id === form.tableId);

  if (loading) return (
    <View style={s.center}><ActivityIndicator size="large" color={COLORS.primary} /></View>
  );

  return (
    <View style={s.container}>
      <View style={s.header}>
        <Text style={s.title}>📅 My Reservations</Text>
        <TouchableOpacity style={s.createBtn} onPress={openCreateModal}>
          <Ionicons name="add" size={18} color="#000" />
          <Text style={s.createBtnTxt}>Reserve</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={s.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); fetchData(); }}
            tintColor={COLORS.primary}
          />
        }
      >
        {reservations.length === 0 && (
          <View style={s.empty}>
            <Ionicons name="calendar-outline" size={48} color={COLORS.textMuted} />
            <Text style={s.emptyTxt}>No reservations yet.</Text>
            <Text style={s.emptySubTxt}>Tap "Reserve" to request a table.</Text>
          </View>
        )}
        {reservations.map((r: any) => (
          <View key={r.id} style={s.card}>
            <View style={s.cardTop}>
              <View>
                <Text style={s.cardTable}>Table {r.table?.tableNumber ?? '—'}</Text>
                <Text style={s.cardType}>{r.table?.type} · ₱{r.table?.ratePerHour}/hr</Text>
              </View>
              <View style={[s.statusBadge, { backgroundColor: (STATUS_COLORS[r.status] ?? COLORS.textMuted) + '25' }]}>
                <Ionicons
                  name={STATUS_ICONS[r.status] ?? 'ellipse-outline'}
                  size={12}
                  color={STATUS_COLORS[r.status] ?? COLORS.textMuted}
                />
                <Text style={[s.statusTxt, { color: STATUS_COLORS[r.status] ?? COLORS.textMuted }]}>
                  {r.status}
                </Text>
              </View>
            </View>
            <View style={s.cardMeta}>
              <Ionicons name="time-outline" size={13} color={COLORS.textMuted} />
              <Text style={s.cardMetaTxt}>
                {new Date(r.startTime).toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' })}{' '}
                {new Date(r.startTime).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })}
                {' → '}
                {new Date(r.endTime).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })}
              </Text>
            </View>
            {r.notes ? <Text style={s.cardNotes}>📝 {r.notes}</Text> : null}
            {r.status === 'DECLINED' && r.declineNote ? (
              <Text style={s.cardDeclineNote}>❌ Reason: {r.declineNote}</Text>
            ) : null}
          </View>
        ))}
      </ScrollView>

      {/* ── Create Reservation Modal ── */}
      <Modal visible={createModal} animationType="slide">
        <View style={s.modal}>
          <View style={s.modalHeader}>
            <TouchableOpacity onPress={() => setCreateModal(false)}>
              <Ionicons name="close" size={24} color={COLORS.textPrimary} />
            </TouchableOpacity>
            <Text style={s.modalTitle}>Reserve a Table</Text>
            <View style={{ width: 24 }} />
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.modalContent}>
            {/* Table Selector */}
            <Text style={s.fieldLabel}>Select Table</Text>
            {tables.length === 0 ? (
              <View style={s.noTableBox}>
                <Ionicons name="alert-circle-outline" size={20} color={COLORS.warning} />
                <Text style={s.noTableTxt}>No tables available at the moment.</Text>
              </View>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 4 }}>
                <View style={s.tableRow}>
                  {tables.map((t: any) => (
                    <TouchableOpacity
                      key={t.id}
                      style={[s.tableChip, form.tableId === t.id && s.tableChipActive]}
                      onPress={() => setForm(f => ({ ...f, tableId: t.id }))}
                    >
                      <Text style={[s.tableChipNum, form.tableId === t.id && s.tableChipNumActive]}>
                        #{t.tableNumber}
                      </Text>
                      <Text style={s.tableChipType}>{t.type}</Text>
                      <Text style={[s.tableChipRate, form.tableId === t.id && { color: COLORS.primary }]}>
                        ₱{t.ratePerHour}/hr
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            )}

            <DatePickerField
              label="Start Time"
              value={form.startTime}
              onChange={(d) => {
                const newEnd = new Date(d.getTime() + 60 * 60 * 1000);
                setForm(f => ({
                  ...f,
                  startTime: d,
                  endTime: f.endTime <= d ? newEnd : f.endTime,
                }));
              }}
              minimumDate={new Date()}
            />

            <DatePickerField
              label="End Time"
              value={form.endTime}
              onChange={(d) => setForm(f => ({ ...f, endTime: d }))}
              minimumDate={form.startTime}
            />

            {form.startTime < form.endTime && (
              <View style={s.durationPreview}>
                <Ionicons name="time-outline" size={14} color={COLORS.textMuted} />
                <Text style={s.durationPreviewTxt}>
                  Duration: {Math.round((form.endTime.getTime() - form.startTime.getTime()) / 60000)} min
                  {selectedTable ? ` · Est. Cost: ₱${Math.ceil((form.endTime.getTime() - form.startTime.getTime()) / 3600000 * selectedTable.ratePerHour)}` : ''}
                </Text>
              </View>
            )}

            <View style={s.fieldGroup}>
              <Text style={s.fieldLabel}>Notes (optional)</Text>
              <TextInput
                style={[s.fieldInput, { height: 70, textAlignVertical: 'top' }]}
                value={form.notes}
                onChangeText={(v) => setForm(f => ({ ...f, notes: v }))}
                placeholder="Any special requests..."
                placeholderTextColor={COLORS.textMuted}
                multiline
              />
            </View>

            <View style={s.noticeCard}>
              <Ionicons name="information-circle-outline" size={16} color={COLORS.info} />
              <Text style={s.noticeTxt}>
                Your reservation request will be reviewed by our staff. You will receive a notification once it is approved or declined.
              </Text>
            </View>

            <TouchableOpacity
              style={[s.submitBtn, submitting && s.submitBtnDis]}
              onPress={submitReservation}
              disabled={submitting}
            >
              {submitting
                ? <ActivityIndicator color="#000" />
                : <Text style={s.submitTxt}>Submit Request</Text>
              }
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background },
  header: { paddingTop: 60, paddingHorizontal: 20, paddingBottom: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.surfaceBorder },
  title: { fontSize: 22, fontWeight: '800', color: COLORS.textPrimary },
  createBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: COLORS.primary, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  createBtnTxt: { color: '#000', fontWeight: '700', fontSize: 13 },
  list: { padding: 16, gap: 12 },
  card: { backgroundColor: COLORS.surface, borderRadius: 16, padding: 16, gap: 8, borderWidth: 1, borderColor: COLORS.surfaceBorder },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  cardTable: { fontSize: 16, fontWeight: '700', color: COLORS.textPrimary },
  cardType: { fontSize: 12, color: COLORS.textSecondary },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  statusTxt: { fontSize: 11, fontWeight: '700' },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardMetaTxt: { fontSize: 13, color: COLORS.textSecondary },
  cardNotes: { fontSize: 12, color: COLORS.textMuted },
  cardDeclineNote: { fontSize: 12, color: COLORS.error },
  empty: { padding: 60, alignItems: 'center', gap: 8 },
  emptyTxt: { fontSize: 16, fontWeight: '700', color: COLORS.textMuted },
  emptySubTxt: { fontSize: 13, color: COLORS.textMuted },
  noTableBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: COLORS.warning + '15', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: COLORS.warning + '40' },
  noTableTxt: { fontSize: 13, color: COLORS.textSecondary },
  modal: { flex: 1, backgroundColor: COLORS.background },
  modalHeader: { paddingTop: 60, paddingHorizontal: 20, paddingBottom: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.surfaceBorder },
  modalTitle: { flex: 1, fontSize: 18, fontWeight: '800', color: COLORS.textPrimary, textAlign: 'center' },
  modalContent: { padding: 16, gap: 14 },
  fieldGroup: { gap: 6 },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: COLORS.textSecondary },
  fieldInput: { backgroundColor: COLORS.surface, borderRadius: 10, paddingHorizontal: 14, height: 46, color: COLORS.textPrimary, borderWidth: 1, borderColor: COLORS.surfaceBorder, fontSize: 15 },
  tableRow: { flexDirection: 'row', gap: 8, paddingVertical: 4 },
  tableChip: { borderRadius: 12, padding: 12, borderWidth: 1, borderColor: COLORS.surfaceBorder, alignItems: 'center', gap: 2, minWidth: 72, backgroundColor: COLORS.surface },
  tableChipActive: { borderColor: COLORS.primary, backgroundColor: COLORS.primary + '15' },
  tableChipNum: { fontSize: 16, fontWeight: '800', color: COLORS.textMuted },
  tableChipNumActive: { color: COLORS.primary },
  tableChipType: { fontSize: 10, color: COLORS.textMuted },
  tableChipRate: { fontSize: 11, fontWeight: '600', color: COLORS.textMuted },
  dateRow: { flexDirection: 'row', gap: 8 },
  dateBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: COLORS.surface, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, borderWidth: 1, borderColor: COLORS.surfaceBorder },
  dateBtnTxt: { fontSize: 13, color: COLORS.textPrimary, fontWeight: '600' },
  durationPreview: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: COLORS.surfaceBorder, borderRadius: 8, padding: 10 },
  durationPreviewTxt: { fontSize: 12, color: COLORS.textMuted },
  noticeCard: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', backgroundColor: COLORS.info + '15', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: COLORS.info + '40' },
  noticeTxt: { flex: 1, fontSize: 13, color: COLORS.textSecondary, lineHeight: 20 },
  submitBtn: { backgroundColor: COLORS.primary, borderRadius: 14, height: 52, justifyContent: 'center', alignItems: 'center', marginTop: 4 },
  submitBtnDis: { opacity: 0.5 },
  submitTxt: { color: '#000', fontWeight: '800', fontSize: 16 },
});
