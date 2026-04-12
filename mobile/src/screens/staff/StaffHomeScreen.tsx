import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  RefreshControl, Alert, ActivityIndicator, Modal, TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../context/AuthContext';
import { useSocket } from '../../context/SocketContext';
import { COLORS } from '../../constants';

export default function StaffHomeScreen() {
  const { socket, joinStaff } = useSocket();
  const [tables, setTables] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedTable, setSelectedTable] = useState<any>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [searchMember, setSearchMember] = useState('');
  const [foundMember, setFoundMember] = useState<any>(null);
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    joinStaff();
    fetchTables();

    // Real-time updates
    socket?.on('table:updated', (data: any) => {
      setTables((prev) =>
        prev.map((t) => t.id === data.tableId ? { ...t, ...data } : t)
      );
    });

    return () => { socket?.off('table:updated'); };
  }, [socket]);

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

  const searchMemberByEmail = async () => {
    if (!searchMember.trim()) return;
    try {
      const res = await api.get('/api/users');
      const found = res.data.find((u: any) =>
        u.email.toLowerCase().includes(searchMember.toLowerCase()) ||
        `${u.firstName} ${u.lastName}`.toLowerCase().includes(searchMember.toLowerCase())
      );
      setFoundMember(found || null);
      if (!found) Alert.alert('Not Found', 'No member found with that email or name');
    } catch {
      Alert.alert('Error', 'Search failed');
    }
  };

  const startSession = async (isWalkin: boolean) => {
    if (!selectedTable) return;
    setActionLoading(true);
    try {
      await api.post(`/api/tables/${selectedTable.id}/session/start`, {
        userId: !isWalkin ? foundMember?.id : null,
        isWalkin,
      });
      setModalVisible(false);
      setFoundMember(null);
      setSearchMember('');
      fetchTables();
      Alert.alert('✅ Session Started', `Table ${selectedTable.tableNumber} is now occupied`);
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.error || 'Failed to start session');
    } finally {
      setActionLoading(false);
    }
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
        <Text style={styles.title}>🎱 Table Management</Text>
        <Text style={styles.subtitle}>
          {tables.filter((t) => t.status === 'AVAILABLE').length} available •{' '}
          {tables.filter((t) => t.status === 'OCCUPIED').length} occupied
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchTables(); }} tintColor={COLORS.primary} />}
      >
        {/* Standard Tables */}
        <Text style={styles.sectionTitle}>Standard Tables</Text>
        <View style={styles.tablesGrid}>
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
        <View style={styles.tablesGrid}>
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
      <Modal visible={modalVisible} transparent animationType="slide">
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
                placeholder="Name or email..."
                placeholderTextColor={COLORS.textMuted}
                value={searchMember}
                onChangeText={setSearchMember}
                onSubmitEditing={searchMemberByEmail}
              />
              <TouchableOpacity style={styles.searchBtn} onPress={searchMemberByEmail}>
                <Ionicons name="search" size={18} color={COLORS.textPrimary} />
              </TouchableOpacity>
            </View>

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
                onPress={() => startSession(true)}
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
    </View>
  );
}

const TableCard = ({ table, statusColor, isVIP, onStart, onEnd }: any) => {
  const activeSession = table.sessions?.[0];
  const queueCount = table.queue?.length || 0;
  const sessionDuration = activeSession
    ? Math.floor((Date.now() - new Date(activeSession.startTime).getTime()) / 1000 / 60)
    : 0;

  return (
    <View style={[styles.tableCard, isVIP && styles.vipCard, { borderColor: statusColor + '50' }]}>
      <View style={styles.tableCardHeader}>
        <Text style={styles.tableCardNumber}>Table {table.tableNumber}</Text>
        <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
      </View>
      <Text style={styles.tableCardStatus}>{table.status}</Text>
      <Text style={styles.tableCardRate}>₱{table.ratePerHour}/hr</Text>

      {activeSession && (
        <View style={styles.sessionInfo}>
          <Ionicons name="time-outline" size={12} color={COLORS.textMuted} />
          <Text style={styles.sessionTime}>{sessionDuration}m</Text>
          {activeSession.user && (
            <Text style={styles.sessionUser} numberOfLines={1}>
              {activeSession.user.firstName}
            </Text>
          )}
        </View>
      )}

      {queueCount > 0 && (
        <View style={styles.queueBadge}>
          <Text style={styles.queueBadgeText}>{queueCount} waiting</Text>
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
  title: { fontSize: 22, fontWeight: '800', color: COLORS.textPrimary },
  subtitle: { fontSize: 13, color: COLORS.textSecondary, marginTop: 2 },
  content: { padding: 20, paddingBottom: 32 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: COLORS.textSecondary, marginBottom: 12, marginTop: 8 },
  tablesGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 },
  tableCard: {
    width: '47%', backgroundColor: COLORS.surface,
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
  sessionInfo: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  sessionTime: { fontSize: 11, color: COLORS.textMuted },
  sessionUser: { fontSize: 11, color: COLORS.textSecondary, flex: 1 },
  queueBadge: { backgroundColor: COLORS.warning + '20', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, alignSelf: 'flex-start' },
  queueBadgeText: { fontSize: 10, color: COLORS.warning, fontWeight: '600' },
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
  searchRow: { flexDirection: 'row', gap: 10 },
  searchInput: {
    flex: 1, backgroundColor: COLORS.surfaceLight,
    borderRadius: 10, paddingHorizontal: 14,
    color: COLORS.textPrimary, height: 46,
    borderWidth: 1, borderColor: COLORS.surfaceBorder,
  },
  searchBtn: { backgroundColor: COLORS.surfaceLight, borderRadius: 10, width: 46, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: COLORS.surfaceBorder },
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
