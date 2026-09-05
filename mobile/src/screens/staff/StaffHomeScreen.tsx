import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  RefreshControl, Alert, ActivityIndicator, Modal, TextInput,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../../context/AuthContext';
import { useAuth } from '../../context/AuthContext';
import { useSocket } from '../../context/SocketContext';
import { COLORS } from '../../constants';

const resolveExpectedEndTime = (start: Date, selectedClockTime: Date) => {
  const expectedEnd = new Date(start);
  expectedEnd.setHours(selectedClockTime.getHours(), selectedClockTime.getMinutes(), 0, 0);
  if (expectedEnd <= start) expectedEnd.setDate(expectedEnd.getDate() + 1);
  return expectedEnd;
};
const formatExpectedEnd = (start: string | Date, end: string | Date) => {
  const startDate = new Date(start);
  const endDate = new Date(end);
  const time = endDate.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' });
  return startDate.toDateString() === endDate.toDateString() ? time : `${time} (Next Day)`;
};

export default function StaffHomeScreen({ navigation }: any) {
  const { logout } = useAuth();
  const { socket, joinStaff } = useSocket();
  const [tables, setTables] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedTable, setSelectedTable] = useState<any>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [searchMember, setSearchMember] = useState('');
  const [foundMember, setFoundMember] = useState<any>(null);
  const [memberResults, setMemberResults] = useState<any[]>([]);
  const [actionLoading, setActionLoading] = useState(false);
  const [walkInEndModal, setWalkInEndModal] = useState(false);
  const [walkInStartTime, setWalkInStartTime] = useState(new Date());
  const [expectedEndTime, setExpectedEndTime] = useState(new Date(Date.now() + 60 * 60 * 1000));
  const [showExpectedEndPicker, setShowExpectedEndPicker] = useState(false);

  const fetchTables = useCallback(async () => {
    try {
      const res = await api.get('/api/tables');
      setTables(res.data);
    } catch (err) {
      Alert.alert('Error', 'Failed to load tables');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    joinStaff();

    const updateTable = (data: any) => {
      setTables((prev) =>
        prev.map((t) => t.id === data.tableId ? { ...t, ...data } : t)
      );
    };
    socket?.on('table:updated', updateTable);
    socket?.on('reservation:new', fetchTables);
    socket?.on('reservation:updated', fetchTables);

    return () => {
      socket?.off('table:updated', updateTable);
      socket?.off('reservation:new', fetchTables);
      socket?.off('reservation:updated', fetchTables);
    };
  }, [socket, fetchTables]);

  useFocusEffect(
    useCallback(() => {
      fetchTables();
    }, [fetchTables])
  );

  // Typeahead member search (username/displayName, name, email, phone)
  useEffect(() => {
    if (!modalVisible) return;
    const q = searchMember.trim();
    if (!q) {
      setMemberResults([]);
      return;
    }

    const handle = setTimeout(async () => {
      try {
        const res = await api.get(`/api/users/search?q=${encodeURIComponent(q)}&role=MEMBER`);
        setMemberResults(Array.isArray(res.data) ? res.data : []);
      } catch {
        // ignore
      }
    }, 250);

    return () => clearTimeout(handle);
  }, [searchMember, modalVisible]);

  const searchMemberByEmail = async () => {
    if (!searchMember.trim()) return;
    try {
      const res = await api.get(`/api/users/search?q=${encodeURIComponent(searchMember.trim())}&role=MEMBER`);
      const results = Array.isArray(res.data) ? res.data : [];
      setMemberResults(results);
      if (results.length === 1) {
        setFoundMember(results[0]);
        setMemberResults([]);
      } else if (results.length === 0) {
        Alert.alert('Not Found', 'No member found for that search.');
      }
    } catch {
      Alert.alert('Error', 'Search failed');
    }
  };

  const startSession = async (isWalkin: boolean, expectedEnd?: Date) => {
    if (!selectedTable) return;
    setActionLoading(true);
    try {
      await api.post(`/api/tables/${selectedTable.id}/session/start`, {
        userId: !isWalkin ? foundMember?.id : null,
        isWalkin,
        expectedEndTime: isWalkin ? expectedEnd?.toISOString() : undefined,
      });
      setModalVisible(false);
      setFoundMember(null);
      setSearchMember('');
      setWalkInEndModal(false);
      fetchTables();
      Alert.alert('✅ Session Started', `Table ${selectedTable.tableNumber} is now occupied`);
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.error || 'Failed to start session');
    } finally {
      setActionLoading(false);
    }
  };

  const openWalkInEndModal = () => {
    const start = new Date();
    setWalkInStartTime(start);
    setExpectedEndTime(new Date(start.getTime() + 60 * 60 * 1000));
    setModalVisible(false);
    setWalkInEndModal(true);
  };

  const confirmWalkInSession = () => {
    const minimumEnd = walkInStartTime.getTime() + 30 * 60 * 1000;
    if (expectedEndTime.getTime() < minimumEnd) {
      Alert.alert('Invalid Expected End', 'Walk-in sessions must be at least 30 minutes.');
      return;
    }
    startSession(true, expectedEndTime);
  };

  const endSession = async (table: any) => {
    const activeSession = table.sessions?.[0];
    if (!activeSession) return;

    Alert.alert(
      'End Session',
      `End session for Table ${table.tableNumber}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'End Session',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.patch(`/api/tables/session/${activeSession.id}/end`);
              fetchTables();
              Alert.alert('✅ Session Ended', `Table ${table.tableNumber} is now available`);
            } catch (err: any) {
              Alert.alert('Error', err.response?.data?.error || 'Failed to end session');
            }
          },
        },
      ]
    );
  };

  const getStatusColor = (status: string) => ({
    AVAILABLE: COLORS.success,
    OCCUPIED: COLORS.error,
    RESERVED: COLORS.warning,
    MAINTENANCE: COLORS.textMuted,
  }[status] || COLORS.textMuted);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <View style={styles.headerTitleGroup}>
            <Text style={styles.title}>🎱 Table Management</Text>
            <Text style={styles.subtitle}>
              {tables.filter((t) => t.status === 'AVAILABLE').length} available •{' '}
              {tables.filter((t) => t.status === 'OCCUPIED').length} occupied
            </Text>
          </View>

          <View style={styles.headerActions}>
            <TouchableOpacity
              accessibilityLabel="Reservations"
              style={styles.reservationsBtn}
              onPress={() => navigation.navigate('Reservations')}
            >
              <Ionicons name="calendar-outline" size={17} color={COLORS.primary} />
              <Text style={styles.reservationsBtnTxt}>Reservations</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.headerIconBtn}
              onPress={() => navigation.navigate('TV')}
            >
              <Ionicons name="tv-outline" size={18} color={COLORS.textPrimary} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.headerIconBtn}
              onPress={() => {
                Alert.alert('Sign Out', 'Sign out of the staff account?', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Sign Out', style: 'destructive', onPress: logout },
                ]);
              }}
            >
              <Ionicons name="log-out-outline" size={18} color={COLORS.textPrimary} />
            </TouchableOpacity>
          </View>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchTables(); }} tintColor={COLORS.primary} />}
      >
        {/* Standard Tables */}
        <Text style={styles.sectionTitle}>Standard Tables</Text>
        <View style={styles.tablesList}>
          {tables.filter((t) => t.type === 'STANDARD').map((table) => (
            <TableCard
              key={table.id}
              table={table}
              statusColor={getStatusColor(table.status)}
              onStart={() => { setSelectedTable(table); setModalVisible(true); }}
              onEnd={() => endSession(table)}
            />
          ))}
        </View>

        {/* VIP Tables */}
        <Text style={styles.sectionTitle}>VIP Tables 👑</Text>
        <View style={styles.tablesList}>
          {tables.filter((t) => t.type === 'VIP').map((table) => (
            <TableCard
              key={table.id}
              table={table}
              statusColor={getStatusColor(table.status)}
              isVIP
              onStart={() => { setSelectedTable(table); setModalVisible(true); }}
              onEnd={() => endSession(table)}
            />
          ))}
        </View>
      </ScrollView>

      {/* Start Session Modal */}
      <Modal visible={modalVisible} transparent animationType="slide" onRequestClose={() => !actionLoading && setModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>
              Start Session — Table {selectedTable?.tableNumber}
            </Text>

            {/* Member Search */}
            <Text style={styles.modalLabel}>Search Member (optional)</Text>
            <View style={styles.searchRow}>
              <TextInput
                style={styles.searchInput}
                placeholder="Username, name, email, or phone..."
                placeholderTextColor={COLORS.textMuted}
                value={searchMember}
                onChangeText={(t) => { setSearchMember(t); setFoundMember(null); }}
                onSubmitEditing={searchMemberByEmail}
              />
              <TouchableOpacity style={styles.searchBtn} onPress={searchMemberByEmail}>
                <Ionicons name="search" size={18} color={COLORS.textPrimary} />
              </TouchableOpacity>
            </View>

            {!foundMember && memberResults.length > 0 && (
              <View style={styles.searchResults}>
                {memberResults.slice(0, 6).map((m: any) => (
                  <TouchableOpacity
                    key={m.id}
                    style={styles.searchResultRow}
                    onPress={() => {
                      setFoundMember(m);
                      setSearchMember(m.gamifiedProfile?.displayName || m.email);
                      setMemberResults([]);
                    }}
                  >
                    <Ionicons name="person-circle" size={22} color={COLORS.textMuted} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.searchResultName}>
                        {m.gamifiedProfile?.displayName || `${m.firstName} ${m.lastName}`}
                      </Text>
                      <Text style={styles.searchResultMeta} numberOfLines={1}>
                        {m.email} · {m.phone}
                      </Text>
                    </View>
                    <Text style={styles.searchResultCredits}>{(m.membership?.creditBalance || 0).toFixed(0)}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {foundMember && (
              <View style={styles.foundMember}>
                <Ionicons name="person-circle" size={32} color={COLORS.primary} />
                <View>
                  <Text style={styles.foundName}>{foundMember.firstName} {foundMember.lastName}</Text>
                  <Text style={styles.foundCredits}>
                    💳 {foundMember.membership?.creditBalance?.toFixed(0) || 0} credits
                  </Text>
                </View>
              </View>
            )}

            <View style={styles.modalActions}>
              {foundMember && (
                <TouchableOpacity
                  style={[styles.actionBtn, styles.memberBtn]}
                  onPress={() => startSession(false)}
                  disabled={actionLoading}
                >
                  {actionLoading ? <ActivityIndicator color="#000" size="small" /> : (
                    <>
                      <Ionicons name="person" size={18} color="#000" />
                      <Text style={styles.actionBtnText}>Start as Member</Text>
                    </>
                  )}
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.actionBtn, styles.walkinBtn]}
                onPress={openWalkInEndModal}
                disabled={actionLoading}
              >
                <Ionicons name="walk" size={18} color={COLORS.textPrimary} />
                <Text style={[styles.actionBtnText, { color: COLORS.textPrimary }]}>Walk-in</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => { setModalVisible(false); setFoundMember(null); setSearchMember(''); }}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={walkInEndModal} transparent animationType="slide" onRequestClose={() => !actionLoading && setWalkInEndModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Start Walk-In Session</Text>
            <Text style={styles.modalLabel}>Start Time</Text>
            <View style={styles.expectedTimeBox}><Text style={styles.expectedTimeText}>{walkInStartTime.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })} · starts on confirmation</Text></View>
            <Text style={styles.modalLabel}>Expected End Time</Text>
            <TouchableOpacity style={styles.expectedTimeBox} onPress={() => setShowExpectedEndPicker(true)}>
              <Ionicons name="time-outline" size={18} color={COLORS.primary} />
              <Text style={styles.expectedTimeText}>{formatExpectedEnd(walkInStartTime, expectedEndTime)}</Text>
            </TouchableOpacity>
            {showExpectedEndPicker && <DateTimePicker value={expectedEndTime} mode="time" minimumDate={new Date(walkInStartTime.getTime() + 30 * 60 * 1000)} onChange={(_, value) => { setShowExpectedEndPicker(false); if (value) setExpectedEndTime(resolveExpectedEndTime(walkInStartTime, value)); }} />}
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setWalkInEndModal(false)} disabled={actionLoading}><Text style={styles.cancelBtnText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.actionBtn, styles.walkinBtn]} onPress={confirmWalkInSession} disabled={actionLoading}>{actionLoading ? <ActivityIndicator color={COLORS.textPrimary} size="small" /> : <Text style={[styles.actionBtnText, { color: COLORS.textPrimary }]}>Start Session</Text>}</TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const TableCard = ({ table, statusColor, isVIP, onStart, onEnd }: any) => {
  const activeSession = table.sessions?.[0];
  const currentReservation = table.currentReservation || (!activeSession && table.status === 'RESERVED' ? table.reservations?.[0] : null);
  const nextReservation = table.nextReservation || table.reservations?.find((reservation: any) => new Date(reservation.startTime) > new Date());
  const formatTime = (value: string) => new Date(value).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' });
  const reservationName = (reservation: any) => reservation?.user ? `${reservation.user.firstName} ${reservation.user.lastName}` : 'Member';
  const sessionName = activeSession?.user ? `${activeSession.user.firstName} ${activeSession.user.lastName}` : 'Walk-in';

  return (
    <View style={[styles.tableCard, isVIP && styles.vipCard, { borderColor: statusColor + '50' }]}>
      <View style={styles.tableCardHeader}>
        <Text style={styles.tableCardNumber}>Table {table.tableNumber}</Text>
        <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
      </View>
      <Text style={styles.tableCardStatus}>{table.status}</Text>
      <Text style={styles.tableCardRate}>₱{table.ratePerHour}/hr</Text>

      {activeSession && (
        <View style={styles.scheduleSection}>
          <Text style={styles.scheduleHeading}>Current — {activeSession.isWalkin ? 'Walk-In' : 'Reservation'}</Text>
          <Text style={styles.scheduleName}>{activeSession.isWalkin ? sessionName : reservationName(currentReservation)}</Text>
          <Text style={styles.scheduleTime}>Start: {formatTime(activeSession.isWalkin ? activeSession.startTime : currentReservation?.startTime || activeSession.startTime)}</Text>
          <Text style={styles.scheduleTime}>End: {activeSession.isWalkin ? (activeSession.expectedEndTime ? formatExpectedEnd(activeSession.startTime, activeSession.expectedEndTime) : (activeSession.endTime ? formatTime(activeSession.endTime) : 'Ongoing')) : (currentReservation?.endTime ? formatTime(currentReservation.endTime) : 'Ongoing')}</Text>
        </View>
      )}

      {!activeSession && currentReservation && (
        <View style={styles.scheduleSection}>
          <Text style={styles.scheduleHeading}>Reserved For</Text>
          <Text style={styles.scheduleName}>{reservationName(currentReservation)}</Text>
          <Text style={styles.scheduleTime}>Start: {formatTime(currentReservation.startTime)}</Text>
          <Text style={styles.scheduleTime}>End: {formatTime(currentReservation.endTime)}</Text>
        </View>
      )}

      {nextReservation && (
        <View style={styles.nextReservation}>
          <Text style={styles.scheduleHeading}>Next Reservation</Text>
          <Text style={styles.scheduleName}>{reservationName(nextReservation)}</Text>
          <Text style={styles.scheduleTime}>{formatTime(nextReservation.startTime)} – {formatTime(nextReservation.endTime)}{nextReservation.status === 'PENDING' ? ' · Pending approval' : ''}</Text>
        </View>
      )}

      <View style={styles.tableCardActions}>
        {table.status === 'AVAILABLE' ? (
          <TouchableOpacity style={styles.startBtn} onPress={onStart}>
            <Text style={styles.startBtnText}>Start</Text>
          </TouchableOpacity>
        ) : table.status === 'OCCUPIED' ? (
          <TouchableOpacity style={styles.endBtn} onPress={onEnd}>
            <Text style={styles.endBtnText}>End</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background },
  header: { paddingTop: 60, paddingHorizontal: 20, paddingBottom: 16, backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.surfaceBorder },
  headerRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 },
  headerTitleGroup: { flex: 1, minWidth: 160, paddingRight: 4 },
  headerActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center', gap: 8, flexShrink: 1 },
  reservationsBtn: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, borderRadius: 10, borderWidth: 1, borderColor: COLORS.primary + '70', backgroundColor: COLORS.primary + '12' },
  reservationsBtnTxt: { color: COLORS.primary, fontSize: 12, fontWeight: '700' },
  headerIconBtn: { width: 36, height: 36, borderRadius: 10, borderWidth: 1, borderColor: COLORS.surfaceBorder, backgroundColor: COLORS.surface, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 22, fontWeight: '800', color: COLORS.textPrimary },
  subtitle: { fontSize: 13, color: COLORS.textSecondary, marginTop: 2 },
  content: { padding: 20, paddingBottom: 32 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: COLORS.textSecondary, marginBottom: 12, marginTop: 8 },
  tablesList: { gap: 10, marginBottom: 20 },
  tableCard: {
    width: '100%', backgroundColor: COLORS.surface,
    borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: COLORS.surfaceBorder,
    gap: 4,
  },
  vipCard: { borderColor: COLORS.gold + '40' },
  tableCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  tableCardNumber: { fontSize: 15, fontWeight: '700', color: COLORS.textPrimary },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  tableCardStatus: { fontSize: 11, color: COLORS.textSecondary, fontWeight: '600' },
  tableCardRate: { fontSize: 12, color: COLORS.primary },
  scheduleSection: { marginTop: 6, paddingTop: 8, borderTopWidth: 1, borderTopColor: COLORS.surfaceBorder, gap: 2 },
  nextReservation: { marginTop: 6, padding: 9, borderRadius: 8, backgroundColor: COLORS.warning + '12', gap: 2 },
  scheduleHeading: { fontSize: 11, fontWeight: '800', color: COLORS.textSecondary, textTransform: 'uppercase' },
  scheduleName: { fontSize: 14, fontWeight: '700', color: COLORS.textPrimary },
  scheduleTime: { fontSize: 12, color: COLORS.textMuted },
  tableCardActions: { marginTop: 8 },
  startBtn: { backgroundColor: COLORS.primary, borderRadius: 8, padding: 8, alignItems: 'center' },
  startBtnText: { color: '#000', fontWeight: '700', fontSize: 13 },
  endBtn: { backgroundColor: COLORS.error + '20', borderRadius: 8, padding: 8, alignItems: 'center', borderWidth: 1, borderColor: COLORS.error },
  endBtnText: { color: COLORS.error, fontWeight: '700', fontSize: 13 },
  // Modal
  modalOverlay: { flex: 1, backgroundColor: '#000000AA', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: COLORS.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, gap: 14 },
  modalTitle: { fontSize: 18, fontWeight: '800', color: COLORS.textPrimary },
  modalLabel: { fontSize: 13, fontWeight: '600', color: COLORS.textSecondary },
  expectedTimeBox: { minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: COLORS.surfaceLight, borderRadius: 10, paddingHorizontal: 14, borderWidth: 1, borderColor: COLORS.surfaceBorder },
  expectedTimeText: { color: COLORS.textPrimary, fontSize: 14, fontWeight: '700' },
  searchRow: { flexDirection: 'row', gap: 10 },
  searchInput: {
    flex: 1, backgroundColor: COLORS.surfaceLight,
    borderRadius: 10, paddingHorizontal: 14,
    color: COLORS.textPrimary, height: 46,
    borderWidth: 1, borderColor: COLORS.surfaceBorder,
  },
  searchBtn: { backgroundColor: COLORS.surfaceLight, borderRadius: 10, width: 46, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: COLORS.surfaceBorder },
  searchResults: { backgroundColor: COLORS.surfaceLight, borderRadius: 12, borderWidth: 1, borderColor: COLORS.surfaceBorder, overflow: 'hidden' },
  searchResultRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderBottomWidth: 1, borderBottomColor: COLORS.surfaceBorder },
  searchResultName: { fontSize: 13, fontWeight: '700', color: COLORS.textPrimary },
  searchResultMeta: { fontSize: 11, color: COLORS.textMuted },
  searchResultCredits: { fontSize: 12, fontWeight: '800', color: COLORS.primary, minWidth: 40, textAlign: 'right' },
  foundMember: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: COLORS.surfaceLight, padding: 12, borderRadius: 12 },
  foundName: { fontSize: 15, fontWeight: '700', color: COLORS.textPrimary },
  foundCredits: { fontSize: 12, color: COLORS.textSecondary },
  modalActions: { gap: 10 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 12, height: 50 },
  memberBtn: { backgroundColor: COLORS.primary },
  walkinBtn: { backgroundColor: COLORS.surfaceLight, borderWidth: 1, borderColor: COLORS.surfaceBorder },
  actionBtnText: { fontSize: 15, fontWeight: '700', color: '#000' },
  cancelBtn: { alignItems: 'center', padding: 12 },
  cancelBtnText: { color: COLORS.textMuted, fontSize: 14 },
});
