import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  RefreshControl, ActivityIndicator, Alert, Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../context/AuthContext';
import { useSocket } from '../../context/SocketContext';
import { useAuth } from '../../context/AuthContext';
import { COLORS, RANK_CONFIG } from '../../constants';

const FORMAT_LABELS: Record<string, string> = {
  SINGLE_ELIMINATION: 'Single Elimination',
  DOUBLE_ELIMINATION: 'Double Elimination',
  ROUND_ROBIN: 'Round Robin',
};

const STATUS_COLORS: Record<string, string> = {
  UPCOMING: COLORS.info,
  REGISTRATION_OPEN: COLORS.success,
  IN_PROGRESS: COLORS.gold,
  COMPLETED: COLORS.textMuted,
  CANCELLED: COLORS.error,
};

export default function TournamentListScreen() {
  const { user } = useAuth();
  const { socket, joinTournament } = useSocket();
  const [tournaments, setTournaments] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [registering, setRegistering] = useState(false);

  const fetchTournaments = useCallback(async () => {
    try {
      const res = await api.get('/api/tournaments');
      setTournaments(res.data);
    } catch { }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  const openTournament = async (t: any) => {
    try {
      const res = await api.get(`/api/tournaments/${t.id}`);
      setSelected(res.data);
      joinTournament(t.id);
    } catch { Alert.alert('Error', 'Failed to load tournament'); }
  };

  useEffect(() => {
    fetchTournaments();
    socket?.on('tournament:created', fetchTournaments);
    socket?.on('tournament:bracketsGenerated', (t: any) => {
      if (selected?.id === t.id) setSelected(t);
    });
    socket?.on('match:completed', async () => {
      if (selected) {
        const res = await api.get(`/api/tournaments/${selected.id}`);
        setSelected(res.data);
      }
    });
    return () => {
      socket?.off('tournament:created');
      socket?.off('tournament:bracketsGenerated');
      socket?.off('match:completed');
    };
  }, [socket, selected]);

  const register = async () => {
    if (!selected) return;
    setRegistering(true);
    try {
      await api.post(`/api/tournaments/${selected.id}/register`);
      Alert.alert('✅ Registered!', `You're in for ${selected.name}`);
      const res = await api.get(`/api/tournaments/${selected.id}`);
      setSelected(res.data);
      fetchTournaments();
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.error || 'Registration failed');
    } finally { setRegistering(false); }
  };

  const isRegistered = selected?.entries?.some((e: any) => e.userId === user?.id);
  const isFull = selected && selected.entries?.length >= selected.maxPlayers;

  if (loading) return <View style={s.center}><ActivityIndicator size="large" color={COLORS.primary} /></View>;

  return (
    <View style={s.container}>
      <View style={s.header}>
        <Text style={s.title}>🏆 Tournaments</Text>
        <Text style={s.subtitle}>{tournaments.length} tournaments</Text>
      </View>

      <ScrollView contentContainerStyle={s.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchTournaments(); }} tintColor={COLORS.primary} />}>
        {tournaments.length === 0 && (
          <View style={s.empty}><Text style={s.emptyTxt}>No tournaments yet. Check back soon!</Text></View>
        )}
        {tournaments.map((t: any) => (
          <TouchableOpacity key={t.id} style={s.card} onPress={() => openTournament(t)} activeOpacity={0.8}>
            <View style={s.cardTop}>
              <View style={s.cardInfo}>
                <Text style={s.cardName}>{t.name}</Text>
                <Text style={s.cardFormat}>{FORMAT_LABELS[t.format]}</Text>
              </View>
              <View style={[s.statusBadge, { backgroundColor: STATUS_COLORS[t.status] + '25' }]}>
                <Text style={[s.statusTxt, { color: STATUS_COLORS[t.status] }]}>{t.status.replace(/_/g, ' ')}</Text>
              </View>
            </View>
            <View style={s.cardStats}>
              <View style={s.cardStat}>
                <Ionicons name="people-outline" size={14} color={COLORS.textMuted} />
                <Text style={s.cardStatTxt}>{t._count?.entries || 0} / {t.maxPlayers}</Text>
              </View>
              <View style={s.cardStat}>
                <Ionicons name="calendar-outline" size={14} color={COLORS.textMuted} />
                <Text style={s.cardStatTxt}>{new Date(t.startDate).toLocaleDateString('en-PH')}</Text>
              </View>
              {t.prizePool > 0 && (
                <View style={s.cardStat}>
                  <Ionicons name="trophy-outline" size={14} color={COLORS.gold} />
                  <Text style={[s.cardStatTxt, { color: COLORS.gold }]}>₱{t.prizePool}</Text>
                </View>
              )}
              {t.entryFee > 0 && (
                <View style={s.cardStat}>
                  <Ionicons name="wallet-outline" size={14} color={COLORS.textMuted} />
                  <Text style={s.cardStatTxt}>₱{t.entryFee} entry</Text>
                </View>
              )}
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Tournament Detail Modal */}
      <Modal visible={!!selected} animationType="slide" onRequestClose={() => setSelected(null)}>
        <View style={s.modal}>
          <View style={s.modalHeader}>
            <TouchableOpacity onPress={() => setSelected(null)}>
              <Ionicons name="arrow-back" size={24} color={COLORS.textPrimary} />
            </TouchableOpacity>
            <Text style={s.modalTitle} numberOfLines={1}>{selected?.name}</Text>
            <View style={{ width: 24 }} />
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.modalContent}>
            {/* Info */}
            <View style={s.infoCard}>
              <View style={[s.statusBadge, { backgroundColor: STATUS_COLORS[selected?.status] + '25', alignSelf: 'flex-start' }]}>
                <Text style={[s.statusTxt, { color: STATUS_COLORS[selected?.status] }]}>{selected?.status?.replace(/_/g, ' ')}</Text>
              </View>
              <Text style={s.infoFormat}>{FORMAT_LABELS[selected?.format]}</Text>
              {selected?.description && <Text style={s.infoDesc}>{selected.description}</Text>}
              <View style={s.infoStats}>
                <InfoStat icon="people" label="Players" value={`${selected?.entries?.length || 0} / ${selected?.maxPlayers}`} />
                <InfoStat icon="calendar" label="Date" value={selected?.startDate ? new Date(selected.startDate).toLocaleDateString('en-PH') : '-'} />
                <InfoStat icon="trophy" label="Prize" value={selected?.prizePool > 0 ? `₱${selected.prizePool}` : 'TBD'} />
                <InfoStat icon="wallet" label="Entry" value={selected?.entryFee > 0 ? `₱${selected.entryFee}` : 'Free'} />
              </View>
            </View>

            {/* Register Button */}
            {(selected?.status === 'REGISTRATION_OPEN' || selected?.status === 'UPCOMING') && !isRegistered && !isFull && (
              <TouchableOpacity style={s.registerBtn} onPress={register} disabled={registering}>
                {registering ? <ActivityIndicator color="#000" /> : (
                  <><Ionicons name="add-circle" size={20} color="#000" /><Text style={s.registerTxt}>Register Now</Text></>
                )}
              </TouchableOpacity>
            )}
            {isRegistered && (
              <View style={s.registeredBadge}>
                <Ionicons name="checkmark-circle" size={20} color={COLORS.success} />
                <Text style={s.registeredTxt}>You are registered!</Text>
              </View>
            )}
            {isFull && !isRegistered && (
              <View style={s.fullBadge}>
                <Text style={s.fullTxt}>Tournament is full</Text>
              </View>
            )}

            {/* Players List */}
            <Text style={s.sectionTitle}>Registered Players ({selected?.entries?.length || 0})</Text>
            {selected?.entries?.map((entry: any, i: number) => {
              const gp = entry.user?.gamifiedProfile;
              const rankCfg = RANK_CONFIG[gp?.rank as keyof typeof RANK_CONFIG] || RANK_CONFIG.Rookie;
              return (
                <View key={entry.id} style={s.playerRow}>
                  <Text style={s.playerNum}>#{i + 1}</Text>
                  <View style={[s.playerAvatar, { backgroundColor: rankCfg.color + '20' }]}>
                    <Text>{rankCfg.icon}</Text>
                  </View>
                  <View style={s.playerInfo}>
                    <Text style={s.playerName}>{gp?.displayName || `${entry.user?.firstName} ${entry.user?.lastName}`}</Text>
                    <Text style={s.playerStats}>
                      {gp?.totalWins || 0}W · {gp?.totalLosses || 0}L · {gp?.rank || 'Rookie'}
                    </Text>
                  </View>
                  {entry.userId === user?.id && (
                    <View style={s.youBadge}><Text style={s.youTxt}>YOU</Text></View>
                  )}
                </View>
              );
            })}

            {/* Bracket */}
            {selected?.status === 'IN_PROGRESS' && selected?.matches?.length > 0 && (
              <>
                <Text style={s.sectionTitle}>Bracket</Text>
                {[...new Set(selected.matches.map((m: any) => m.round))].map((round: any) => (
                  <View key={round}>
                    <Text style={s.roundTitle}>Round {round}</Text>
                    {selected.matches.filter((m: any) => m.round === round).map((match: any) => {
                      const p1 = selected.entries?.find((e: any) => e.userId === match.player1Id);
                      const p2 = selected.entries?.find((e: any) => e.userId === match.player2Id);
                      const winner = selected.entries?.find((e: any) => e.userId === match.winnerId);
                      return (
                        <View key={match.id} style={[s.matchCard, match.status === 'IN_PROGRESS' && s.matchLive]}>
                          {match.status === 'IN_PROGRESS' && (
                            <View style={s.liveBadge}><Text style={s.liveTxt}>🔴 LIVE</Text></View>
                          )}
                          <MatchPlayer entry={p1} score={match.player1Score} isWinner={match.winnerId === match.player1Id} />
                          <View style={s.vsBox}><Text style={s.vsTxt}>VS</Text></View>
                          <MatchPlayer entry={p2} score={match.player2Score} isWinner={match.winnerId === match.player2Id} />
                          {match.status === 'COMPLETED' && winner && (
                            <Text style={s.winnerTxt}>🏆 {winner.user?.gamifiedProfile?.displayName || winner.user?.firstName} wins!</Text>
                          )}
                          {match.status === 'BYE' && <Text style={s.byeTxt}>BYE — Auto advance</Text>}
                        </View>
                      );
                    })}
                  </View>
                ))}
              </>
            )}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const InfoStat = ({ icon, label, value }: any) => (
  <View style={s.infoStatItem}>
    <Ionicons name={`${icon}-outline` as any} size={16} color={COLORS.primary} />
    <Text style={s.infoStatLbl}>{label}</Text>
    <Text style={s.infoStatVal}>{value}</Text>
  </View>
);

const MatchPlayer = ({ entry, score, isWinner }: any) => {
  const gp = entry?.user?.gamifiedProfile;
  const rankCfg = RANK_CONFIG[gp?.rank as keyof typeof RANK_CONFIG] || RANK_CONFIG.Rookie;
  return (
    <View style={[s.matchPlayer, isWinner && s.matchPlayerWinner]}>
      <Text style={s.matchPlayerIcon}>{entry ? rankCfg.icon : '❓'}</Text>
      <Text style={s.matchPlayerName} numberOfLines={1}>
        {entry ? (gp?.displayName || entry.user?.firstName) : 'TBD'}
      </Text>
      <Text style={[s.matchScore, isWinner && { color: COLORS.gold }]}>{score ?? '-'}</Text>
    </View>
  );
};

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background },
  header: { paddingTop: 60, paddingHorizontal: 20, paddingBottom: 16, backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.surfaceBorder },
  title: { fontSize: 22, fontWeight: '800', color: COLORS.textPrimary },
  subtitle: { fontSize: 13, color: COLORS.textSecondary },
  list: { padding: 16, gap: 12 },
  card: { backgroundColor: COLORS.surface, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: COLORS.surfaceBorder, gap: 10 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  cardInfo: { flex: 1 },
  cardName: { fontSize: 16, fontWeight: '700', color: COLORS.textPrimary },
  cardFormat: { fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  statusTxt: { fontSize: 11, fontWeight: '700' },
  cardStats: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  cardStat: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  cardStatTxt: { fontSize: 12, color: COLORS.textSecondary },
  empty: { padding: 40, alignItems: 'center' },
  emptyTxt: { color: COLORS.textMuted },
  modal: { flex: 1, backgroundColor: COLORS.background },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 60, paddingHorizontal: 20, paddingBottom: 16, backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.surfaceBorder },
  modalTitle: { flex: 1, fontSize: 18, fontWeight: '800', color: COLORS.textPrimary, textAlign: 'center' },
  modalContent: { padding: 16, gap: 14 },
  infoCard: { backgroundColor: COLORS.surface, borderRadius: 16, padding: 16, gap: 12, borderWidth: 1, borderColor: COLORS.surfaceBorder },
  infoFormat: { fontSize: 15, fontWeight: '700', color: COLORS.textPrimary },
  infoDesc: { fontSize: 13, color: COLORS.textSecondary },
  infoStats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  infoStatItem: { backgroundColor: COLORS.surfaceLight, borderRadius: 10, padding: 10, alignItems: 'center', gap: 4, flex: 1, minWidth: '22%' },
  infoStatLbl: { fontSize: 10, color: COLORS.textMuted },
  infoStatVal: { fontSize: 13, fontWeight: '700', color: COLORS.textPrimary },
  registerBtn: { backgroundColor: COLORS.primary, borderRadius: 14, height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  registerTxt: { fontSize: 16, fontWeight: '700', color: '#000' },
  registeredBadge: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: COLORS.success + '20', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: COLORS.success },
  registeredTxt: { color: COLORS.success, fontWeight: '700' },
  fullBadge: { alignItems: 'center', padding: 14, backgroundColor: COLORS.surfaceLight, borderRadius: 14 },
  fullTxt: { color: COLORS.textMuted },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: COLORS.textPrimary },
  playerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: COLORS.surface, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: COLORS.surfaceBorder },
  playerNum: { fontSize: 13, color: COLORS.textMuted, width: 24, textAlign: 'center' },
  playerAvatar: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },
  playerInfo: { flex: 1 },
  playerName: { fontSize: 14, fontWeight: '700', color: COLORS.textPrimary },
  playerStats: { fontSize: 11, color: COLORS.textMuted },
  youBadge: { backgroundColor: COLORS.primary + '20', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  youTxt: { fontSize: 11, fontWeight: '800', color: COLORS.primary },
  roundTitle: { fontSize: 13, fontWeight: '700', color: COLORS.textMuted, marginBottom: 8, marginTop: 4 },
  matchCard: { backgroundColor: COLORS.surface, borderRadius: 14, padding: 14, gap: 8, borderWidth: 1, borderColor: COLORS.surfaceBorder, marginBottom: 8 },
  matchLive: { borderColor: COLORS.error },
  liveBadge: { alignSelf: 'flex-start', backgroundColor: COLORS.error + '20', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  liveTxt: { fontSize: 11, fontWeight: '700', color: COLORS.error },
  matchPlayer: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8, borderRadius: 10, backgroundColor: COLORS.surfaceLight },
  matchPlayerWinner: { backgroundColor: COLORS.gold + '15' },
  matchPlayerIcon: { fontSize: 20 },
  matchPlayerName: { flex: 1, fontSize: 14, fontWeight: '600', color: COLORS.textPrimary },
  matchScore: { fontSize: 18, fontWeight: '800', color: COLORS.textPrimary },
  vsBox: { alignItems: 'center' },
  vsTxt: { fontSize: 11, fontWeight: '900', color: COLORS.textMuted },
  winnerTxt: { fontSize: 13, color: COLORS.gold, fontWeight: '700', textAlign: 'center' },
  byeTxt: { fontSize: 12, color: COLORS.textMuted, textAlign: 'center' },
});
