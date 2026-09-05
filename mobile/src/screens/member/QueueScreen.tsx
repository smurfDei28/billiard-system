import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api, useAuth } from '../../context/AuthContext';
import { useSocket } from '../../context/SocketContext';
import { COLORS } from '../../constants';

const formatTime = (value: string) => new Date(value).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' });
const formatExpectedEnd = (start: string, end: string) => {
  const startDate = new Date(start);
  const endDate = new Date(end);
  return `${formatTime(end)}${startDate.toDateString() === endDate.toDateString() ? '' : ' (Next Day)'}`;
};

export default function QueueScreen({ navigation }: any) {
  const { user } = useAuth();
  const { socket } = useSocket();
  const [tables, setTables] = useState<any[]>([]);
  const [schedule, setSchedule] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [tablesResponse, scheduleResponse] = await Promise.all([api.get('/api/tables'), api.get('/api/queue')]);
      setTables(Array.isArray(tablesResponse.data) ? tablesResponse.data : []);
      setSchedule(Array.isArray(scheduleResponse.data) ? scheduleResponse.data : []);
    } finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => {
    fetchData();
    socket?.on('queue:updated', fetchData);
    socket?.on('reservation:new', fetchData);
    socket?.on('reservation:updated', fetchData);
    socket?.on('table:updated', fetchData);
    return () => {
      socket?.off('queue:updated', fetchData);
      socket?.off('reservation:new', fetchData);
      socket?.off('reservation:updated', fetchData);
      socket?.off('table:updated', fetchData);
    };
  }, [fetchData, socket]);

  if (loading) return <View style={s.center}><ActivityIndicator size="large" color={COLORS.primary} /></View>;
  const myReservations = schedule.filter((entry) => entry.userId === user?.id);

  return <View style={s.container}>
    <View style={s.header}><Text style={s.title}>⏱️ Reservation Queue</Text><Text style={s.subtitle}>Queue positions are based on table reservations.</Text></View>
    <ScrollView contentContainerStyle={s.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchData(); }} tintColor={COLORS.primary} />}>
      <View style={s.infoCard}><Ionicons name="calendar-outline" size={20} color={COLORS.primary} /><Text style={s.infoText}>To reserve your place for an occupied table, create a reservation for an available time.</Text><TouchableOpacity onPress={() => navigation.navigate('Reservations')}><Text style={s.reserveLink}>View Reservations</Text></TouchableOpacity></View>
      {myReservations.length > 0 && <><Text style={s.sectionTitle}>Your Upcoming Reservations</Text>{myReservations.map((entry) => <View key={entry.id} style={s.myCard}><Text style={s.myTable}>Table {entry.table?.tableNumber}</Text><Text style={s.myPosition}>Position #{entry.position}</Text><Text style={s.time}>{formatTime(entry.startTime)} – {formatTime(entry.endTime)}</Text><Text style={s.status}>{entry.status === 'PENDING' ? 'Pending staff approval' : 'Approved'}</Text></View>)}</>}
      <Text style={s.sectionTitle}>Table Schedules</Text>
      {tables.map((table) => {
        const tableSchedule = schedule.filter((entry) => entry.tableId === table.id);
        const activeSession = table.sessions?.[0];
        return <View key={table.id} style={s.tableCard}>
          <View style={s.tableTop}><View><Text style={s.tableName}>{table.type === 'VIP' ? '👑 ' : '🎱 '}Table {table.tableNumber}</Text><Text style={[s.tableStatus, { color: table.status === 'AVAILABLE' ? COLORS.success : table.status === 'OCCUPIED' ? COLORS.error : COLORS.warning }]}>{table.status}</Text></View><Text style={s.rate}>₱{table.ratePerHour}/hr</Text></View>
          {activeSession?.isWalkin && <View style={s.currentSession}><Text style={s.currentSessionTitle}>Current Walk-In</Text><Text style={s.time}>Start: {formatTime(activeSession.startTime)}</Text><Text style={s.time}>End: {activeSession.expectedEndTime ? formatExpectedEnd(activeSession.startTime, activeSession.expectedEndTime) : 'Ongoing'}</Text></View>}
          {tableSchedule.length === 0 ? <Text style={s.empty}>No upcoming reservations.</Text> : tableSchedule.map((entry) => <View key={entry.id} style={s.scheduleRow}><Text style={s.position}>#{entry.position}</Text><View style={{ flex: 1 }}><Text style={s.time}>{formatTime(entry.startTime)} – {formatTime(entry.endTime)}</Text><Text style={s.rowStatus}>{entry.userId === user?.id ? 'Your reservation' : entry.status === 'PENDING' ? 'Pending reservation' : 'Reserved'}</Text></View></View>)}
        </View>;
      })}
    </ScrollView>
  </View>;
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background }, center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background },
  header: { paddingTop: 60, paddingHorizontal: 20, paddingBottom: 16, backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.surfaceBorder }, title: { fontSize: 22, fontWeight: '800', color: COLORS.textPrimary }, subtitle: { fontSize: 13, color: COLORS.textSecondary, marginTop: 2 }, content: { padding: 16, gap: 12, paddingBottom: 36 },
  infoCard: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, backgroundColor: COLORS.primary + '12', borderWidth: 1, borderColor: COLORS.primary + '40', borderRadius: 14, padding: 14 }, infoText: { flex: 1, minWidth: 200, fontSize: 13, lineHeight: 19, color: COLORS.textSecondary }, reserveLink: { color: COLORS.primary, fontSize: 13, fontWeight: '800' },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: COLORS.textPrimary, marginTop: 4 }, myCard: { backgroundColor: COLORS.surface, borderRadius: 14, padding: 14, gap: 3, borderWidth: 1, borderColor: COLORS.primary + '55' }, myTable: { fontSize: 17, fontWeight: '800', color: COLORS.textPrimary }, myPosition: { color: COLORS.primary, fontWeight: '700' }, time: { color: COLORS.textSecondary, fontSize: 13 }, status: { color: COLORS.textMuted, fontSize: 12 },
  tableCard: { backgroundColor: COLORS.surface, borderRadius: 14, padding: 14, gap: 8, borderWidth: 1, borderColor: COLORS.surfaceBorder }, tableTop: { flexDirection: 'row', justifyContent: 'space-between' }, tableName: { fontSize: 16, fontWeight: '800', color: COLORS.textPrimary }, tableStatus: { fontSize: 12, fontWeight: '700' }, rate: { color: COLORS.primary, fontWeight: '700' }, currentSession: { backgroundColor: COLORS.error + '12', borderRadius: 8, padding: 9, gap: 2 }, currentSessionTitle: { color: COLORS.textSecondary, fontSize: 11, fontWeight: '800', textTransform: 'uppercase' }, empty: { color: COLORS.textMuted, fontSize: 13, fontStyle: 'italic' }, scheduleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: COLORS.surfaceLight, borderRadius: 8, padding: 9 }, position: { color: COLORS.textMuted, fontWeight: '800', width: 24 }, rowStatus: { color: COLORS.textMuted, fontSize: 11, marginTop: 2 },
});
