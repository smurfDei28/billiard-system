import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  RefreshControl, ActivityIndicator, Alert, Modal, TextInput,
  Platform,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../context/AuthContext';
import { COLORS } from '../../constants';

// ─── Constants ────────────────────────────────────────────────────────────────

const FORMATS = [
  { key: 'SINGLE_ELIMINATION', label: 'Single Elimination', desc: "Lose once and you're out" },
  { key: 'DOUBLE_ELIMINATION', label: 'Double Elimination', desc: 'Two losses to be eliminated' },
  { key: 'ROUND_ROBIN', label: 'Round Robin', desc: 'Everyone plays everyone' },
];

const GAME_TYPES = [
  { key: 'EIGHT_BALL', label: '8-Ball' },
  { key: 'NINE_BALL', label: '9-Ball' },
  { key: 'TEN_BALL', label: '10-Ball' },
];

const STATUS_COLORS: Record<string, string> = {
  UPCOMING: COLORS.info,
  REGISTRATION_OPEN: COLORS.success,
  IN_PROGRESS: COLORS.gold,
  COMPLETED: COLORS.textMuted,
  CANCELLED: COLORS.error,
};

const GAME_LABELS: Record<string, string> = {
  EIGHT_BALL: '8-Ball',
  NINE_BALL: '9-Ball',
  TEN_BALL: '10-Ball',
};

const ENTRY_STATUS_COLORS: Record<string, string> = {
  PENDING_PAYMENT: '#f59e0b',
  PENDING_APPROVAL: '#3b82f6',
  APPROVED: COLORS.success,
  CANCELLED: COLORS.error,
};

/** Minimum start: 3 days from now */
const minStartDate = () => {
  const d = new Date();
  d.setDate(d.getDate() + 3);
  d.setHours(d.getHours() + 1, 0, 0, 0);
  return d;
};

