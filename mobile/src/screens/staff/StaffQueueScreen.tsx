import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  RefreshControl, Alert, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../context/AuthContext';
import { useSocket } from '../../context/SocketContext';
import { COLORS } from '../../constants';

export default function StaffQueueScreen() {
  const { socket } = useSocket();
  const [queue, setQueue] = useState<any[]>([]);
  const [tables, setTables] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [qRes, tRes] = await Promise.all([
        api.get('/api/queue'),
        api.get('/api/tables'),
      ]);
      setQueue(qRes.data);
      setTables(tRes.data);
    } catch { }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => {
    fetchData();
    socket?.on('queue:updated', fetchData);
    socket?.on('queue:called', fetchData);
    socket?.on('queue:removed', fetchData);
    socket?.on('table:updated', fetchData);
    return () => {
      socket?.off('queue:updated');
      socket?.off('queue:called');
      socket?.off('queue:removed');
      socket?.off('table:updated');
    };
  }, [socket]);

  const removeFromQueue = (entryId: string, name: string) => {
    Alert.alert('Remove from Queue', `Remove ${name} from the queue?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive', onPress: async () => {
          try {
            await api.patch(`/api/queue/${entryId}/remove`);
            fetchData();
          } catch { Alert.alert('Error', 'Failed to remove'); }
        }
      }
    ]);
  };

  const callNext = async (tableId: string) => {
    const next = queue.find(q => q.tableId === tableId && q.status === 'WAITING');
    if (!next) return Alert.alert('Info', 'No one waiting for this table');
    Alert.alert(
      'Call Next Customer',
      `Notify ${next.user ? `${next.user.firstName} ${next.user.lastName}` : next.walkinName || 'Walk-in'} that their table is ready?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Call Now', onPress: async () => {
            try {
              await api.patch(`/api/queue/${next.id}/remove`);
              fetchData();
              Alert.alert('✅ Called', 'Notification sent and TV display updated');
            } catch { Alert.alert('Error', 'Failed'); }
          }
        }
      ]
    );
  };

  const totalWaiting = queue.filter(q => q.status === 'WAITING').length;
  const avgWait = tables.filter(t => t.status === 'OCCUPIED').length > 0
    ? Math.round(totalWaiting * 15) : 0; // rough estimate

  if (loading) return <View style={s.center}><ActivityIndicator size="large" color={COLORS.primary} /></View>;

  return (
    <View style={s.container}>
      <View style={s.header}>
        <Text style={s.title}>⏱️ Queue Management</Text>
        <Text style={s.subtitle}>{totalWaiting} waiting • ~{avgWait}min avg wait</Text>
      </View>

      <ScrollView
        contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchData(); }} tintColor={COLORS.primary} />}
      >
        {/* Summary Row */}
        <View style={s.summaryRow}>
          <View style={s.summaryCard}>
            <Text style={s.summaryVal}>{totalWaiting}</Text>
            <Text style={s.summaryLbl}>Waiting</Text>
          </View>
          <View style={s.summaryCard}>
            <Text style={[s.summaryVal, { color: COLORS.success }]}>
              {tables.filter(t => t.status === 'AVAILABLE').length}
            </Text>
            <Text style={s.summaryLbl}>Available Tables</Text>
          </View>
          <View style={s.summaryCard}>
            <Text style={[s.summaryVal, { color: COLORS.error }]}>
              {tables.filter(t => t.status === 'OCCUPIED').length}
            </Text>
            <Text style={s.summaryLbl}>Occupied</Text>
          </View>
        </View>

        {/* Queue by table */}
        {tables.map(table => {
          const tableQueue = queue.filter(q => q.tableId === table.id && q.status === 'WAITING');
          const calledEntry = queue.find(q => q.tableId === table.id && q.status === 'CALLED');

          return (
            <View key={table.id} style={s.tableSection}>
              <View style={s.tableSectionHeader}>
                <View style={s.tableSectionLeft}>
                  <Text style={s.tableSectionName}>
                    {table.type === 'VIP' ? '👑 ' : '🎱 '}Table {table.tableNumber}
                  </Text>
                  <View style={[s.tableStatusBadge, {
                    backgroundColor: (table.status === 'AVAILABLE' ? COLORS.success : table.status === 'OCCUPIED' ? COLORS.error : COLORS.warning) + '25'
                  }]}>
                    <Text style={[s.tableStatusTxt, {
                      color: table.status === 'AVAILABLE' ? COLORS.success : table.status === 'OCCUPIED' ? COLORS.error : COLORS.warning
                    }]}>{table.status}</Text>
                  </View>
                </View>
                {table.status === 'OCCUPIED' && tableQueue.length > 0 && (
                  <TouchableOpacity style={s.callNextBtn} onPress={() => callNext(table.id)}>
                    <Ionicons name="megaphone-outline" size={14} color="#000" />
                    <Text style={s.callNextTxt}>Call Next</Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* Called entry banner */}
              {calledEntry && (
                <View style={s.calledBanner}>
                  <Ionicons name="megaphone" size={16} color={COLORS.success} />
                  <Text style={s.calledBannerTxt}>
                    CALLED: {calledEntry.user ? `${calledEntry.user.firstName} ${calledEntry.user.lastName}` : calledEntry.walkinName || 'Walk-in'}
                  </Text>
                </View>
              )}

              {tableQueue.length === 0 ? (
                <Text style={s.noQueue}>No one in queue for this table</Text>
              ) : (
                tableQueue.map((entry: any, i: number) => {
                  const name = entry.user
                    ? `${entry.user.firstName} ${entry.user.lastName}`
                    : entry.walkinName || 'Walk-in';
                  const waitMinutes = Math.floor((Date.now() - new Date(entry.createdAt).getTime()) / 60000);
                  return (
                    <View key={entry.id} style={[s.queueEntry, i === 0 && s.queueEntryFirst]}>
                      <View style={[s.queuePos, i === 0 && s.queuePosFirst]}>
                        <Text style={[s.queuePosTxt, i === 0 && s.queuePosTxtFirst]}>#{i + 1}</Text>
                      </View>
                      <View style={s.queueInfo}>
                        <Text style={s.queueName}>{name}</Text>
                        <View style={s.queueMeta}>
                          <Ionicons name="people-outline" size={12} color={COLORS.textMuted} />
                          <Text style={s.queueMetaTxt}>Party of {entry.partySize}</Text>
                          <Ionicons name="time-outline" size={12} color={COLORS.textMuted} />
                          <Text style={s.queueMetaTxt}>{waitMinutes}m waiting</Text>
                          {entry.user && (
                            <>
                              <Ionicons name="wallet-outline" size={12} color={COLORS.textMuted} />
                              <Text style={s.queueMetaTxt}>{entry.user.membership?.creditBalance?.toFixed(0) || 0} cr</Text>
                            </>
                          )}
                        </View>
                        {entry.user?.gamifiedProfile && (
                          <Text style={s.queueRank}>
                            {entry.user.gamifiedProfile.rank} · {entry.user.gamifiedProfile.totalWins}W
                          </Text>
                        )}
                      </View>
                      <TouchableOpacity
                        style={s.removeBtn}
                        onPress={() => removeFromQueue(entry.id, name)}
                      >
                        <Ionicons name="close-circle-outline" size={22} color={COLORS.error} />
                      </TouchableOpacity>
                    </View>
                  );
                })
              )}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background },
  header: { paddingTop: 60, paddingHorizontal: 20, paddingBottom: 16, backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.surfaceBorder },
  title: { fontSize: 22, fontWeight: '800', color: COLORS.textPrimary },
  subtitle: { fontSize: 13, color: COLORS.textSecondary, marginTop: 2 },
  content: { padding: 16, gap: 14, paddingBottom: 40 },
  summaryRow: { flexDirection: 'row', gap: 10 },
  summaryCard: { flex: 1, backgroundColor: COLORS.surface, borderRadius: 14, padding: 16, alignItems: 'center', gap: 4, borderWidth: 1, borderColor: COLORS.surfaceBorder },
  summaryVal: { fontSize: 28, fontWeight: '900', color: COLORS.warning },
  summaryLbl: { fontSize: 10, color: COLORS.textMuted, textAlign: 'center' },
  tableSection: { backgroundColor: COLORS.surface, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.surfaceBorder },
  tableSectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14, borderBottomWidth: 1, borderBottomColor: COLORS.surfaceBorder },
  tableSectionLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  tableSectionName: { fontSize: 16, fontWeight: '800', color: COLORS.textPrimary },
  tableStatusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  tableStatusTxt: { fontSize: 10, fontWeight: '700' },
  callNextBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: COLORS.primary, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  callNextTxt: { color: '#000', fontSize: 12, fontWeight: '700' },
  calledBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: COLORS.success + '20', padding: 10, borderBottomWidth: 1, borderBottomColor: COLORS.success + '30' },
  calledBannerTxt: { fontSize: 13, fontWeight: '700', color: COLORS.success },
  noQueue: { padding: 16, fontSize: 13, color: COLORS.textMuted, textAlign: 'center', fontStyle: 'italic' },
  queueEntry: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderBottomWidth: 1, borderBottomColor: COLORS.surfaceBorder },
  queueEntryFirst: { backgroundColor: COLORS.primary + '08' },
  queuePos: { width: 32, height: 32, borderRadius: 16, backgroundColor: COLORS.surfaceLight, justifyContent: 'center', alignItems: 'center' },
  queuePosFirst: { backgroundColor: COLORS.primary + '20' },
  queuePosTxt: { fontSize: 13, fontWeight: '800', color: COLORS.textMuted },
  queuePosTxtFirst: { color: COLORS.primary },
  queueInfo: { flex: 1, gap: 3 },
  queueName: { fontSize: 15, fontWeight: '700', color: COLORS.textPrimary },
  queueMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  queueMetaTxt: { fontSize: 11, color: COLORS.textMuted },
  queueRank: { fontSize: 11, color: COLORS.primary },
  removeBtn: { padding: 4 },
});
