// QueueScreen.tsx
import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, RefreshControl, Alert, ActivityIndicator, Modal, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../context/AuthContext';
import { useSocket } from '../../context/SocketContext';
import { useAuth } from '../../context/AuthContext';
import { COLORS } from '../../constants';

export default function QueueScreen() {
  const { user } = useAuth();
  const { socket } = useSocket();
  const [tables, setTables] = useState<any[]>([]);
  const [queue, setQueue] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [joinModal, setJoinModal] = useState(false);
  const [selectedTable, setSelectedTable] = useState<any>(null);
  const [partySize, setPartySize] = useState('1');
  const [joining, setJoining] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [tRes, qRes] = await Promise.all([api.get('/api/tables'), api.get('/api/queue')]);
      setTables(tRes.data);
      setQueue(qRes.data);
    } catch { }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => {
    fetchData();
    socket?.on('queue:updated', fetchData);
    socket?.on('queue:called', fetchData);
    socket?.on('table:updated', fetchData);
    return () => { socket?.off('queue:updated'); socket?.off('queue:called'); socket?.off('table:updated'); };
  }, [socket]);

  const joinQueue = async () => {
    if (!selectedTable) return;
    setJoining(true);
    try {
      await api.post('/api/queue/join', { tableId: selectedTable.id, partySize: parseInt(partySize) || 1 });
      setJoinModal(false);
      fetchData();
      Alert.alert('✅ Joined Queue', `You're in line for Table ${selectedTable.tableNumber}`);
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.error || 'Failed to join queue');
    } finally { setJoining(false); }
  };

  const myQueueEntries = queue.filter((q: any) => q.userId === user?.id);

  if (loading) return <View style={s.center}><ActivityIndicator size="large" color={COLORS.primary} /></View>;

  return (
    <View style={s.container}>
      <View style={s.header}>
        <Text style={s.title}>⏱️ Queue</Text>
        <Text style={s.subtitle}>{queue.length} people waiting</Text>
      </View>

      <ScrollView contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchData(); }} tintColor={COLORS.primary} />}>

        {myQueueEntries.length > 0 && (
          <>
            <Text style={s.sectionTitle}>Your Queue Position</Text>
            {myQueueEntries.map((entry: any) => (
              <View key={entry.id} style={[s.myEntryCard, entry.status === 'CALLED' && s.myEntryCalledCard]}>
                {entry.status === 'CALLED' && (
                  <View style={s.calledBanner}><Text style={s.calledBannerTxt}>📢 YOUR TABLE IS READY!</Text></View>
                )}
                <Text style={s.myEntryTable}>Table {entry.table?.tableNumber}</Text>
                <Text style={s.myEntryPos}>Position #{entry.position}</Text>
                <Text style={s.myEntryStatus}>{entry.status}</Text>
              </View>
            ))}
          </>
        )}

        <Text style={s.sectionTitle}>Tables</Text>
        {tables.map((table: any) => {
          const tableQueue = queue.filter((q: any) => q.tableId === table.id);
          return (
            <View key={table.id} style={s.tableCard}>
              <View style={s.tableTop}>
                <View>
                  <Text style={s.tableName}>{table.type === 'VIP' ? '👑 ' : '🎱 '}Table {table.tableNumber}</Text>
                  <Text style={[s.tableStatus, { color: table.status === 'AVAILABLE' ? COLORS.success : table.status === 'OCCUPIED' ? COLORS.error : COLORS.warning }]}>
                    {table.status}
                  </Text>
                </View>
                <View style={s.tableRight}>
                  <Text style={s.tableRate}>₱{table.ratePerHour}/hr</Text>
                  {tableQueue.length > 0 && (
                    <Text style={s.tableQueueCount}>{tableQueue.length} waiting</Text>
                  )}
                </View>
              </View>

              {tableQueue.length > 0 && (
                <View style={s.queueList}>
                  {tableQueue.slice(0, 3).map((q: any, i: number) => (
                    <View key={q.id} style={s.queueItem}>
                      <Text style={s.queuePos}>#{i + 1}</Text>
                      <Text style={s.queueName}>
                        {q.user ? `${q.user.firstName} ${q.user.lastName}` : q.walkinName || 'Walk-in'}
                      </Text>
                      {q.userId === user?.id && <Text style={s.youTag}>YOU</Text>}
                    </View>
                  ))}
                  {tableQueue.length > 3 && <Text style={s.moreQueue}>+{tableQueue.length - 3} more</Text>}
                </View>
              )}

              {table.status !== 'MAINTENANCE' && (
                <TouchableOpacity
                  style={[s.joinBtn, table.status === 'AVAILABLE' && s.joinBtnAvailable]}
                  onPress={() => { setSelectedTable(table); setJoinModal(true); }}
                >
                  <Text style={s.joinBtnTxt}>
                    {table.status === 'AVAILABLE' ? 'Play Now (Join Queue)' : 'Join Queue'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          );
        })}
      </ScrollView>

      <Modal visible={joinModal} transparent animationType="slide">
        <View style={s.overlay}>
          <View style={s.modal}>
            <Text style={s.modalTitle}>Join Queue — Table {selectedTable?.tableNumber}</Text>
            <Text style={s.modalLabel}>Party Size</Text>
            <View style={s.partySizeRow}>
              {[1, 2, 3, 4].map(n => (
                <TouchableOpacity key={n} style={[s.partySizeBtn, partySize === String(n) && s.partySizeBtnActive]} onPress={() => setPartySize(String(n))}>
                  <Text style={[s.partySizeTxt, partySize === String(n) && s.partySizeTxtActive]}>{n}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={s.modalBtns}>
              <TouchableOpacity style={s.cancelBtn} onPress={() => setJoinModal(false)}>
                <Text style={s.cancelTxt}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.confirmBtn} onPress={joinQueue} disabled={joining}>
                {joining ? <ActivityIndicator color="#000" size="small" /> : <Text style={s.confirmTxt}>Join Queue</Text>}
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
  header: { paddingTop: 60, paddingHorizontal: 20, paddingBottom: 16, backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.surfaceBorder },
  title: { fontSize: 22, fontWeight: '800', color: COLORS.textPrimary },
  subtitle: { fontSize: 13, color: COLORS.textSecondary },
  content: { padding: 16, gap: 12 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: COLORS.textPrimary },
  myEntryCard: { backgroundColor: COLORS.surface, borderRadius: 14, padding: 16, gap: 4, borderWidth: 1, borderColor: COLORS.primary + '50' },
  myEntryCalledCard: { borderColor: COLORS.success, backgroundColor: COLORS.success + '10' },
  calledBanner: { backgroundColor: COLORS.success, borderRadius: 8, padding: 10, alignItems: 'center' },
  calledBannerTxt: { color: '#000', fontWeight: '900', fontSize: 14 },
  myEntryTable: { fontSize: 18, fontWeight: '800', color: COLORS.textPrimary },
  myEntryPos: { fontSize: 14, color: COLORS.primary },
  myEntryStatus: { fontSize: 12, color: COLORS.textMuted },
  tableCard: { backgroundColor: COLORS.surface, borderRadius: 14, padding: 16, gap: 10, borderWidth: 1, borderColor: COLORS.surfaceBorder },
  tableTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  tableName: { fontSize: 16, fontWeight: '700', color: COLORS.textPrimary },
  tableStatus: { fontSize: 12, fontWeight: '600' },
  tableRight: { alignItems: 'flex-end', gap: 4 },
  tableRate: { fontSize: 13, color: COLORS.primary, fontWeight: '600' },
  tableQueueCount: { fontSize: 11, color: COLORS.warning },
  queueList: { gap: 6 },
  queueItem: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: COLORS.surfaceLight, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  queuePos: { fontSize: 12, color: COLORS.textMuted, width: 24 },
  queueName: { flex: 1, fontSize: 13, color: COLORS.textPrimary },
  youTag: { fontSize: 10, fontWeight: '800', color: COLORS.primary, backgroundColor: COLORS.primary + '20', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  moreQueue: { fontSize: 11, color: COLORS.textMuted, textAlign: 'center' },
  joinBtn: { backgroundColor: COLORS.surfaceLight, borderRadius: 10, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: COLORS.surfaceBorder },
  joinBtnAvailable: { backgroundColor: COLORS.primary + '20', borderColor: COLORS.primary },
  joinBtnTxt: { color: COLORS.textPrimary, fontWeight: '700', fontSize: 13 },
  overlay: { flex: 1, backgroundColor: '#000000AA', justifyContent: 'flex-end' },
  modal: { backgroundColor: COLORS.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, gap: 14 },
  modalTitle: { fontSize: 18, fontWeight: '800', color: COLORS.textPrimary },
  modalLabel: { fontSize: 13, fontWeight: '600', color: COLORS.textSecondary },
  partySizeRow: { flexDirection: 'row', gap: 10 },
  partySizeBtn: { flex: 1, backgroundColor: COLORS.surfaceLight, borderRadius: 10, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: COLORS.surfaceBorder },
  partySizeBtnActive: { backgroundColor: COLORS.primary + '20', borderColor: COLORS.primary },
  partySizeTxt: { fontSize: 18, fontWeight: '700', color: COLORS.textMuted },
  partySizeTxtActive: { color: COLORS.primary },
  modalBtns: { flexDirection: 'row', gap: 10 },
  cancelBtn: { flex: 1, backgroundColor: COLORS.surfaceLight, borderRadius: 12, padding: 14, alignItems: 'center' },
  cancelTxt: { color: COLORS.textPrimary, fontWeight: '700' },
  confirmBtn: { flex: 1, backgroundColor: COLORS.primary, borderRadius: 12, padding: 14, alignItems: 'center' },
  confirmTxt: { color: '#000', fontWeight: '700' },
});
