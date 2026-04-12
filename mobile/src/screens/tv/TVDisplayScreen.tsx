import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  Animated, Dimensions,
} from 'react-native';
import { useSocket } from '../../context/SocketContext';
import { api } from '../../context/AuthContext';
import { COLORS, RANK_CONFIG } from '../../constants';

const { width, height } = Dimensions.get('window');

export default function TVDisplayScreen() {
  const { socket, joinTV } = useSocket();
  const [tables, setTables] = useState<any[]>([]);
  const [queue, setQueue] = useState<any[]>([]);
  const [activeTournament, setActiveTournament] = useState<any>(null);
  const [calledEntry, setCalledEntry] = useState<any>(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const callAnim = new Animated.Value(0);

  useEffect(() => {
    joinTV();
    fetchData();

    // Clock
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);

    // Socket events
    socket?.on('table:updated', fetchData);
    socket?.on('queue:updated', fetchData);
    socket?.on('queue:called', ({ entry }: any) => {
      setCalledEntry(entry);
      // Show for 10 seconds then hide
      Animated.sequence([
        Animated.timing(callAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
        Animated.delay(10000),
        Animated.timing(callAnim, { toValue: 0, duration: 300, useNativeDriver: true }),
      ]).start(() => setCalledEntry(null));
    });
    socket?.on('tournament:bracketsGenerated', (t: any) => setActiveTournament(t));
    socket?.on('match:completed', fetchData);

    return () => {
      clearInterval(timer);
      socket?.off('table:updated');
      socket?.off('queue:updated');
      socket?.off('queue:called');
      socket?.off('tournament:bracketsGenerated');
    };
  }, [socket]);

  const fetchData = async () => {
    try {
      const [tablesRes, queueRes, tournamentsRes] = await Promise.all([
        api.get('/api/tables'),
        api.get('/api/queue'),
        api.get('/api/tournaments'),
      ]);
      setTables(tablesRes.data);
      setQueue(queueRes.data);
      const active = tournamentsRes.data.find((t: any) => t.status === 'IN_PROGRESS');
      if (active) {
        const fullRes = await api.get(`/api/tournaments/${active.id}`);
        setActiveTournament(fullRes.data);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const available = tables.filter((t) => t.status === 'AVAILABLE');
  const occupied = tables.filter((t) => t.status === 'OCCUPIED');
  const timeStr = currentTime.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' });
  const dateStr = currentTime.toLocaleDateString('en-PH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <View style={styles.container}>
      {/* Header Bar */}
      <View style={styles.headerBar}>
        <View style={styles.headerLeft}>
          <Text style={styles.headerLogo}>🎱</Text>
          <View>
            <Text style={styles.headerTitle}>Saturday Nights Billiard</Text>
            <Text style={styles.headerDate}>{dateStr}</Text>
          </View>
        </View>
        <Text style={styles.headerTime}>{timeStr}</Text>
      </View>

      <View style={styles.body}>
        {/* Left: Table Status */}
        <View style={styles.leftPanel}>
          <Text style={styles.panelTitle}>TABLE STATUS</Text>
          <View style={styles.tableGrid}>
            {tables.map((table) => (
              <View
                key={table.id}
                style={[
                  styles.tableCell,
                  table.status === 'AVAILABLE' && styles.tableCellAvailable,
                  table.status === 'OCCUPIED' && styles.tableCellOccupied,
                  table.type === 'VIP' && styles.tableCellVIP,
                ]}
              >
                <Text style={styles.tableCellNumber}>
                  {table.type === 'VIP' ? '👑 ' : ''}T{table.tableNumber}
                </Text>
                <View style={[styles.tableCellDot, {
                  backgroundColor: table.status === 'AVAILABLE' ? COLORS.success : COLORS.error,
                }]} />
                <Text style={styles.tableCellStatus}>{table.status}</Text>
                {table.sessions?.[0] && (
                  <Text style={styles.tableCellTime}>
                    {Math.floor((Date.now() - new Date(table.sessions[0].startTime).getTime()) / 60000)}m
                  </Text>
                )}
                {table.queue?.length > 0 && (
                  <Text style={styles.tableCellQueue}>{table.queue.length} in queue</Text>
                )}
              </View>
            ))}
          </View>

          {/* Stats Row */}
          <View style={styles.statsRow}>
            <View style={styles.statBox}>
              <Text style={styles.statBoxValue}>{available.length}</Text>
              <Text style={styles.statBoxLabel}>Available</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={[styles.statBoxValue, { color: COLORS.error }]}>{occupied.length}</Text>
              <Text style={styles.statBoxLabel}>Occupied</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={[styles.statBoxValue, { color: COLORS.warning }]}>{queue.length}</Text>
              <Text style={styles.statBoxLabel}>Waiting</Text>
            </View>
          </View>
        </View>

        {/* Right: Queue + Tournament */}
        <View style={styles.rightPanel}>
          {/* Queue */}
          <Text style={styles.panelTitle}>QUEUE</Text>
          {queue.length === 0 ? (
            <View style={styles.emptyQueue}>
              <Text style={styles.emptyQueueText}>No one waiting</Text>
            </View>
          ) : (
            <ScrollView keyboardShouldPersistTaps="handled" style={styles.queueList}>
              {queue.slice(0, 8).map((entry: any, index: number) => (
                <View key={entry.id} style={styles.queueItem}>
                  <View style={styles.queuePosition}>
                    <Text style={styles.queuePositionText}>#{index + 1}</Text>
                  </View>
                  <View style={styles.queueInfo}>
                    <Text style={styles.queueName}>
                      {entry.user
                        ? `${entry.user.firstName} ${entry.user.lastName}`
                        : entry.walkinName || 'Walk-in'}
                    </Text>
                    <Text style={styles.queueTable}>Table {entry.table?.tableNumber}</Text>
                  </View>
                  <View style={[styles.queueStatus, { backgroundColor: entry.status === 'CALLED' ? COLORS.success + '30' : COLORS.surfaceLight }]}>
                    <Text style={[styles.queueStatusText, { color: entry.status === 'CALLED' ? COLORS.success : COLORS.textMuted }]}>
                      {entry.status}
                    </Text>
                  </View>
                </View>
              ))}
            </ScrollView>
          )}

          {/* Active Tournament Bracket (simplified) */}
          {activeTournament && (
            <>
              <Text style={[styles.panelTitle, { marginTop: 20 }]}>
                🏆 {activeTournament.name.toUpperCase()}
              </Text>
              <Text style={styles.tournamentFormat}>
                {activeTournament.format.replace(/_/g, ' ')} • {activeTournament.entries?.length} Players
              </Text>
              <ScrollView keyboardShouldPersistTaps="handled" style={styles.matchList}>
                {activeTournament.matches
                  ?.filter((m: any) => m.status === 'IN_PROGRESS' || m.status === 'PENDING')
                  .slice(0, 4)
                  .map((match: any) => {
                    const p1 = activeTournament.entries?.find((e: any) => e.userId === match.player1Id);
                    const p2 = activeTournament.entries?.find((e: any) => e.userId === match.player2Id);
                    return (
                      <View key={match.id} style={styles.matchCard}>
                        <Text style={styles.matchRound}>Round {match.round} • Match {match.matchNumber}</Text>
                        <View style={styles.matchPlayers}>
                          <View style={styles.matchPlayer}>
                            <Text style={styles.matchPlayerRank}>
                              {RANK_CONFIG[p1?.user?.gamifiedProfile?.rank as keyof typeof RANK_CONFIG]?.icon || '🎱'}
                            </Text>
                            <Text style={styles.matchPlayerName} numberOfLines={1}>
                              {p1?.user?.gamifiedProfile?.displayName || p1?.user?.firstName || 'TBD'}
                            </Text>
                          </View>
                          <View style={styles.matchVS}>
                            <Text style={styles.matchVSText}>VS</Text>
                          </View>
                          <View style={[styles.matchPlayer, { alignItems: 'flex-end' }]}>
                            <Text style={styles.matchPlayerRank}>
                              {RANK_CONFIG[p2?.user?.gamifiedProfile?.rank as keyof typeof RANK_CONFIG]?.icon || '🎱'}
                            </Text>
                            <Text style={styles.matchPlayerName} numberOfLines={1}>
                              {p2?.user?.gamifiedProfile?.displayName || p2?.user?.firstName || 'TBD'}
                            </Text>
                          </View>
                        </View>
                        <View style={[styles.matchStatusBadge, {
                          backgroundColor: match.status === 'IN_PROGRESS' ? COLORS.primary + '20' : COLORS.surfaceLight
                        }]}>
                          <Text style={[styles.matchStatusText, {
                            color: match.status === 'IN_PROGRESS' ? COLORS.primary : COLORS.textMuted
                          }]}>
                            {match.status === 'IN_PROGRESS' ? '🔴 LIVE' : 'Upcoming'}
                          </Text>
                        </View>
                      </View>
                    );
                  })}
              </ScrollView>
            </>
          )}
        </View>
      </View>

      {/* Queue Called Overlay */}
      {calledEntry && (
        <Animated.View style={[styles.calledOverlay, { opacity: callAnim }]}>
          <View style={styles.calledCard}>
            <Text style={styles.calledIcon}>📢</Text>
            <Text style={styles.calledTitle}>TABLE READY!</Text>
            <Text style={styles.calledName}>
              {calledEntry.user
                ? `${calledEntry.user.firstName} ${calledEntry.user.lastName}`
                : calledEntry.walkinName || 'Next Customer'}
            </Text>
            <Text style={styles.calledTable}>
              Please proceed to Table {calledEntry.table?.tableNumber}
            </Text>
          </View>
        </Animated.View>
      )}

      {/* Bottom ticker */}
      <View style={styles.ticker}>
        <Text style={styles.tickerText}>
          🎱 Welcome to Saturday Nights Billiard • Register for membership to earn loyalty rewards and join tournaments • Ask staff for details
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  headerBar: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: COLORS.surface, paddingHorizontal: 32, paddingVertical: 16,
    borderBottomWidth: 2, borderBottomColor: COLORS.primary,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  headerLogo: { fontSize: 36 },
  headerTitle: { fontSize: 22, fontWeight: '900', color: COLORS.textPrimary, letterSpacing: 2 },
  headerDate: { fontSize: 13, color: COLORS.textSecondary },
  headerTime: { fontSize: 42, fontWeight: '900', color: COLORS.primary, fontVariant: ['tabular-nums'] },
  body: { flex: 1, flexDirection: 'row', padding: 20, gap: 20 },
  leftPanel: { flex: 1.2 },
  rightPanel: { flex: 1 },
  panelTitle: { fontSize: 13, fontWeight: '900', color: COLORS.textMuted, letterSpacing: 3, marginBottom: 12 },
  tableGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  tableCell: {
    width: '30%', backgroundColor: COLORS.surface,
    borderRadius: 12, padding: 12, alignItems: 'center',
    borderWidth: 2, borderColor: COLORS.surfaceBorder, gap: 4,
  },
  tableCellAvailable: { borderColor: COLORS.success + '80' },
  tableCellOccupied: { borderColor: COLORS.error + '80' },
  tableCellVIP: { borderColor: COLORS.gold + '80' },
  tableCellNumber: { fontSize: 16, fontWeight: '800', color: COLORS.textPrimary },
  tableCellDot: { width: 10, height: 10, borderRadius: 5 },
  tableCellStatus: { fontSize: 10, color: COLORS.textSecondary, fontWeight: '700' },
  tableCellTime: { fontSize: 12, color: COLORS.warning },
  tableCellQueue: { fontSize: 10, color: COLORS.info },
  statsRow: { flexDirection: 'row', gap: 10 },
  statBox: {
    flex: 1, backgroundColor: COLORS.surface, borderRadius: 12,
    padding: 16, alignItems: 'center',
    borderWidth: 1, borderColor: COLORS.surfaceBorder,
  },
  statBoxValue: { fontSize: 32, fontWeight: '900', color: COLORS.success },
  statBoxLabel: { fontSize: 12, color: COLORS.textMuted, fontWeight: '600' },
  emptyQueue: { backgroundColor: COLORS.surface, borderRadius: 12, padding: 24, alignItems: 'center' },
  emptyQueueText: { color: COLORS.textMuted, fontSize: 14 },
  queueList: { maxHeight: 240 },
  queueItem: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: COLORS.surface, borderRadius: 10,
    padding: 12, marginBottom: 8,
    borderWidth: 1, borderColor: COLORS.surfaceBorder,
  },
  queuePosition: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: COLORS.primary + '20',
    justifyContent: 'center', alignItems: 'center',
  },
  queuePositionText: { fontSize: 14, fontWeight: '800', color: COLORS.primary },
  queueInfo: { flex: 1 },
  queueName: { fontSize: 14, fontWeight: '700', color: COLORS.textPrimary },
  queueTable: { fontSize: 11, color: COLORS.textMuted },
  queueStatus: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  queueStatusText: { fontSize: 11, fontWeight: '700' },
  tournamentFormat: { fontSize: 12, color: COLORS.textSecondary, marginBottom: 10 },
  matchList: { maxHeight: 220 },
  matchCard: {
    backgroundColor: COLORS.surface, borderRadius: 10,
    padding: 12, marginBottom: 8,
    borderWidth: 1, borderColor: COLORS.surfaceBorder, gap: 8,
  },
  matchRound: { fontSize: 11, color: COLORS.textMuted, fontWeight: '600' },
  matchPlayers: { flexDirection: 'row', alignItems: 'center' },
  matchPlayer: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  matchPlayerRank: { fontSize: 16 },
  matchPlayerName: { fontSize: 13, fontWeight: '700', color: COLORS.textPrimary, flex: 1 },
  matchVS: { paddingHorizontal: 10 },
  matchVSText: { fontSize: 11, fontWeight: '900', color: COLORS.textMuted },
  matchStatusBadge: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  matchStatusText: { fontSize: 11, fontWeight: '700' },
  calledOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: 'center', alignItems: 'center',
    backgroundColor: '#000000CC',
  },
  calledCard: {
    backgroundColor: COLORS.surface, borderRadius: 24,
    padding: 40, alignItems: 'center', gap: 12,
    borderWidth: 3, borderColor: COLORS.primary,
    maxWidth: 400,
  },
  calledIcon: { fontSize: 48 },
  calledTitle: { fontSize: 32, fontWeight: '900', color: COLORS.primary, letterSpacing: 4 },
  calledName: { fontSize: 24, fontWeight: '800', color: COLORS.textPrimary },
  calledTable: { fontSize: 18, color: COLORS.textSecondary },
  ticker: {
    backgroundColor: COLORS.primary, paddingHorizontal: 20, paddingVertical: 10,
  },
  tickerText: { color: '#000', fontSize: 13, fontWeight: '600' },
});
