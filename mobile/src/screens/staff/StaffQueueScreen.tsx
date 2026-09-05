import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../context/AuthContext';
import { useSocket } from '../../context/SocketContext';
import { COLORS } from '../../constants';

const formatTime = (value: string) => new Date(value).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' });

export default function StaffQueueScreen() {
  const { socket } = useSocket();
  const [schedule, setSchedule] = useState<any[]>([]);
  const [tables, setTables] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const fetchData = useCallback(async () => {
    try {
      const [scheduleResponse, tablesResponse] = await Promise.all([api.get('/api/queue'), api.get('/api/tables')]);
      setSchedule(Array.isArray(scheduleResponse.data) ? scheduleResponse.data : []);
      setTables(Array.isArray(tablesResponse.data) ? tablesResponse.data : []);
    } finally { setLoading(false); setRefreshing(false); }
  }, []);
  useEffect(() => {
    fetchData(); socket?.on('queue:updated', fetchData); socket?.on('reservation:new', fetchData); socket?.on('reservation:updated', fetchData); socket?.on('table:updated', fetchData);
    return () => { socket?.off('queue:updated', fetchData); socket?.off('reservation:new', fetchData); socket?.off('reservation:updated', fetchData); socket?.off('table:updated', fetchData); };
  }, [fetchData, socket]);
  if (loading) return <View style={s.center}><ActivityIndicator size="large" color={COLORS.primary} /></View>;
  return <View style={s.container}>
    <View style={s.header}><Text style={s.title}>⏱️ Reservation Schedule</Text><Text style={s.subtitle}>{schedule.length} upcoming reservation{schedule.length === 1 ? '' : 's'} · ordered by start time</Text></View>
    <ScrollView contentContainerStyle={s.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchData(); }} tintColor={COLORS.primary} />}>
      {tables.map((table) => {
        const entries = schedule.filter((entry) => entry.tableId === table.id);
        return <View key={table.id} style={s.tableCard}>
          <View style={s.tableTop}><Text style={s.tableName}>{table.type === 'VIP' ? '👑 ' : '🎱 '}Table {table.tableNumber}</Text><Text style={[s.tableStatus, { color: table.status === 'AVAILABLE' ? COLORS.success : table.status === 'OCCUPIED' ? COLORS.error : COLORS.warning }]}>{table.status}</Text></View>
          {entries.length === 0 ? <Text style={s.empty}>No upcoming reservations.</Text> : entries.map((entry) => <View key={entry.id} style={s.entry}><View style={s.position}><Text style={s.positionText}>#{entry.position}</Text></View><View style={{ flex: 1 }}><Text style={s.name}>{entry.user ? `${entry.user.firstName} ${entry.user.lastName}` : 'Member'}</Text><Text style={s.time}>{formatTime(entry.startTime)} – {formatTime(entry.endTime)}</Text><Text style={s.entryStatus}>{entry.status}</Text></View><Ionicons name="calendar-outline" size={18} color={COLORS.primary} /></View>)}
        </View>;
      })}
    </ScrollView>
  </View>;
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background }, center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.background }, header: { paddingTop: 60, paddingHorizontal: 20, paddingBottom: 16, backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.surfaceBorder }, title: { fontSize: 22, fontWeight: '800', color: COLORS.textPrimary }, subtitle: { fontSize: 13, color: COLORS.textSecondary, marginTop: 2 }, content: { padding: 16, gap: 14, paddingBottom: 40 }, tableCard: { backgroundColor: COLORS.surface, borderRadius: 16, borderWidth: 1, borderColor: COLORS.surfaceBorder, overflow: 'hidden' }, tableTop: { flexDirection: 'row', justifyContent: 'space-between', padding: 14, borderBottomWidth: 1, borderBottomColor: COLORS.surfaceBorder }, tableName: { fontSize: 16, fontWeight: '800', color: COLORS.textPrimary }, tableStatus: { fontSize: 12, fontWeight: '800' }, empty: { padding: 16, color: COLORS.textMuted, fontStyle: 'italic' }, entry: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderBottomWidth: 1, borderBottomColor: COLORS.surfaceBorder }, position: { width: 32, height: 32, borderRadius: 16, backgroundColor: COLORS.primary + '20', alignItems: 'center', justifyContent: 'center' }, positionText: { color: COLORS.primary, fontWeight: '900' }, name: { color: COLORS.textPrimary, fontSize: 15, fontWeight: '700' }, time: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 }, entryStatus: { color: COLORS.textMuted, fontSize: 11, marginTop: 2 },
});
