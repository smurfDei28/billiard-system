import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  RefreshControl, ActivityIndicator, Alert, Modal, TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../context/AuthContext';
import { useSocket } from '../../context/SocketContext';
import { useAuth } from '../../context/AuthContext';
import { COLORS, RANK_CONFIG } from '../../constants';

// ─── Constants ────────────────────────────────────────────────────────────────

const FORMAT_LABELS: Record<string, string> = {
  SINGLE_ELIMINATION: 'Single Elimination',
  DOUBLE_ELIMINATION: 'Double Elimination',
  ROUND_ROBIN: 'Round Robin',
};

const GAME_LABELS: Record<string, string> = {
  EIGHT_BALL: '8-Ball',
  NINE_BALL: '9-Ball',
  TEN_BALL: '10-Ball',
};

const STATUS_COLORS: Record<string, string> = {
  UPCOMING: COLORS.info,
  REGISTRATION_OPEN: COLORS.success,
  IN_PROGRESS: COLORS.gold,
  COMPLETED: COLORS.textMuted,
  CANCELLED: COLORS.error,
};

const PAYMENT_METHODS = [
  { key: 'CASH', label: 'Cash' },
  { key: 'GCASH', label: 'GCash' },
  { key: 'MAYA', label: 'Maya' },
  { key: 'CARD', label: 'Card' },
];