const formatDuration = (minutes: number) => {
  if (minutes < 60) return `~${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `~${h}h ${m}m` : `~${h}h`;
};

// ─── Sub-components (outside main to prevent keyboard bug) ───────────────────

const Field = ({ label, value, onChange, placeholder, keyboardType, multiline }: any) => (
  <View style={s.fieldGroup}>
    <Text style={s.fieldLabel}>{label}</Text>
    <TextInput
      style={[s.fieldInput, multiline && { height: 80, textAlignVertical: 'top' }]}
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor={COLORS.textMuted}
      keyboardType={keyboardType || 'default'}
      multiline={multiline}
      autoCapitalize="none"
    />
  </View>
);

const DatePickerField = ({
  label, value, onChange, minimumDate,
}: {
  label: string;
  value: Date;
  onChange: (d: Date) => void;
  minimumDate?: Date;
}) => {
  const [show, setShow] = useState(false);
  const [mode, setMode] = useState<'date' | 'time'>('date');

  const openDate = () => { setMode('date'); setShow(true); };
  const openTime = () => { setMode('time'); setShow(true); };

  const handleChange = (_: any, selected?: Date) => {
    if (Platform.OS !== 'ios') setShow(false);
    if (!selected) return;
    // Validate: must not be before minimumDate
    if (minimumDate && selected < minimumDate) {
      Alert.alert(
        'Invalid Date',
        `The date must be at least 3 days from today (${minimumDate.toLocaleDateString('en-PH')}).`
      );
      return;
    }
    onChange(selected);
  };

  return (
    <View style={s.fieldGroup}>
      <Text style={s.fieldLabel}>{label}</Text>
      <View style={s.dateRow}>
        <TouchableOpacity style={[s.dateBtn, { flex: 1.3 }]} onPress={openDate}>
          <Ionicons name="calendar-outline" size={16} color={COLORS.primary} />
          <Text style={s.dateBtnTxt}>
            {value.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' })}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.dateBtn, { flex: 1 }]} onPress={openTime}>
          <Ionicons name="time-outline" size={16} color={COLORS.primary} />
          <Text style={s.dateBtnTxt}>
            {value.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })}
          </Text>
        </TouchableOpacity>
      </View>
      {show && (
        <DateTimePicker
          value={value}
          mode={mode}
          display={Platform.OS === 'ios' ? 'inline' : 'default'}
          minimumDate={minimumDate}
          onChange={handleChange}
        />
      )}
    </View>
  );
};

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function TournamentManagementScreen() {
  const [tournaments, setTournaments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [createModal, setCreateModal] = useState(false);
  const [selectedT, setSelectedT] = useState<any>(null);
  const [pendingEntries, setPendingEntries] = useState<any[]>([]);
  const [showPending, setShowPending] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [cancelModal, setCancelModal] = useState<{ entryId: string; name: string } | null>(null);
  const [cancelNote, setCancelNote] = useState('');

  const [form, setForm] = useState({
    name: '',
    format: 'SINGLE_ELIMINATION',
    gameType: 'EIGHT_BALL',
    maxPlayers: '8',
    entryFee: '0',
    prizePool: '0',
    description: '',
    startDate: minStartDate(),
  });

  const fetchTournaments = useCallback(async () => {
    try {
      const res = await api.get('/api/tournaments');
      setTournaments(res.data);
    } catch {}
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { fetchTournaments(); }, []);

  const openTournament = async (t: any) => {
    try {
      const [tRes, pRes] = await Promise.all([
        api.get(`/api/tournaments/${t.id}`),
        api.get(`/api/tournaments/${t.id}/pending-entries`),
      ]);
      setSelectedT(tRes.data);
      setPendingEntries(pRes.data);
    } catch { Alert.alert('Error', 'Failed to load tournament'); }
  };

  const refreshSelectedTournament = async (tournamentId: string) => {
    try {
      const [tRes, pRes] = await Promise.all([
        api.get(`/api/tournaments/${tournamentId}`),
        api.get(`/api/tournaments/${tournamentId}/pending-entries`),
      ]);
      setSelectedT(tRes.data);
      setPendingEntries(pRes.data);
      fetchTournaments();
    } catch {}
  };

  // ── Create Tournament ──
  const createTournament = async () => {
    if (!form.name.trim()) return Alert.alert('Error', 'Tournament name is required');

    const minDate = minStartDate();
    if (form.startDate < minDate) {
      return Alert.alert(
        'Invalid Date',
        'Tournament must be scheduled at least 3 days in advance.'
      );
    }

    setActionLoading(true);
    try {
      await api.post('/api/tournaments', {
        name: form.name.trim(),
        format: form.format,
        gameType: form.gameType,
        maxPlayers: parseInt(form.maxPlayers),
        entryFee: parseFloat(form.entryFee) || 0,
        prizePool: parseFloat(form.prizePool) || 0,
        description: form.description,
        startDate: form.startDate.toISOString(),
      });
      fetchTournaments();
      setCreateModal(false);
      Alert.alert('✅ Created', `${form.name} has been created and members have been notified.`);
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.error || 'Failed to create tournament');
    } finally { setActionLoading(false); }
  };

  // ── Generate Brackets ──
  const generateBrackets = async () => {
    if (!selectedT) return;
    const approvedCount = selectedT.entries?.filter(
      (e: any) => e.status === 'APPROVED' || e.status === 'CHECKED_IN'
    ).length || 0;

    if (approvedCount < 2) {
      return Alert.alert('Error', 'Need at least 2 approved players to generate brackets');
    }
    Alert.alert(
      'Generate Brackets',
      `Generate brackets for ${approvedCount} approved players?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Generate', onPress: async () => {
            setActionLoading(true);
            try {
              await api.post(`/api/tournaments/${selectedT.id}/brackets`);
              await refreshSelectedTournament(selectedT.id);
              Alert.alert('✅ Brackets Generated!');
            } catch (err: any) {
              Alert.alert('Error', err.response?.data?.error || 'Failed');
            } finally { setActionLoading(false); }
          }
        }
      ]
    );
  };

  // ── Approve Entry ──
  const approveEntry = async (entryId: string, memberName: string) => {
    setActionLoading(true);
    try {
      await api.patch(`/api/tournaments/entries/${entryId}/approve`);
      Alert.alert('✅ Approved', `${memberName} has been approved and notified.`);
      await refreshSelectedTournament(selectedT.id);
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.error || 'Failed to approve');
    } finally { setActionLoading(false); }
  };

  // ── Cancel Entry ──
  const confirmCancelEntry = async () => {
    if (!cancelModal) return;
    setActionLoading(true);
    try {
      await api.patch(`/api/tournaments/entries/${cancelModal.entryId}/cancel`, {
        cancelNote: cancelNote.trim() || undefined,
      });
      Alert.alert('Cancelled', `${cancelModal.name}'s registration has been cancelled.`);
      setCancelModal(null);
      setCancelNote('');
      await refreshSelectedTournament(selectedT.id);
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.error || 'Failed to cancel');
    } finally { setActionLoading(false); }
  };

  // ── Report Match Result ──
  const reportResult = async (
    matchId: string,
    winnerId: string,
    p1Score: number,
    p2Score: number,
    tournamentId: string
  ) => {
    setActionLoading(true);
    try {
      const res = await api.patch(`/api/tournaments/matches/${matchId}/result`, {
        winnerId, player1Score: p1Score, player2Score: p2Score,
      });
      if (res.data.tournament) {
        setSelectedT(res.data.tournament);
      } else {
        await refreshSelectedTournament(tournamentId);
      }
      fetchTournaments();
      if (res.data.tournament?.status === 'COMPLETED') {
        const winnerEntry = res.data.tournament.entries?.find((e: any) => e.userId === winnerId);
        const winnerName = winnerEntry?.user?.gamifiedProfile?.displayName || winnerEntry?.user?.firstName || 'The winner';
        Alert.alert('🏆 Tournament Complete!', `${winnerName} wins the tournament!`);
      }
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.error || 'Failed to report result');
    } finally { setActionLoading(false); }
  };

  const isMatchReady = (match: any) =>
    match.status === 'PENDING' && match.player1Id && match.player2Id;

  if (loading) return (
    <View style={s.center}>
      <ActivityIndicator size="large" color={COLORS.primary} />
    </View>
  );

  return (
    <View style={s.container}>
      <View style={s.header}>
        <Text style={s.title}>🏆 Tournaments</Text>
        <TouchableOpacity style={s.createBtn} onPress={() => setCreateModal(true)}>
          <Ionicons name="add" size={18} color="#000" />
          <Text style={s.createBtnTxt}>Create</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={s.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchTournaments(); }} tintColor={COLORS.primary} />
        }
      >
        {tournaments.length === 0 && (
          <View style={s.empty}><Text style={s.emptyTxt}>No tournaments yet. Create one!</Text></View>
        )}
        {tournaments.map((t: any) => (
          <TouchableOpacity key={t.id} style={s.card} onPress={() => openTournament(t)} activeOpacity={0.8}>
            <View style={s.cardTop}>
              <View style={s.cardInfo}>
                <Text style={s.cardName}>{t.name}</Text>
                <Text style={s.cardFormat}>
                  {GAME_LABELS[t.gameType] || t.gameType} · {t.format.replace(/_/g, ' ')} · Max {t.maxPlayers}
                </Text>
              </View>
              <View style={[s.statusBadge, { backgroundColor: STATUS_COLORS[t.status] + '25' }]}>
                <Text style={[s.statusTxt, { color: STATUS_COLORS[t.status] }]}>
                  {t.status.replace(/_/g, ' ')}
                </Text>
              </View>
            </View>
            <Text style={s.cardMetaTxt}>
              👥 {t._count?.entries || 0}/{t.maxPlayers} ·{' '}
              📅 {new Date(t.startDate).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}{' '}
              {new Date(t.startDate).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })}
              {t.estimatedDuration ? ` · ⏱ ${formatDuration(t.estimatedDuration)}` : ''}
              {t.prizePool > 0 ? ` · 🏆 ₱${t.prizePool}` : ''}
              {t.entryFee > 0 ? ` · ₱${t.entryFee} entry` : ' · Free'}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* ── Create Tournament Modal ── */}
      <Modal visible={createModal} animationType="slide">
        <View style={s.modal}>
          <View style={s.modalHeader}>
            <TouchableOpacity onPress={() => setCreateModal(false)}>
              <Ionicons name="close" size={24} color={COLORS.textPrimary} />
            </TouchableOpacity>
            <Text style={s.modalTitle}>Create Tournament</Text>
            <View style={{ width: 24 }} />
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.modalContent}>
            <Field
              label="Tournament Name" value={form.name}
              onChange={(v: string) => setForm(f => ({ ...f, name: v }))}
              placeholder="e.g. Saturday Night Showdown"
            />

            {/* Game Type Dropdown */}
            <Text style={s.fieldLabel}>Game Type</Text>
            <View style={s.dropdownRow}>
              {GAME_TYPES.map(gt => (
                <TouchableOpacity
                  key={gt.key}
                  style={[s.dropBtn, form.gameType === gt.key && s.dropBtnActive]}
                  onPress={() => setForm(f => ({ ...f, gameType: gt.key }))}
                >
                  <Text style={[s.dropBtnTxt, form.gameType === gt.key && s.dropBtnTxtActive]}>
                    {gt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Format */}
            <Text style={s.fieldLabel}>Format</Text>
            {FORMATS.map(fmt => (
              <TouchableOpacity
                key={fmt.key}
                style={[s.fmtBtn, form.format === fmt.key && s.fmtBtnActive]}
                onPress={() => setForm(f => ({ ...f, format: fmt.key }))}
              >
                <Text style={[s.fmtLabel, form.format === fmt.key && s.fmtLabelActive]}>{fmt.label}</Text>
                <Text style={s.fmtDesc}>{fmt.desc}</Text>
              </TouchableOpacity>
            ))}

            <View style={s.row}>
              <View style={{ flex: 1 }}>
                <Field
                  label="Max Players" value={form.maxPlayers}
                  onChange={(v: string) => setForm(f => ({ ...f, maxPlayers: v }))}
                  keyboardType="numeric"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Field
                  label="Entry Fee (₱)" value={form.entryFee}
                  onChange={(v: string) => setForm(f => ({ ...f, entryFee: v }))}
                  keyboardType="decimal-pad"
                />
              </View>
            </View>

            <Field
              label="Prize Pool (₱)" value={form.prizePool}
              onChange={(v: string) => setForm(f => ({ ...f, prizePool: v }))}
              keyboardType="decimal-pad"
            />

            {/* Date + Time Picker (at least 3 days out) */}
            <DatePickerField
              label="Start Date & Time (min. 3 days from today)"
              value={form.startDate}
              onChange={(d: Date) => setForm(f => ({ ...f, startDate: d }))}
              minimumDate={minStartDate()}
            />

            {/* Estimated Duration Preview */}
            {form.maxPlayers && parseInt(form.maxPlayers) >= 2 && (
              <View style={s.durationHint}>
                <Ionicons name="time-outline" size={14} color={COLORS.textMuted} />
                <Text style={s.durationHintTxt}>
                  Estimated duration: {formatDuration(
                    calcClientDuration(form.format, parseInt(form.maxPlayers), form.gameType)
                  )}
                </Text>
              </View>
            )}

            <Field
              label="Description (optional)" value={form.description}
              onChange={(v: string) => setForm(f => ({ ...f, description: v }))}
              placeholder="Tournament details..." multiline
            />

            <TouchableOpacity
              style={[s.submitBtn, actionLoading && s.submitBtnDis]}
              onPress={createTournament} disabled={actionLoading}
            >
              {actionLoading
                ? <ActivityIndicator color="#000" />
                : <Text style={s.submitTxt}>Create Tournament</Text>
              }
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>

      {/* ── Tournament Detail Modal ── */}
      <Modal visible={!!selectedT} animationType="slide">
        <View style={s.modal}>
          <View style={s.modalHeader}>
            <TouchableOpacity onPress={() => setSelectedT(null)}>
              <Ionicons name="arrow-back" size={24} color={COLORS.textPrimary} />
            </TouchableOpacity>
            <Text style={s.modalTitle} numberOfLines={1}>{selectedT?.name}</Text>
            <TouchableOpacity onPress={() => selectedT && refreshSelectedTournament(selectedT.id)}>
              <Ionicons name="refresh" size={22} color={COLORS.primary} />
            </TouchableOpacity>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.modalContent}>
            {selectedT && (
              <>
                {/* Info Card */}
                <View style={s.infoCard}>
                  <View style={[s.statusBadge, { backgroundColor: STATUS_COLORS[selectedT.status] + '25', alignSelf: 'flex-start' }]}>
                    <Text style={[s.statusTxt, { color: STATUS_COLORS[selectedT.status] }]}>
                      {selectedT.status.replace(/_/g, ' ')}
                    </Text>
                  </View>
                  <Text style={s.infoFormat}>
                    {GAME_LABELS[selectedT.gameType] || selectedT.gameType} ·{' '}
                    {selectedT.format.replace(/_/g, ' ')} ·{' '}
                    {selectedT.entries?.length || 0}/{selectedT.maxPlayers} players
                  </Text>
                  <Text style={s.infoMeta}>
                    📅 {new Date(selectedT.startDate).toLocaleDateString('en-PH', {
                      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
                    })}{' '}
                    at {new Date(selectedT.startDate).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                  {selectedT.estimatedDuration && (
                    <Text style={s.infoMeta}>⏱ Est. Duration: {formatDuration(selectedT.estimatedDuration)}</Text>
                  )}
                  {selectedT.description && <Text style={s.infoDesc}>{selectedT.description}</Text>}
                </View>

                {/* Pending Entries (approval panel) */}
                {pendingEntries.length > 0 && (
                  <>
                    <TouchableOpacity
                      style={s.pendingToggle}
                      onPress={() => setShowPending(p => !p)}
                    >
                      <View style={s.pendingBadge}>
                        <Text style={s.pendingBadgeTxt}>{pendingEntries.length}</Text>
                      </View>
                      <Text style={s.pendingToggleTxt}>Pending Registrations</Text>
                      <Ionicons
                        name={showPending ? 'chevron-up' : 'chevron-down'}
                        size={16} color={COLORS.textMuted}
                      />
                    </TouchableOpacity>

                    {showPending && pendingEntries.map((entry: any) => (
                      <View key={entry.id} style={s.pendingCard}>
                        <View style={{ flex: 1 }}>
                          <Text style={s.pendingName}>
                            {entry.user?.firstName} {entry.user?.lastName}
                          </Text>
                          <Text style={s.pendingMeta}>
                            {entry.user?.email} · {entry.user?.phone}
                          </Text>
                          <View style={[s.entryStatusBadge, { backgroundColor: ENTRY_STATUS_COLORS[entry.status] + '25' }]}>
                            <Text style={[s.entryStatusTxt, { color: ENTRY_STATUS_COLORS[entry.status] }]}>
                              {entry.status.replace(/_/g, ' ')}
                            </Text>
                          </View>
                          {entry.paymentMethod && (
                            <Text style={s.pendingMeta}>
                              💳 {entry.paymentMethod}{entry.paymentRef ? ` — Ref: ${entry.paymentRef}` : ''}
                            </Text>
                          )}
                        </View>
                        <View style={s.pendingActions}>
                          <TouchableOpacity
                            style={s.approveBtn}
                            onPress={() => approveEntry(entry.id, `${entry.user?.firstName} ${entry.user?.lastName}`)}
                            disabled={actionLoading}
                          >
                            <Ionicons name="checkmark" size={16} color="#fff" />
                            <Text style={s.approveBtnTxt}>Approve</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={s.cancelEntryBtn}
                            onPress={() => setCancelModal({ entryId: entry.id, name: `${entry.user?.firstName} ${entry.user?.lastName}` })}
                            disabled={actionLoading}
                          >
                            <Ionicons name="close" size={16} color={COLORS.error} />
                          </TouchableOpacity>
                        </View>
                      </View>
                    ))}
                  </>
                )}

                {/* Generate Brackets */}
                {(selectedT.status === 'REGISTRATION_OPEN' || selectedT.status === 'UPCOMING') &&
                  selectedT.entries?.filter((e: any) => e.status === 'APPROVED' || e.status === 'CHECKED_IN').length >= 2 && (
                    <TouchableOpacity style={s.generateBtn} onPress={generateBrackets} disabled={actionLoading}>
                      {actionLoading
                        ? <ActivityIndicator color="#000" />
                        : <>
                          <Ionicons name="git-branch-outline" size={18} color="#000" />
                          <Text style={s.generateTxt}>
                            Generate Brackets ({selectedT.entries?.filter((e: any) => e.status === 'APPROVED' || e.status === 'CHECKED_IN').length} approved players)
                          </Text>
                        </>
                      }
                    </TouchableOpacity>
                  )}

                {/* Players List */}
                <Text style={s.sectionTitle}>
                  Players ({selectedT.entries?.filter((e: any) => e.status === 'APPROVED').length || 0} approved)
                </Text>
                {selectedT.entries?.map((entry: any, i: number) => (
                  <View key={entry.id} style={s.playerRow}>
                    <Text style={s.playerIdx}>#{i + 1}</Text>
                    <Text style={s.playerName}>
                      {entry.user?.gamifiedProfile?.displayName || `${entry.user?.firstName} ${entry.user?.lastName}`}
                    </Text>
                    <View style={[s.entryStatusBadge, { backgroundColor: ENTRY_STATUS_COLORS[entry.status] + '25' }]}>
                      <Text style={[s.entryStatusTxt, { color: ENTRY_STATUS_COLORS[entry.status] }]}>
                        {entry.status.replace(/_/g, ' ')}
                      </Text>
                    </View>
                    {entry.status !== 'CANCELLED' && (
                      <TouchableOpacity
                        onPress={() => setCancelModal({ entryId: entry.id, name: `${entry.user?.firstName} ${entry.user?.lastName}` })}
                        style={s.cancelIconBtn}
                      >
                        <Ionicons name="close-circle-outline" size={20} color={COLORS.error} />
                      </TouchableOpacity>
                    )}
                  </View>
                ))}

                {/* Bracket */}
                {selectedT.matches?.length > 0 && (
                  <>
                    <Text style={s.sectionTitle}>Bracket</Text>
                    {[...new Set(selectedT.matches.map((m: any) => m.round))].map((round: any) => {
                      const roundMatches = selectedT.matches.filter((m: any) => m.round === round);
                      return (
                        <View key={round} style={s.roundSection}>
                          <Text style={s.roundTitle}>
                            {round === Math.max(...selectedT.matches.map((m: any) => m.round))
                              ? '🏆 Final' : `Round ${round}`}
                          </Text>
                          {roundMatches.map((match: any) => {
                            const p1 = selectedT.entries?.find((e: any) => e.userId === match.player1Id);
                            const p2 = selectedT.entries?.find((e: any) => e.userId === match.player2Id);
                            const p1Name = p1?.user?.gamifiedProfile?.displayName || p1?.user?.firstName || 'TBD';
                            const p2Name = p2?.user?.gamifiedProfile?.displayName || p2?.user?.firstName || 'TBD';
                            const ready = isMatchReady(match);

                            return (
                              <View
                                key={match.id}
                                style={[
                                  s.matchCard,
                                  ready && { borderColor: COLORS.primary },
                                  match.status === 'COMPLETED' && { opacity: 0.75 },
                                ]}
                              >
                                <View style={s.matchRow}>
                                  <Text style={[s.matchPlayer, match.winnerId === match.player1Id && match.status === 'COMPLETED' && s.matchWinner, !match.player1Id && s.matchTBD]}>
                                    {p1Name}
                                  </Text>
                                  <Text style={s.matchVS}>vs</Text>
                                  <Text style={[s.matchPlayer, s.matchPlayerR, match.winnerId === match.player2Id && match.status === 'COMPLETED' && s.matchWinner, !match.player2Id && s.matchTBD]}>
                                    {p2Name}
                                  </Text>
                                </View>

                                {match.status === 'COMPLETED' ? (
                                  <Text style={s.matchResult}>
                                    {match.player1Score} – {match.player2Score} · ✅ {match.winnerId === match.player1Id ? p1Name : p2Name} wins
                                  </Text>
                                ) : match.status === 'BYE' ? (
                                  <Text style={s.matchBye}>BYE — {p1Name} auto-advances</Text>
                                ) : ready ? (
                                  <TouchableOpacity
                                    style={s.winBtn}
                                    disabled={actionLoading}
                                    onPress={() => Alert.alert(
                                      'Report Result',
                                      `Who won Match ${match.matchNumber}?`,
                                      [
                                        { text: 'Cancel', style: 'cancel' },
                                        { text: `🏆 ${p1Name}`, onPress: () => reportResult(match.id, match.player1Id, 1, 0, selectedT.id) },
                                        { text: `🏆 ${p2Name}`, onPress: () => reportResult(match.id, match.player2Id, 0, 1, selectedT.id) },
                                      ]
                                    )}
                                  >
                                    <Ionicons name="trophy-outline" size={14} color={COLORS.gold} />
                                    <Text style={s.winBtnTxt}>Report Winner</Text>
                                  </TouchableOpacity>
                                ) : (
                                  <Text style={s.matchWaiting}>⏳ Waiting for previous round</Text>
                                )}
                              </View>
                            );
                          })}
                        </View>
                      );
                    })}
                  </>
                )}

                {selectedT.status === 'COMPLETED' && (
                  <View style={s.completeBanner}>
                    <Text style={s.completeBannerTxt}>🏆 Tournament Complete!</Text>
                    {selectedT.entries?.find((e: any) => e.status === 'WINNER') && (
                      <Text style={s.completeWinnerTxt}>
                        Winner: {selectedT.entries.find((e: any) => e.status === 'WINNER')?.user?.gamifiedProfile?.displayName || selectedT.entries.find((e: any) => e.status === 'WINNER')?.user?.firstName}
                      </Text>
                    )}
                  </View>
                )}
              </>
            )}
          </ScrollView>
        </View>
      </Modal>

      {/* ── Cancel Entry Modal ── */}
      <Modal visible={!!cancelModal} transparent animationType="fade">
        <View style={s.overlay}>
          <View style={s.dialogBox}>
            <Text style={s.dialogTitle}>Cancel Registration</Text>
            <Text style={s.dialogBody}>
              Are you sure you want to cancel <Text style={{ fontWeight: '700' }}>{cancelModal?.name}</Text>'s registration?
            </Text>
            <Text style={s.dialogBody}>
              Please note: entry fees are <Text style={{ fontWeight: '700', color: COLORS.error }}>non-refundable</Text>.
            </Text>
            <TextInput
              style={s.cancelNoteInput}
              placeholder="Reason (optional)"
              placeholderTextColor={COLORS.textMuted}
              value={cancelNote}
              onChangeText={setCancelNote}
            />
            <View style={s.dialogActions}>
              <TouchableOpacity
                style={s.dialogCancelBtn}
                onPress={() => { setCancelModal(null); setCancelNote(''); }}
              >
                <Text style={s.dialogCancelTxt}>Back</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={s.dialogConfirmBtn}
                onPress={confirmCancelEntry}
                disabled={actionLoading}
              >
                {actionLoading ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.dialogConfirmTxt}>Yes, Cancel</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// Client-side duration estimate (mirrors backend logic)
function calcClientDuration(format: string, playerCount: number, gameType: string): number {
  const avg: Record<string, number> = { EIGHT_BALL: 25, NINE_BALL: 20, TEN_BALL: 30 };
  const a = avg[gameType] || 25;
  if (format === 'ROUND_ROBIN') return Math.ceil(((playerCount * (playerCount - 1)) / 2 / 2) * a);
  if (format === 'DOUBLE_ELIMINATION') return Math.ceil(Math.log2(playerCount)) * 2 * a;
  return Math.ceil(Math.log2(playerCount)) * a;
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background },
  header: { paddingTop: 60, paddingHorizontal: 20, paddingBottom: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.surfaceBorder },
  title: { fontSize: 22, fontWeight: '800', color: COLORS.textPrimary },
  createBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: COLORS.primary, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  createBtnTxt: { color: '#000', fontWeight: '700', fontSize: 13 },
  list: { padding: 16, gap: 12 },
  card: { backgroundColor: COLORS.surface, borderRadius: 16, padding: 16, gap: 8, borderWidth: 1, borderColor: COLORS.surfaceBorder },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  cardInfo: { flex: 1 },
  cardName: { fontSize: 16, fontWeight: '700', color: COLORS.textPrimary },
  cardFormat: { fontSize: 12, color: COLORS.textSecondary },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  statusTxt: { fontSize: 11, fontWeight: '700' },
  cardMetaTxt: { fontSize: 12, color: COLORS.textMuted },
  empty: { padding: 40, alignItems: 'center' },
  emptyTxt: { color: COLORS.textMuted },
  modal: { flex: 1, backgroundColor: COLORS.background },
  modalHeader: { paddingTop: 60, paddingHorizontal: 20, paddingBottom: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.surfaceBorder },
  modalTitle: { flex: 1, fontSize: 18, fontWeight: '800', color: COLORS.textPrimary, textAlign: 'center' },
  modalContent: { padding: 16, gap: 14 },
  fieldGroup: { gap: 6 },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: COLORS.textSecondary },
  fieldInput: { backgroundColor: COLORS.surface, borderRadius: 10, paddingHorizontal: 14, height: 46, color: COLORS.textPrimary, borderWidth: 1, borderColor: COLORS.surfaceBorder, fontSize: 15 },
  row: { flexDirection: 'row', gap: 10 },
  dropdownRow: { flexDirection: 'row', gap: 8 },
  dropBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: COLORS.surfaceBorder, alignItems: 'center', backgroundColor: COLORS.surface },
  dropBtnActive: { borderColor: COLORS.primary, backgroundColor: COLORS.primary + '15' },
  dropBtnTxt: { fontSize: 14, fontWeight: '700', color: COLORS.textMuted },
  dropBtnTxtActive: { color: COLORS.primary },
  fmtBtn: { backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, gap: 4, borderWidth: 1, borderColor: COLORS.surfaceBorder },
  fmtBtnActive: { borderColor: COLORS.primary, backgroundColor: COLORS.primary + '10' },
  fmtLabel: { fontSize: 14, fontWeight: '700', color: COLORS.textMuted },
  fmtLabelActive: { color: COLORS.primary },
  fmtDesc: { fontSize: 12, color: COLORS.textMuted },
  dateRow: { flexDirection: 'row', gap: 8 },
  dateBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: COLORS.surface, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, borderWidth: 1, borderColor: COLORS.surfaceBorder },
  dateBtnTxt: { fontSize: 13, color: COLORS.textPrimary, fontWeight: '600' },
  durationHint: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: COLORS.surfaceLight || COLORS.surface, borderRadius: 8, padding: 10 },
  durationHintTxt: { fontSize: 12, color: COLORS.textMuted },
  submitBtn: { backgroundColor: COLORS.primary, borderRadius: 14, height: 52, justifyContent: 'center', alignItems: 'center', marginTop: 8 },
  submitBtnDis: { opacity: 0.5 },
  submitTxt: { color: '#000', fontWeight: '800', fontSize: 16 },
  infoCard: { backgroundColor: COLORS.surface, borderRadius: 14, padding: 16, gap: 8, borderWidth: 1, borderColor: COLORS.surfaceBorder },
  infoFormat: { fontSize: 15, fontWeight: '700', color: COLORS.textPrimary },
  infoMeta: { fontSize: 13, color: COLORS.textSecondary },
  infoDesc: { fontSize: 13, color: COLORS.textSecondary },
  pendingToggle: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#f59e0b20', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#f59e0b' },
  pendingBadge: { backgroundColor: '#f59e0b', borderRadius: 10, width: 22, height: 22, justifyContent: 'center', alignItems: 'center' },
  pendingBadgeTxt: { color: '#fff', fontSize: 12, fontWeight: '800' },
  pendingToggleTxt: { flex: 1, fontSize: 14, fontWeight: '700', color: '#f59e0b' },
  pendingCard: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: COLORS.surfaceBorder },
  pendingName: { fontSize: 14, fontWeight: '700', color: COLORS.textPrimary },
  pendingMeta: { fontSize: 11, color: COLORS.textMuted },
  pendingActions: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  approveBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: COLORS.success, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
  approveBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 12 },
  cancelEntryBtn: { padding: 6 },
  entryStatusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, alignSelf: 'flex-start', marginTop: 4 },
  entryStatusTxt: { fontSize: 10, fontWeight: '700' },
  generateBtn: { backgroundColor: COLORS.primary, borderRadius: 14, height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  generateTxt: { color: '#000', fontWeight: '800', fontSize: 15 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: COLORS.textPrimary },
  playerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: COLORS.surface, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: COLORS.surfaceBorder },
  playerIdx: { fontSize: 13, color: COLORS.textMuted, width: 24 },
  playerName: { flex: 1, fontSize: 14, fontWeight: '600', color: COLORS.textPrimary },
  playerRank: { fontSize: 11, color: COLORS.textMuted },
  cancelIconBtn: { padding: 4 },
  roundSection: { gap: 8 },
  roundTitle: { fontSize: 13, fontWeight: '700', color: COLORS.textMuted },
  matchCard: { backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, gap: 8, borderWidth: 1, borderColor: COLORS.surfaceBorder },
  matchRow: { flexDirection: 'row', alignItems: 'center' },
  matchPlayer: { flex: 1, fontSize: 14, fontWeight: '600', color: COLORS.textPrimary },
  matchPlayerR: { textAlign: 'right' },
  matchWinner: { color: COLORS.gold, fontWeight: '800' },
  matchTBD: { color: COLORS.textMuted, fontStyle: 'italic' },
  matchVS: { fontSize: 11, color: COLORS.textMuted, paddingHorizontal: 10 },
  matchResult: { fontSize: 12, color: COLORS.success, textAlign: 'center', fontWeight: '600' },
  matchBye: { fontSize: 12, color: COLORS.textMuted, textAlign: 'center', fontStyle: 'italic' },
  matchWaiting: { fontSize: 12, color: COLORS.textMuted, textAlign: 'center', fontStyle: 'italic' },
  winBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: COLORS.gold + '20', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: COLORS.gold, alignSelf: 'center' },
  winBtnTxt: { color: COLORS.gold, fontWeight: '700', fontSize: 13 },
  completeBanner: { backgroundColor: COLORS.gold + '20', borderRadius: 14, padding: 20, alignItems: 'center', gap: 6, borderWidth: 1, borderColor: COLORS.gold },
  completeBannerTxt: { fontSize: 18, fontWeight: '800', color: COLORS.gold },
  completeWinnerTxt: { fontSize: 14, color: COLORS.textPrimary, fontWeight: '600' },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  dialogBox: { backgroundColor: COLORS.surface, borderRadius: 18, padding: 24, gap: 14, width: '100%' },
  dialogTitle: { fontSize: 17, fontWeight: '800', color: COLORS.textPrimary },
  dialogBody: { fontSize: 14, color: COLORS.textSecondary, lineHeight: 21 },
  cancelNoteInput: { borderWidth: 1, borderColor: COLORS.surfaceBorder, borderRadius: 10, paddingHorizontal: 12, height: 42, color: COLORS.textPrimary, fontSize: 14 },
  dialogActions: { flexDirection: 'row', gap: 10 },
  dialogCancelBtn: { flex: 1, height: 44, borderRadius: 10, borderWidth: 1, borderColor: COLORS.surfaceBorder, justifyContent: 'center', alignItems: 'center' },
  dialogCancelTxt: { color: COLORS.textSecondary, fontWeight: '600' },
  dialogConfirmBtn: { flex: 1, height: 44, borderRadius: 10, backgroundColor: COLORS.error, justifyContent: 'center', alignItems: 'center' },
  dialogConfirmTxt: { color: '#fff', fontWeight: '700' },
});
