import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  RefreshControl, ActivityIndicator, Alert, Modal, TextInput, useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../context/AuthContext';
import { useSocket } from '../../context/SocketContext';
import { useAuth } from '../../context/AuthContext';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { COLORS, RANK_CONFIG } from '../../constants';
import { formatCredits } from '../../utils/credits';

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
  { key: 'CREDITS', label: 'Credits' },
  { key: 'CASH', label: 'Cash' },
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
  const navigation = useNavigation<any>();
  const { user } = useAuth();
  const { height: screenHeight } = useWindowDimensions();
  const isPlayer = user?.role === 'MEMBER';
  const { socket, joinTournament } = useSocket();
  const [tournaments, setTournaments] = useState<any[]>([]);
  const [pendingFees, setPendingFees] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [detailVisible, setDetailVisible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [registering, setRegistering] = useState(false);

  // Cancellation policy modal (shown before registration)
  const [policyModal, setPolicyModal] = useState(false);

  // Payment details modal (shown after user agrees to policy)
  const [paymentModal, setPaymentModal] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState('CREDITS');
  const [cancellationModal, setCancellationModal] = useState(false);
  const [cancellationQuote, setCancellationQuote] = useState<any>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelSuccess, setCancelSuccess] = useState('');
  const selectedRef = useRef<any>(null);
  const restoreDetailAfterProfileRef = useRef(false);
  const openingProfileRef = useRef(false);

  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  const fetchTournaments = useCallback(async () => {
    try {
      const [res, feeRes] = await Promise.all([api.get('/api/tournaments'), api.get('/api/tournaments/cancellation-fees/mine')]);
      setTournaments(res.data); setPendingFees(feeRes.data || []);
    } catch {}
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  const openTournament = async (t: any) => {
    try {
      const res = await api.get(`/api/tournaments/${t.id}`);
      setSelected(res.data);
      setDetailVisible(true);
      joinTournament(t.id);
    } catch { Alert.alert('Error', 'Failed to load tournament'); }
  };

  const closeTournamentDetail = useCallback(() => {
    restoreDetailAfterProfileRef.current = false;
    setDetailVisible(false);
    setSelected(null);
  }, []);

  const refreshSelectedTournament = useCallback(async () => {
    const current = selectedRef.current;
    if (!current?.id) return;
    try {
      const res = await api.get(`/api/tournaments/${current.id}`);
      setSelected(res.data);
    } catch {}
  }, []);

  const openPlayerProfile = useCallback((userId: string) => {
    if (!userId || openingProfileRef.current) return;

    const rootNavigation = navigation.getParent();
    if (!rootNavigation) return;

    // A native Modal sits above the root stack. Hide it before opening the
    // profile, but retain its tournament data so Back restores this detail.
    openingProfileRef.current = true;
    restoreDetailAfterProfileRef.current = true;
    setDetailVisible(false);
    requestAnimationFrame(() => {
      try {
        rootNavigation.navigate('PlayerProfile', { userId });
      } finally {
        openingProfileRef.current = false;
      }
    });
  }, [navigation]);

  useFocusEffect(useCallback(() => {
    if (restoreDetailAfterProfileRef.current && selectedRef.current) {
      restoreDetailAfterProfileRef.current = false;
      setDetailVisible(true);
      void refreshSelectedTournament().catch((error) => console.warn('[Tournament] detail refresh failed', error));
    }
  }, [refreshSelectedTournament]));

  useEffect(() => {
    const handleTournamentCreated = () => { void fetchTournaments().catch((error) => console.warn('[Tournament] list refresh failed', error)); };
    const handleBracketsGenerated = (t: any) => {
      void fetchTournaments().catch((error) => console.warn('[Tournament] list refresh failed', error));
      if (selectedRef.current?.id === t.id) setSelected(t);
    };
    const handleMatchChanged = () => {
      void fetchTournaments().catch((error) => console.warn('[Tournament] list refresh failed', error));
      void refreshSelectedTournament().catch((error) => console.warn('[Tournament] detail refresh failed', error));
    };

    void fetchTournaments().catch((error) => console.warn('[Tournament] initial load failed', error));
    socket?.on('tournament:created', handleTournamentCreated);
    socket?.on('tournament:bracketsGenerated', handleBracketsGenerated);
    socket?.on('match:completed', handleMatchChanged);
    socket?.on('match:started', handleMatchChanged);
    socket?.on('match:updated', handleMatchChanged);
    return () => {
      socket?.off('tournament:created', handleTournamentCreated);
      socket?.off('tournament:bracketsGenerated', handleBracketsGenerated);
      socket?.off('match:completed', handleMatchChanged);
      socket?.off('match:started', handleMatchChanged);
      socket?.off('match:updated', handleMatchChanged);
    };
  }, [socket, fetchTournaments, refreshSelectedTournament]);

  if (!isPlayer) {
    return <View style={s.center}><Ionicons name="shield-checkmark-outline" size={48} color={COLORS.gold} /><Text style={s.restrictedTitle}>Tournament participation is for Players</Text><Text style={s.restrictedText}>Administrator and Staff accounts can manage tournaments but cannot join, pay registration fees, or cancel participation.</Text><TouchableOpacity style={s.restrictedBtn} onPress={() => navigation.goBack()}><Text style={s.restrictedBtnTxt}>Return to dashboard</Text></TouchableOpacity></View>;
  }

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
      setPaymentMethod('CREDITS');
    }
  };

  const openCancellation = async () => {
    if (!selected) return;
    try {
      const { data } = await api.get(`/api/tournaments/${selected.id}/cancellation-quote`);
      setCancellationQuote(data);
      setCancellationModal(true);
    } catch (err: any) {
      Alert.alert('Unable to Cancel', err.response?.data?.error || 'Unable to calculate the cancellation fee.');
    }
  };

  const confirmCancellation = async () => {
    if (!selected || !cancellationQuote) return;
    setCancelling(true);
    try {
      const { data } = await api.post(`/api/tournaments/${selected.id}/cancel`, { payWithCredits: true });
      setCancellationModal(false);
      setCancellationQuote(null);
      setCancelSuccess(data.cancellationFeeStatus === 'PAID'
        ? `Registration cancelled. Your entry fee was not refunded. The ₱${data.cancellationFee.toFixed(2)} cancellation fee was paid using credits.`
        : `Registration cancelled. Your entry fee was not refunded. A ₱${data.cancellationFee.toFixed(2)} cancellation fee is pending; you cannot join future tournaments until it is settled.`);
      const res = await api.get(`/api/tournaments/${selected.id}`);
      setSelected(res.data);
      fetchTournaments();
    } catch (err: any) {
      Alert.alert('Cancellation Failed', err.response?.data?.error || 'Unable to cancel your registration.');
    } finally {
      setCancelling(false);
    }
  };

  const myEntry = selected?.entries?.find((e: any) => e.userId === user?.id);
  const isRegistered = !!myEntry;
  const isFull = selected && Number(selected.availableSlots ?? 0) <= 0;
  const canRegister = (selected?.status === 'REGISTRATION_OPEN' || selected?.status === 'UPCOMING') && !isRegistered && !isFull;
  const canCancel = isRegistered && !['CANCELLED', 'FORFEITED'].includes(myEntry?.status) &&
    (selected?.status === 'REGISTRATION_OPEN' || selected?.status === 'UPCOMING') &&
    new Date(selected?.startDate).getTime() > Date.now();

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
        {pendingFees.length > 0 && <View style={s.pendingFeeNotice}><Ionicons name="warning-outline" size={22} color={COLORS.warning}/><View style={{flex:1}}><Text style={s.pendingFeeTitle}>Pending cancellation fee</Text><Text style={s.pendingFeeText}>{pendingFees.map((fee:any) => `${fee.tournament?.name}: ${Number(fee.cancellationFee).toFixed(0)} credits`).join(' · ')}. It will be deducted automatically after an approved top-up provides enough credits.</Text><TouchableOpacity onPress={()=>navigation.navigate('Payments')}><Text style={s.pendingFeeTopup}>Top Up Credits</Text></TouchableOpacity></View></View>}
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
                <Text style={s.cardStatTxt}>{t.activePlayerCount || 0} / {t.maxPlayers}</Text>
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
      <Modal visible={detailVisible && !!selected} animationType="slide" onRequestClose={closeTournamentDetail}>
        <View style={s.modal}>
          <View style={s.modalHeader}>
            <TouchableOpacity onPress={closeTournamentDetail}>
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
                <InfoStat icon="people" label="Active" value={`${selected?.activePlayerCount || 0} / ${selected?.maxPlayers}`} />
                <InfoStat icon="calendar" label="Date" value={selected?.startDate ? new Date(selected.startDate).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : '-'} />
                <InfoStat icon="time" label="Time" value={selected?.startDate ? new Date(selected.startDate).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' }) : '-'} />
                <InfoStat icon="flag" label="Race To" value={`${selected?.raceTo || 5}`} />
                {selected?.estimatedDuration && (
                  <InfoStat icon="hourglass" label="Est." value={formatDuration(selected.estimatedDuration)} />
                )}
                <InfoStat icon="trophy" label="Prize" value={selected?.prizePool > 0 ? `₱${selected.prizePool}` : 'TBD'} />
                <InfoStat icon="receipt" label="Paid" value={`${selected?.paidRegistrationCount || 0}`} />
                <InfoStat icon="wallet" label="Entry" value={selected?.entryFee > 0 ? `₱${selected.entryFee}` : 'Free'} />
              </View>
              {selected?.registrationDeadline && <Text style={s.detailNote}>Registration closes {new Date(selected.registrationDeadline).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })}</Text>}
              {selected?.status === 'COMPLETED' && selected?.championTitle && <View style={s.championCard}><Text style={s.championTitle}>Champion</Text><Text style={s.championName}>{selected.championTitle.user?.gamifiedProfile?.displayName || selected.championTitle.user?.firstName || 'Champion'}</Text><Text style={s.championDate}>Completed {selected?.endDate ? new Date(selected.endDate).toLocaleDateString('en-PH', { dateStyle: 'medium' }) : ''}</Text></View>}
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
                myEntry?.status === 'PENDING_PAYMENT' && { borderColor: COLORS.warning, backgroundColor: COLORS.warning + '15' },
                myEntry?.status === 'PENDING_APPROVAL' && { borderColor: COLORS.info, backgroundColor: COLORS.info + '15' },
              ]}>
                <Ionicons
                  name={myEntry?.status === 'APPROVED' ? 'checkmark-circle' : 'time-outline'}
                  size={20}
                  color={myEntry?.status === 'APPROVED' ? COLORS.success : myEntry?.status === 'PENDING_PAYMENT' ? COLORS.warning : COLORS.info}
                />
                <View style={{ flex: 1 }}>
                  <Text style={[
                    s.registeredTxt,
                    myEntry?.status === 'PENDING_PAYMENT' && { color: COLORS.warning },
                    myEntry?.status === 'PENDING_APPROVAL' && { color: COLORS.info },
                  ]}>
                    {myEntry?.status === 'APPROVED' && 'Registration Confirmed ✅'}
                    {myEntry?.status === 'PENDING_PAYMENT' && 'Cash selected — Pay your entry fee at the counter'}
                    {myEntry?.status === 'PENDING_APPROVAL' && 'Awaiting Admin Approval…'}
                    {myEntry?.status === 'CANCELLED' && (myEntry?.cancellationFeeStatus === 'PENDING' ? 'Registration Cancelled · Cancellation Fee Pending' : 'Registration Cancelled')}
                    {myEntry?.status === 'FORFEITED' && 'Forfeit Recorded'}
                  </Text>
                </View>
              </View>
            )}

            {isFull && !isRegistered && (
              <View style={s.fullBadge}><Text style={s.fullTxt}>Tournament is full</Text></View>
            )}

            {canCancel && (
              <TouchableOpacity style={s.cancelRegistrationBtn} onPress={openCancellation}>
                <Ionicons name="close-circle-outline" size={19} color={COLORS.error} />
                <Text style={s.cancelRegistrationTxt}>Cancel Tournament Registration</Text>
              </TouchableOpacity>
            )}

            {/* Players List */}
            <Text style={s.sectionTitle}>Active Players ({selected?.activePlayerCount || 0})</Text>
            {selected?.entries?.filter((e: any) => ['PENDING_APPROVAL', 'APPROVED', 'CHECKED_IN', 'WINNER'].includes(e.status)).map((entry: any, i: number) => {
              const gp = entry.user?.gamifiedProfile;
              const rankCfg = RANK_CONFIG[gp?.rank as keyof typeof RANK_CONFIG] || RANK_CONFIG.Rookie;
              return (
                <TouchableOpacity key={entry.id} style={s.playerRow} onPress={() => entry.userId !== user?.id && openPlayerProfile(entry.userId)}>
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
                </TouchableOpacity>
              );
            })}

            <TournamentPresentation tournament={selected} currentUserId={user?.id} onPlayerPress={(entry: any) => entry && entry.userId !== user?.id && openPlayerProfile(entry.userId)} />

            {/* Legacy linear bracket retained for source-history only; presentation above uses persisted bracket stages. */}
            {false && selected?.status === 'IN_PROGRESS' && selected?.matches?.length > 0 && (
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
                          <MatchPlayer entry={p1} score={match.player1Score} isWinner={match.winnerId === match.player1Id} onPress={() => p1 && p1.userId !== user?.id && openPlayerProfile(p1.userId)} />
                          <View style={s.vsBox}><Text style={s.vsTxt}>VS</Text></View>
                          <MatchPlayer entry={p2} score={match.player2Score} isWinner={match.winnerId === match.player2Id} onPress={() => p2 && p2.userId !== user?.id && openPlayerProfile(p2.userId)} />
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
      <Modal visible={policyModal} transparent animationType="fade" onRequestClose={() => setPolicyModal(false)}>
        <View style={s.overlay}>
          <View style={[s.dialogBox, s.policyDialog, { maxHeight: screenHeight * 0.86 }]}>
            <View style={s.policyHeader}>
              <View style={s.dialogIcon}>
                <Ionicons name="information-circle" size={32} color={COLORS.info} />
              </View>
              <Text style={s.dialogTitle}>Registration Terms & Conditions</Text>
              <Text style={s.dialogBody}>
                Please read and acknowledge the following before registering for this tournament:
              </Text>
            </View>
            <ScrollView style={s.policyScroll} contentContainerStyle={s.policyScrollContent} showsVerticalScrollIndicator>
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
                Cancelling before the tournament starts costs 200 credits for Single Elimination or 400 credits for Double Elimination. Unpaid fees block future tournament registrations.
              </Text>
            </View>
            <View style={s.policyItem}>
              <Ionicons name="checkmark-circle" size={18} color={COLORS.info} />
              <Text style={s.policyText}>
                Your registration is not confirmed until the entry fee is paid and approved by an administrator.
              </Text>
            </View>
            </ScrollView>
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
      <Modal visible={paymentModal} transparent animationType="fade" onRequestClose={() => !registering && setPaymentModal(false)}>
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
            {paymentMethod === 'CREDITS' && <View style={s.cancelFeeCard}><Text style={s.cancelFeeLabel}>Credit payment</Text><Text style={s.cancelFeeReason}>Available balance: {formatCredits(user?.membership?.creditBalance)} credits. The registration fee will be deducted once only; top up credits first if needed.</Text></View>}
            {paymentMethod === 'CASH' && <View style={s.cancelFeeCard}><Text style={s.cancelFeeLabel}>Cash payment</Text><Text style={s.cancelFeeReason}>Pay the registration fee at the counter to complete your tournament registration. Your wallet will not be charged.</Text></View>}
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
                onPress={() => submitRegistration(paymentMethod, null)}
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

      <Modal visible={cancellationModal} transparent animationType="fade" onRequestClose={() => setCancellationModal(false)}>
        <View style={s.overlay}>
          <View style={s.dialogBox}>
            <View style={s.dialogIcon}><Ionicons name="warning" size={32} color={COLORS.error} /></View>
            <Text style={s.dialogTitle}>Cancel Registration?</Text>
            <Text style={s.dialogBody}>Your tournament entry fee is <Text style={{ fontWeight: '800', color: COLORS.error }}>strictly non-refundable</Text>.</Text>
            <View style={s.cancelFeeCard}>
              <Text style={s.cancelFeeLabel}>Cancellation fee</Text>
              <Text style={s.cancelFeeValue}>₱{Number(cancellationQuote?.cancellationFee || 0).toFixed(2)}</Text>
              <Text style={s.cancelFeeReason}>{cancellationQuote?.reason}</Text>
            </View>
            <Text style={s.dialogBody}>Available credits will pay this fee when sufficient. Otherwise it is recorded as pending and blocks future tournament registrations until settled.</Text>
            <View style={s.dialogActions}>
              <TouchableOpacity style={s.dialogCancelBtn} onPress={() => setCancellationModal(false)} disabled={cancelling}><Text style={s.dialogCancelTxt}>Keep Registration</Text></TouchableOpacity>
              <TouchableOpacity style={s.dialogConfirmBtn} onPress={confirmCancellation} disabled={cancelling}>
                {cancelling ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.dialogConfirmTxt}>Confirm Cancellation</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={!!cancelSuccess} transparent animationType="fade" onRequestClose={() => setCancelSuccess('')}>
        <View style={s.overlay}><View style={s.dialogBox}>
          <View style={s.dialogIcon}><Ionicons name="checkmark-circle" size={40} color={COLORS.success} /></View>
          <Text style={s.dialogTitle}>Registration Cancelled</Text>
          <Text style={s.dialogBody}>{cancelSuccess}</Text>
          <TouchableOpacity style={s.dialogAgreeBtn} onPress={() => setCancelSuccess('')}><Text style={s.dialogAgreeTxt}>Done</Text></TouchableOpacity>
        </View></View>
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

const MatchPlayer = ({ entry, score, isWinner, onPress, placeholder = 'Waiting' }: any) => {
  const gp = entry?.user?.gamifiedProfile;
  const rankCfg = RANK_CONFIG[gp?.rank as keyof typeof RANK_CONFIG] || RANK_CONFIG.Rookie;
  return (
    <TouchableOpacity disabled={!entry} onPress={onPress} style={[s.matchPlayer, isWinner && s.matchPlayerWinner]}>
      <Text style={s.matchPlayerIcon}>{entry ? rankCfg.icon : '❓'}</Text>
      <Text style={s.matchPlayerName} numberOfLines={1}>
        {entry ? (gp?.displayName || entry.user?.firstName) : placeholder}
      </Text>
      <Text style={[s.matchScore, isWinner && { color: COLORS.gold }]}>{score ?? '-'}</Text>
    </TouchableOpacity>
  );
};

const STAGE_LABELS: Record<string, string> = {
  WINNERS: 'Winners Bracket',
  LOSERS: 'Losers Bracket',
  GRAND_FINAL: 'Grand Final',
  RESET_FINAL: 'Reset Final',
};

const matchLabel = (match: any) => !match ? 'Match pending' : match.isResetFinal ? 'Reset Final' : match.isGrandFinal ? 'Grand Final' : `${match.bracketStage === 'LOSERS' ? 'Losers' : 'Winners'} Round ${match.round} · Match ${match.matchNumber}`;

function TournamentPresentation({ tournament, currentUserId, onPlayerPress }: any) {
  const entriesByUser = new Map((tournament?.entries || []).filter(Boolean).map((entry: any) => [entry.userId, entry]));
  const matches = (tournament?.matches || []).filter(Boolean)
    .filter((match: any) => !(match.status === 'BYE' && !match.player1Id && !match.player2Id))
    .filter((match: any) => !match.isResetFinal || match.player1Id || match.player2Id || match.status === 'COMPLETED' || match.status === 'IN_PROGRESS');
  if (!matches.length) return <View style={s.presentationEmpty}><Text style={s.emptyTxt}>{tournament?.status === 'REGISTRATION_CLOSED' ? 'Registration is closed. Bracket is being prepared.' : 'No bracket has been generated yet.'}</Text></View>;

  const ownMatches = matches.filter((match: any) => match.player1Id === currentUserId || match.player2Id === currentUserId).filter((match: any) => ['PENDING', 'IN_PROGRESS'].includes(match.status));
  const stageOrder = tournament?.format === 'DOUBLE_ELIMINATION'
    ? ['WINNERS', 'LOSERS', 'GRAND_FINAL', 'RESET_FINAL']
    : ['WINNERS', 'GRAND_FINAL'];
  const stages = stageOrder.map((stage) => ({ stage, matches: matches.filter((match: any) => (match.bracketStage || 'WINNERS') === stage) })).filter((group) => group.matches.length);
  if (!stages.length) stages.push({ stage: 'WINNERS', matches }); // historical ROUND_ROBIN fallback

  return <>
    {ownMatches.length > 0 && <><Text style={s.sectionTitle}>My Match</Text>{ownMatches.map((match: any) => <BracketMatch key={match.id} match={match} raceTo={tournament?.raceTo} entriesByUser={entriesByUser} currentUserId={currentUserId} onPlayerPress={onPlayerPress} />)}</>}
    <Text style={s.sectionTitle}>{tournament?.status === 'COMPLETED' ? 'Results & Bracket' : 'Bracket'}</Text>
    {stages.map(({ stage, matches: stageMatches }) => <View key={stage} style={s.bracketStage}>
      <Text style={s.stageTitle}>{STAGE_LABELS[stage] || (tournament?.format === 'ROUND_ROBIN' ? 'Match Results' : 'Bracket')}</Text>
      {[...new Set(stageMatches.map((match: any) => match.round))].map((round: any) => <View key={`${stage}-${round}`}>
        <Text style={s.roundTitle}>{stage === 'GRAND_FINAL' ? 'Grand Final' : stage === 'RESET_FINAL' ? 'Reset Final' : stage === 'LOSERS' ? `Losers Round ${round}` : tournament?.format === 'DOUBLE_ELIMINATION' ? `Winners Round ${round}` : round === Math.max(...stageMatches.map((match: any) => match.round)) ? 'Final' : `Round ${round}`}</Text>
        {stageMatches.filter((match: any) => match.round === round).map((match: any) => <BracketMatch key={match.id} match={match} raceTo={tournament?.raceTo} entriesByUser={entriesByUser} currentUserId={currentUserId} onPlayerPress={onPlayerPress} />)}
      </View>)}
    </View>)}
  </>;
}

function BracketMatch({ match, raceTo, entriesByUser, currentUserId, onPlayerPress }: any) {
  const p1 = entriesByUser.get(match.player1Id);
  const p2 = entriesByUser.get(match.player2Id);
  const winner = entriesByUser.get(match.winnerId);
  const isOwn = match.player1Id === currentUserId || match.player2Id === currentUserId;
  return <View style={[s.matchCard, match.status === 'IN_PROGRESS' && s.matchLive, isOwn && s.matchMine]}>
    <View style={s.matchMeta}><Text style={s.matchMetaText}>{matchLabel(match)}</Text>{isOwn && <Text style={s.myMatchTag}>YOUR MATCH</Text>}</View>
    {match.status === 'IN_PROGRESS' && <View style={s.liveBadge}><Text style={s.liveTxt}>LIVE</Text></View>}
    <MatchPlayer entry={p1} score={match.player1Score} isWinner={match.winnerId === match.player1Id} onPress={() => onPlayerPress(p1)} placeholder={match.status === 'BYE' ? 'Bye' : 'Waiting'} />
    <View style={s.vsBox}><Text style={s.vsTxt}>VS</Text></View>
    <MatchPlayer entry={p2} score={match.player2Score} isWinner={match.winnerId === match.player2Id} onPress={() => onPlayerPress(p2)} placeholder={match.status === 'BYE' ? 'Bye' : 'Waiting'} />
    <Text style={s.matchDetails}>Race To {raceTo || 5}{match.scheduledAt ? ` · ${new Date(match.scheduledAt).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })}` : ''}{match.table?.tableNumber ? ` · Table ${match.table.tableNumber}` : ''}</Text>
    {match.status === 'COMPLETED' && winner && <Text style={s.winnerTxt}>Winner: {winner.user?.gamifiedProfile?.displayName || winner.user?.firstName}</Text>}
    {match.status === 'BYE' && <Text style={s.byeTxt}>BYE — Auto advance</Text>}
    {match.status === 'PENDING' && (!match.player1Id || !match.player2Id) && <Text style={s.byeTxt}>Waiting for previous match</Text>}
  </View>;
}

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
  pendingFeeNotice: { flexDirection: 'row', gap: 10, padding: 14, borderRadius: 13, backgroundColor: COLORS.warning + '18', borderWidth: 1, borderColor: COLORS.warning + '80' },
  pendingFeeTitle: { color: COLORS.warning, fontWeight: '800', fontSize: 14 },
  pendingFeeText: { color: COLORS.textSecondary, fontSize: 12, lineHeight: 18, marginTop: 3 },
  pendingFeeTopup: { color: COLORS.primary, fontWeight: '800', marginTop: 7 },
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
  detailNote: { color: COLORS.textSecondary, fontSize: 12 },
  championCard: { backgroundColor: COLORS.gold + '18', borderWidth: 1, borderColor: COLORS.gold + '80', borderRadius: 12, padding: 12, alignItems: 'center' },
  championTitle: { color: COLORS.gold, fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1 },
  championName: { color: COLORS.textPrimary, fontSize: 18, fontWeight: '800', marginTop: 3 },
  championDate: { color: COLORS.textSecondary, fontSize: 11, marginTop: 2 },
  registerBtn: { backgroundColor: COLORS.primary, borderRadius: 14, height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  registerTxt: { fontSize: 16, fontWeight: '700', color: '#000' },
  restrictedTitle: { color: COLORS.textPrimary, fontSize: 19, fontWeight: '800', marginTop: 14 },
  restrictedText: { color: COLORS.textSecondary, textAlign: 'center', paddingHorizontal: 32, lineHeight: 20, marginTop: 6 },
  restrictedBtn: { marginTop: 18, backgroundColor: COLORS.primary, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12 },
  restrictedBtnTxt: { color: '#00150f', fontWeight: '800' },
  registeredBadge: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: COLORS.success + '20', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: COLORS.success },
  registeredTxt: { color: COLORS.success, fontWeight: '700', flex: 1 },
  cancelRegistrationBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 48, borderRadius: 13, borderWidth: 1, borderColor: COLORS.error, backgroundColor: COLORS.error + '12' },
  cancelRegistrationTxt: { color: COLORS.error, fontSize: 14, fontWeight: '800' },
  fullBadge: { alignItems: 'center', padding: 14, backgroundColor: COLORS.surfaceBorder, borderRadius: 14 },
  fullTxt: { color: COLORS.textMuted },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: COLORS.textPrimary },
  presentationEmpty: { padding: 18, backgroundColor: COLORS.surface, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: COLORS.surfaceBorder },
  bracketStage: { gap: 4 },
  stageTitle: { color: COLORS.primary, fontSize: 14, fontWeight: '800', marginTop: 4 },
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
  matchMine: { borderColor: COLORS.primary, borderWidth: 2 },
  matchMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  matchMetaText: { color: COLORS.textMuted, fontSize: 11, fontWeight: '700' },
  myMatchTag: { color: COLORS.primary, fontSize: 10, fontWeight: '900' },
  matchDetails: { color: COLORS.textSecondary, fontSize: 11, textAlign: 'center' },
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
  policyDialog: { flexShrink: 1 },
  policyHeader: { gap: 14 },
  policyScroll: { flexShrink: 1 },
  policyScrollContent: { gap: 14, paddingRight: 2 },
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
  dialogConfirmBtn: { flex: 1.5, height: 46, borderRadius: 12, backgroundColor: COLORS.error, justifyContent: 'center', alignItems: 'center' },
  dialogConfirmTxt: { color: '#fff', fontWeight: '800', fontSize: 13, textAlign: 'center' },
  cancelFeeCard: { width: '100%', backgroundColor: COLORS.error + '12', borderWidth: 1, borderColor: COLORS.error + '70', borderRadius: 12, padding: 14, alignItems: 'center', gap: 4 },
  cancelFeeLabel: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 },
  cancelFeeValue: { color: COLORS.error, fontSize: 25, fontWeight: '900' },
  cancelFeeReason: { color: COLORS.textSecondary, fontSize: 12, lineHeight: 17, textAlign: 'center' },
});