const formatDuration = (minutes: number) => {
  if (!minutes) return '';
  if (minutes < 60) return `~${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `~${h}h ${m}m` : `~${h}h`;
};

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function TournamentListScreen() {
  const { user } = useAuth();
  const { socket, joinTournament } = useSocket();
  const [tournaments, setTournaments] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [registering, setRegistering] = useState(false);

  // Cancellation policy modal (shown before registration)
  const [policyModal, setPolicyModal] = useState(false);

  // Payment details modal (shown after user agrees to policy)
  const [paymentModal, setPaymentModal] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState('GCASH');
  const [paymentRef, setPaymentRef] = useState('');

  const fetchTournaments = useCallback(async () => {
    try {
      const res = await api.get('/api/tournaments');
      setTournaments(res.data);
    } catch {}
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
        try {
          const res = await api.get(`/api/tournaments/${selected.id}`);
          setSelected(res.data);
        } catch {}
      }
    });
    return () => {
      socket?.off('tournament:created');
      socket?.off('tournament:bracketsGenerated');
      socket?.off('match:completed');
    };
  }, [socket, selected]);

  // ── Step 1: User taps "Register Now" — show cancellation policy ──
  const handleRegisterTap = () => {
    setPolicyModal(true);
  };

  // ── Step 2: User agrees to policy — show payment details (if fee exists) ──
  const handlePolicyAgree = () => {
    setPolicyModal(false);
    if (selected?.entryFee > 0) {
      setPaymentModal(true);
    } else {
      // Free tournament — register directly
      submitRegistration(null, null);
    }
  };

  // ── Step 3: Submit registration ──
  const submitRegistration = async (method: string | null, ref: string | null) => {
    if (!selected) return;
    setRegistering(true);
    setPaymentModal(false);
    try {
      await api.post(`/api/tournaments/${selected.id}/register`, {
        paymentMethod: method || undefined,
        paymentRef: ref?.trim() || undefined,
      });

      const hasFee = selected.entryFee > 0;
      Alert.alert(
        '✅ Registration Submitted',
        hasFee
          ? `Your registration for "${selected.name}" has been submitted and is awaiting admin approval. You will be notified once confirmed.`
          : `Your registration for "${selected.name}" is pending admin approval. You will be notified shortly.`
      );
      const res = await api.get(`/api/tournaments/${selected.id}`);
      setSelected(res.data);
      fetchTournaments();
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.error || 'Registration failed');
    } finally {
      setRegistering(false);
      setPaymentRef('');
      setPaymentMethod('GCASH');
    }
  };

  const myEntry = selected?.entries?.find((e: any) => e.userId === user?.id);
  const isRegistered = !!myEntry;
  const isFull = selected && selected.entries?.filter((e: any) => e.status !== 'CANCELLED').length >= selected?.maxPlayers;
  const canRegister = (selected?.status === 'REGISTRATION_OPEN' || selected?.status === 'UPCOMING') && !isRegistered && !isFull;

  if (loading) return (
    <View style={s.center}><ActivityIndicator size="large" color={COLORS.primary} /></View>
  );

  return (
    <View style={s.container}>
      <View style={s.header}>
        <Text style={s.title}>🏆 Tournaments</Text>
        <Text style={s.subtitle}>{tournaments.length} tournament{tournaments.length !== 1 ? 's' : ''}</Text>
      </View>

      <ScrollView
        contentContainerStyle={s.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchTournaments(); }} tintColor={COLORS.primary} />}
      >
        {tournaments.length === 0 && (
          <View style={s.empty}><Text style={s.emptyTxt}>No tournaments yet. Check back soon!</Text></View>
        )}
        {tournaments.map((t: any) => (
          <TouchableOpacity key={t.id} style={s.card} onPress={() => openTournament(t)} activeOpacity={0.8}>
            <View style={s.cardTop}>
              <View style={s.cardInfo}>
                <Text style={s.cardName}>{t.name}</Text>
                <Text style={s.cardFormat}>
                  {GAME_LABELS[t.gameType] || t.gameType} · {FORMAT_LABELS[t.format]}
                </Text>
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
                <Text style={s.cardStatTxt}>
                  {new Date(t.startDate).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}{' '}
                  {new Date(t.startDate).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })}
                </Text>
              </View>
              {t.estimatedDuration > 0 && (
                <View style={s.cardStat}>
                  <Ionicons name="time-outline" size={14} color={COLORS.textMuted} />
                  <Text style={s.cardStatTxt}>{formatDuration(t.estimatedDuration)}</Text>
                </View>
              )}
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

      {/* ── Tournament Detail Modal ── */}
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
            {/* Info Card */}
            <View style={s.infoCard}>
              <View style={[s.statusBadge, { backgroundColor: STATUS_COLORS[selected?.status] + '25', alignSelf: 'flex-start' }]}>
                <Text style={[s.statusTxt, { color: STATUS_COLORS[selected?.status] }]}>{selected?.status?.replace(/_/g, ' ')}</Text>
              </View>
              <Text style={s.infoFormat}>
                {GAME_LABELS[selected?.gameType] || selected?.gameType} · {FORMAT_LABELS[selected?.format]}
              </Text>
              {selected?.description && <Text style={s.infoDesc}>{selected.description}</Text>}
              <View style={s.infoStats}>
                <InfoStat icon="people" label="Players" value={`${selected?.entries?.filter((e: any) => e.status !== 'CANCELLED').length || 0} / ${selected?.maxPlayers}`} />
                <InfoStat icon="calendar" label="Date" value={selected?.startDate ? new Date(selected.startDate).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : '-'} />
                <InfoStat icon="time" label="Time" value={selected?.startDate ? new Date(selected.startDate).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' }) : '-'} />
                {selected?.estimatedDuration && (
                  <InfoStat icon="hourglass" label="Est." value={formatDuration(selected.estimatedDuration)} />
                )}
                <InfoStat icon="trophy" label="Prize" value={selected?.prizePool > 0 ? `₱${selected.prizePool}` : 'TBD'} />
                <InfoStat icon="wallet" label="Entry" value={selected?.entryFee > 0 ? `₱${selected.entryFee}` : 'Free'} />
              </View>
            </View>

            {/* Registration Status */}
            {canRegister && (
              <TouchableOpacity style={s.registerBtn} onPress={handleRegisterTap} disabled={registering}>
                {registering
                  ? <ActivityIndicator color="#000" />
                  : <>
                    <Ionicons name="add-circle" size={20} color="#000" />
                    <Text style={s.registerTxt}>Register Now</Text>
                  </>
                }
              </TouchableOpacity>
            )}

            {isRegistered && (
              <View style={[
                s.registeredBadge,
                myEntry?.status === 'PENDING_PAYMENT' && { borderColor: '#f59e0b', backgroundColor: '#f59e0b15' },
                myEntry?.status === 'PENDING_APPROVAL' && { borderColor: COLORS.info, backgroundColor: COLORS.info + '15' },
              ]}>
                <Ionicons
                  name={myEntry?.status === 'APPROVED' ? 'checkmark-circle' : 'time-outline'}
                  size={20}
                  color={myEntry?.status === 'APPROVED' ? COLORS.success : myEntry?.status === 'PENDING_PAYMENT' ? '#f59e0b' : COLORS.info}
                />
                <View style={{ flex: 1 }}>
                  <Text style={[
                    s.registeredTxt,
                    myEntry?.status === 'PENDING_PAYMENT' && { color: '#f59e0b' },
                    myEntry?.status === 'PENDING_APPROVAL' && { color: COLORS.info },
                  ]}>
                    {myEntry?.status === 'APPROVED' && 'Registration Confirmed ✅'}
                    {myEntry?.status === 'PENDING_PAYMENT' && 'Pending Payment — Submit your entry fee to complete registration'}
                    {myEntry?.status === 'PENDING_APPROVAL' && 'Awaiting Admin Approval…'}
                  </Text>
                </View>
              </View>
            )}

            {isFull && !isRegistered && (
              <View style={s.fullBadge}><Text style={s.fullTxt}>Tournament is full</Text></View>
            )}

            {/* Players List */}
            <Text style={s.sectionTitle}>
              Registered Players ({selected?.entries?.filter((e: any) => e.status === 'APPROVED').length || 0} approved)
            </Text>
            {selected?.entries?.filter((e: any) => e.status !== 'CANCELLED').map((entry: any, i: number) => {
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
                    <Text style={s.roundTitle}>
                      {round === Math.max(...selected.matches.map((m: any) => m.round)) ? '🏆 Final' : `Round ${round}`}
                    </Text>
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

      {/* ── Cancellation Policy Modal ── */}
      <Modal visible={policyModal} transparent animationType="fade">
        <View style={s.overlay}>
          <View style={s.dialogBox}>
            <View style={s.dialogIcon}>
              <Ionicons name="information-circle" size={32} color={COLORS.info} />
            </View>
            <Text style={s.dialogTitle}>Registration Terms & Conditions</Text>
            <Text style={s.dialogBody}>
              Please read and acknowledge the following before registering for this tournament:
            </Text>
            <View style={s.policyItem}>
              <Ionicons name="close-circle" size={18} color={COLORS.error} />
              <Text style={s.policyText}>
                <Text style={{ fontWeight: '700' }}>No Refunds: </Text>
                All entry fees are strictly non-refundable once submitted, regardless of the reason for withdrawal.
              </Text>
            </View>
            <View style={s.policyItem}>
              <Ionicons name="alert-circle" size={18} color="#f59e0b" />
              <Text style={s.policyText}>
                <Text style={{ fontWeight: '700' }}>Cancellation Fee: </Text>
                If you withdraw from the tournament after your registration has been approved, a cancellation processing fee will apply.
              </Text>
            </View>
            <View style={s.policyItem}>
              <Ionicons name="checkmark-circle" size={18} color={COLORS.info} />
              <Text style={s.policyText}>
                Your registration is not confirmed until the entry fee is paid and approved by an administrator.
              </Text>
            </View>
            <View style={s.dialogActions}>
              <TouchableOpacity
                style={s.dialogCancelBtn}
                onPress={() => setPolicyModal(false)}
              >
                <Text style={s.dialogCancelTxt}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={s.dialogAgreeBtn}
                onPress={handlePolicyAgree}
              >
                <Text style={s.dialogAgreeTxt}>I Understand, Proceed</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Payment Details Modal ── */}
      <Modal visible={paymentModal} transparent animationType="fade">
        <View style={s.overlay}>
          <View style={s.dialogBox}>
            <Text style={s.dialogTitle}>Payment Details</Text>
            <Text style={s.dialogBody}>
              Entry fee for <Text style={{ fontWeight: '700' }}>{selected?.name}</Text>:{' '}
              <Text style={{ fontWeight: '800', color: COLORS.primary }}>₱{selected?.entryFee}</Text>
            </Text>

            <Text style={s.fieldLabelModal}>Payment Method</Text>
            <View style={s.paymentMethods}>
              {PAYMENT_METHODS.map(pm => (
                <TouchableOpacity
                  key={pm.key}
                  style={[s.payBtn, paymentMethod === pm.key && s.payBtnActive]}
                  onPress={() => setPaymentMethod(pm.key)}
                >
                  <Text style={[s.payBtnTxt, paymentMethod === pm.key && s.payBtnTxtActive]}>
                    {pm.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {paymentMethod !== 'CASH' && (
              <>
                <Text style={s.fieldLabelModal}>Reference Number (optional)</Text>
                <TextInput
                  style={s.payRefInput}
                  value={paymentRef}
                  onChangeText={setPaymentRef}
                  placeholder="e.g. GCash ref: 1234567890"
                  placeholderTextColor={COLORS.textMuted}
                  autoCapitalize="none"
                />
              </>
            )}

            <Text style={s.payNote}>
              Your registration will be reviewed by the admin after submission. You will receive a notification once confirmed.
            </Text>

            <View style={s.dialogActions}>
              <TouchableOpacity
                style={s.dialogCancelBtn}
                onPress={() => setPaymentModal(false)}
              >
                <Text style={s.dialogCancelTxt}>Back</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={s.dialogAgreeBtn}
                onPress={() => submitRegistration(paymentMethod, paymentRef)}
                disabled={registering}
              >
                {registering
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={s.dialogAgreeTxt}>Submit Registration</Text>
                }
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

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
  infoStatItem: { backgroundColor: COLORS.surfaceLight || COLORS.surface, borderRadius: 10, padding: 10, alignItems: 'center', gap: 4, flex: 1, minWidth: '22%' },
  infoStatLbl: { fontSize: 10, color: COLORS.textMuted },
  infoStatVal: { fontSize: 13, fontWeight: '700', color: COLORS.textPrimary },
  registerBtn: { backgroundColor: COLORS.primary, borderRadius: 14, height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  registerTxt: { fontSize: 16, fontWeight: '700', color: '#000' },
  registeredBadge: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: COLORS.success + '20', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: COLORS.success },
  registeredTxt: { color: COLORS.success, fontWeight: '700', flex: 1 },
  fullBadge: { alignItems: 'center', padding: 14, backgroundColor: COLORS.surfaceBorder, borderRadius: 14 },
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
  matchPlayer: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8, borderRadius: 10, backgroundColor: COLORS.surfaceBorder },
  matchPlayerWinner: { backgroundColor: COLORS.gold + '15' },
  matchPlayerIcon: { fontSize: 20 },
  matchPlayerName: { flex: 1, fontSize: 14, fontWeight: '600', color: COLORS.textPrimary },
  matchScore: { fontSize: 18, fontWeight: '800', color: COLORS.textPrimary },
  vsBox: { alignItems: 'center' },
  vsTxt: { fontSize: 11, fontWeight: '900', color: COLORS.textMuted },
  winnerTxt: { fontSize: 13, color: COLORS.gold, fontWeight: '700', textAlign: 'center' },
  byeTxt: { fontSize: 12, color: COLORS.textMuted, textAlign: 'center' },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  dialogBox: { backgroundColor: COLORS.surface, borderRadius: 20, padding: 22, gap: 14, width: '100%' },
  dialogIcon: { alignItems: 'center' },
  dialogTitle: { fontSize: 17, fontWeight: '800', color: COLORS.textPrimary, textAlign: 'center' },
  dialogBody: { fontSize: 14, color: COLORS.textSecondary, lineHeight: 21, textAlign: 'center' },
  policyItem: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', backgroundColor: COLORS.surfaceBorder, borderRadius: 10, padding: 12 },
  policyText: { flex: 1, fontSize: 13, color: COLORS.textSecondary, lineHeight: 20 },
  fieldLabelModal: { fontSize: 13, fontWeight: '600', color: COLORS.textSecondary },
  paymentMethods: { flexDirection: 'row', gap: 8 },
  payBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: COLORS.surfaceBorder, alignItems: 'center', backgroundColor: COLORS.surface },
  payBtnActive: { borderColor: COLORS.primary, backgroundColor: COLORS.primary + '15' },
  payBtnTxt: { fontSize: 13, fontWeight: '700', color: COLORS.textMuted },
  payBtnTxtActive: { color: COLORS.primary },
  payRefInput: { borderWidth: 1, borderColor: COLORS.surfaceBorder, borderRadius: 10, paddingHorizontal: 12, height: 42, color: COLORS.textPrimary, fontSize: 14, backgroundColor: COLORS.surface },
  payNote: { fontSize: 12, color: COLORS.textMuted, textAlign: 'center', lineHeight: 18 },
  dialogActions: { flexDirection: 'row', gap: 10 },
  dialogCancelBtn: { flex: 1, height: 46, borderRadius: 12, borderWidth: 1, borderColor: COLORS.surfaceBorder, justifyContent: 'center', alignItems: 'center' },
  dialogCancelTxt: { color: COLORS.textSecondary, fontWeight: '600' },
  dialogAgreeBtn: { flex: 1.5, height: 46, borderRadius: 12, backgroundColor: COLORS.primary, justifyContent: 'center', alignItems: 'center' },
  dialogAgreeTxt: { color: '#000', fontWeight: '800', fontSize: 14 },
});
