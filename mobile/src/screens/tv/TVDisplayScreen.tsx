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
  const [announcement, setAnnouncement] = useState<any>(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const callAnim = new Animated.Value(0);

  useEffect(() => {
    joinTV();
    fetchData();

    // Clock
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    const resync = setInterval(fetchData, 30000);

    // Socket events
    socket?.on('table:updated', fetchData);
    socket?.on('queue:updated', fetchData);
    socket?.on('reservation:new', fetchData);
    socket?.on('reservation:updated', fetchData);
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
    socket?.on('match:started', fetchData);
    socket?.on('match:updated', fetchData);
    socket?.on('notification:broadcast', (message: any) => setAnnouncement(message));
    socket?.on('connect', () => { joinTV(); fetchData(); });

    return () => {
      clearInterval(timer);
      clearInterval(resync);
      socket?.off('table:updated');
      socket?.off('queue:updated');
      socket?.off('reservation:new');
      socket?.off('reservation:updated');
      socket?.off('queue:called');
      socket?.off('tournament:bracketsGenerated');
      socket?.off('match:completed');
      socket?.off('match:started');
      socket?.off('match:updated');
      socket?.off('notification:broadcast');
      socket?.off('connect');
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
      const completed = tournamentsRes.data.filter((t: any) => t.status === 'COMPLETED');
      // The shared list is newest-first; retain the TV's existing behavior of
      // highlighting the most recently completed tournament when none is live.
      const highlighted = tournamentsRes.data.find((t: any) => t.status === 'IN_PROGRESS') || completed[0];
      if (highlighted) {
        const fullRes = await api.get(`/api/tournaments/${highlighted.id}`);
        setActiveTournament(fullRes.data);
      } else setActiveTournament(null);
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
            {tables.map((table) => {
              const tableQueue = queue.filter((entry: any) => entry.tableId === table.id);
              const nextEntry = tableQueue.find((entry: any) => entry.position === 1);
              const reservation = table.nextReservation || table.reservations?.[0];
              return <View
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
                <Text style={styles.tableCellStatus}>{table.status.replace('_', ' ')}</Text>
                {table.sessions?.[0] && (
                  <Text style={styles.tableCellTime}>
                    {table.sessions[0].isWalkin && table.sessions[0].expectedEndTime
                      ? `Until ${new Date(table.sessions[0].expectedEndTime).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })}`
                      : `${Math.floor((Date.now() - new Date(table.sessions[0].startTime).getTime()) / 60000)}m`}
                  </Text>
                )}
                {tableQueue.length > 0 && <Text style={styles.tableCellQueue}>{tableQueue.length} scheduled</Text>}
                {nextEntry && <Text style={styles.tableCellNext} numberOfLines={1}>NEXT: {nextEntry.user?.firstName || 'Member'} · {new Date(nextEntry.startTime).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })}</Text>}
                {reservation && <Text style={styles.tableCellReservation}>Reserved {new Date(reservation.startTime).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })}</Text>}
              </View>
            })}
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
              <Text style={styles.statBoxLabel}>Scheduled</Text>
            </View>
          </View>
        </View>

        {/* Right: Queue + Tournament */}
        <View style={styles.rightPanel}>
          {/* Queue */}
          <Text style={styles.panelTitle}>UPCOMING RESERVATIONS</Text>
          {queue.length === 0 ? (
            <View style={styles.emptyQueue}>
              <Text style={styles.emptyQueueText}>No upcoming reservations</Text>
            </View>
          ) : (
            <ScrollView keyboardShouldPersistTaps="handled" style={styles.queueList}>
              {queue.slice(0, 8).map((entry: any) => (
                <View key={entry.id} style={styles.queueItem}>
                  <View style={styles.queuePosition}>
                    <Text style={styles.queuePositionText}>#{entry.position}</Text>
                  </View>
                  <View style={styles.queueInfo}>
                    <Text style={styles.queueName}>
                      {entry.user
                        ? `${entry.user.firstName} ${entry.user.lastName}`
                        : entry.walkinName || 'Walk-in'}
                    </Text>
                    <Text style={styles.queueTable}>Table {entry.table?.tableNumber} · {new Date(entry.startTime).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })}</Text>
                  </View>
                  <View style={[styles.queueStatus, { backgroundColor: entry.status === 'APPROVED' ? COLORS.success + '30' : COLORS.surfaceLight }]}>
                    <Text style={[styles.queueStatusText, { color: entry.status === 'APPROVED' ? COLORS.success : COLORS.textMuted }]}>
                      {entry.status}
                    </Text>
                  </View>
                </View>
              ))}
            </ScrollView>
          )}

          <TVTournamentPanel tournament={activeTournament} />

          {/* Historical simplified panel retained for source history only. */}
          {false && activeTournament && (
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

      {announcement && (
        <View style={styles.announcementBanner}>
          <Text style={styles.announcementText}>ANNOUNCEMENT: {announcement.title} — {announcement.message}</Text>
        </View>
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

const playerName = (entries: any[], userId: string | null) => {
  const entry = entries?.find((candidate: any) => candidate.userId === userId);
  return entry?.user?.gamifiedProfile?.displayName || entry?.user?.firstName || 'TBD';
};

function TVTournamentPanel({ tournament }: any) {
  if (!tournament) return null;
  const matches = (tournament.matches || []).filter(Boolean).filter((match: any) => !match.isResetFinal || match.player1Id || match.player2Id || match.status === 'COMPLETED' || match.status === 'IN_PROGRESS');
  const live = matches.filter((match: any) => match.status === 'IN_PROGRESS');
  const stages = tournament.format === 'DOUBLE_ELIMINATION'
    ? ['WINNERS', 'LOSERS', 'GRAND_FINAL', 'RESET_FINAL']
    : ['WINNERS', 'GRAND_FINAL'];
  const grouped = stages.map((stage) => ({ stage, matches: matches.filter((match: any) => (match.bracketStage || 'WINNERS') === stage) })).filter((group) => group.matches.length);
  if (!grouped.length && matches.length) grouped.push({ stage: 'RESULTS', matches });
  return <View style={styles.tvTournamentPanel}>
    <Text style={[styles.panelTitle, { marginTop: 20 }]}>TOURNAMENT</Text>
    <Text style={styles.tvTournamentName}>{tournament.name}</Text>
    <Text style={styles.tournamentFormat}>{tournament.format.replace(/_/g, ' ')} · Race To {tournament.raceTo || 5} · {tournament.entries?.length || 0} Players</Text>
    {tournament.status === 'COMPLETED' && <View style={styles.tvChampion}><Text style={styles.tvChampionLabel}>CHAMPION</Text><Text style={styles.tvChampionName}>{tournament.championTitle?.user?.gamifiedProfile?.displayName || tournament.championTitle?.user?.firstName || 'Tournament complete'}</Text></View>}
    {live.length > 0 && <><Text style={styles.tvLiveHeading}>LIVE NOW</Text>{live.map((match: any) => <TVMatch key={match.id} match={match} tournament={tournament} live />)}</>}
    {grouped.map((group) => <View key={group.stage}><Text style={styles.tvStageTitle}>{group.stage === 'WINNERS' ? 'Winners Bracket' : group.stage === 'LOSERS' ? 'Losers Bracket' : group.stage === 'GRAND_FINAL' ? 'Grand Final' : group.stage === 'RESET_FINAL' ? 'Reset Final' : 'Results'}</Text>{group.matches.filter((match: any) => match.status !== 'IN_PROGRESS').slice(0, 6).map((match: any) => <TVMatch key={match.id} match={match} tournament={tournament} />)}</View>)}
    {!matches.length && <Text style={styles.emptyQueueText}>Bracket not generated yet</Text>}
  </View>;
}

function TVMatch({ match, tournament, live = false }: any) {
  if (!match) return null;
  const p1 = playerName(tournament.entries, match.player1Id);
  const p2 = playerName(tournament.entries, match.player2Id);
  return <View style={[styles.matchCard, live && styles.tvMatchLive]}>
    <Text style={styles.matchRound}>{match.isResetFinal ? 'Reset Final' : match.isGrandFinal ? 'Grand Final' : `Round ${match.round} · Match ${match.matchNumber}`}{match.table?.tableNumber ? ` · Table ${match.table.tableNumber}` : ''}</Text>
    <Text style={styles.tvMatchNames}>{p1} <Text style={styles.matchVSText}>vs</Text> {p2}</Text>
    {match.status === 'BYE' ? <Text style={styles.tvMatchDetail}>BYE — Auto advance</Text> : <Text style={styles.tvMatchDetail}>{live ? 'LIVE' : match.status === 'COMPLETED' ? `${match.player1Score} – ${match.player2Score}` : match.scheduledAt ? new Date(match.scheduledAt).toLocaleString('en-PH', { dateStyle: 'short', timeStyle: 'short' }) : 'Upcoming'}</Text>}
  </View>;
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
  tableCellNext: { fontSize: 10, color: COLORS.primary, fontWeight: '800', maxWidth: '100%' },
  tableCellReservation: { fontSize: 9, color: COLORS.warning, textAlign: 'center' },
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
  tvTournamentPanel: { marginTop: 2 },
  tvTournamentName: { color: COLORS.gold, fontSize: 18, fontWeight: '900', marginBottom: 3 },
  tvLiveHeading: { color: COLORS.error, fontSize: 12, fontWeight: '900', letterSpacing: 2, marginTop: 8, marginBottom: 5 },
  tvStageTitle: { color: COLORS.primary, fontSize: 11, fontWeight: '900', letterSpacing: 1, marginTop: 12, marginBottom: 5 },
  tvChampion: { backgroundColor: COLORS.gold + '20', borderWidth: 1, borderColor: COLORS.gold + '80', borderRadius: 10, padding: 10, marginBottom: 8 },
  tvChampionLabel: { color: COLORS.gold, fontWeight: '900', fontSize: 10, letterSpacing: 1 },
  tvChampionName: { color: COLORS.textPrimary, fontWeight: '900', fontSize: 17 },
  tvMatchLive: { borderColor: COLORS.error, borderWidth: 2 },
  tvMatchNames: { color: COLORS.textPrimary, fontWeight: '800', fontSize: 13, textAlign: 'center' },
  tvMatchDetail: { color: COLORS.textSecondary, fontSize: 11, textAlign: 'center' },
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
  announcementBanner: { backgroundColor: COLORS.warning + '25', borderTopWidth: 1, borderTopColor: COLORS.warning, paddingHorizontal: 20, paddingVertical: 10 },
  announcementText: { color: COLORS.warning, fontSize: 14, fontWeight: '800', textAlign: 'center' },
});
