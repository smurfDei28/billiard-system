import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Platform, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../context/AuthContext';
import { useSocket } from '../../context/SocketContext';
import { COLORS } from '../../constants';

const stageLabel = (match: any) => !match ? 'Match pending' : match.isResetFinal ? 'Reset Final' : match.isGrandFinal ? 'Grand Final' : `${String(match.bracketStage || 'WINNERS').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())} · Round ${match.round} · Match ${match.matchNumber}`;
const playerName = (player: any, id: string) => player?.gamifiedProfile?.displayName || player?.firstName || (id ? 'Player' : 'Waiting');

export default function StaffTournamentOperationsScreen() {
  const { socket } = useSocket();
  const [matches, setMatches] = useState<any[]>([]);
  const [tables, setTables] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [scheduleMatch, setScheduleMatch] = useState<any>(null);
  const [scoreMatch, setScoreMatch] = useState<any>(null);
  const [scheduleDate, setScheduleDate] = useState(new Date());
  const [scheduleTime, setScheduleTime] = useState(new Date());
  const [setupTableId, setSetupTableId] = useState('');
  const [pickerMode, setPickerMode] = useState<'date' | 'time' | null>(null);
  const [scoreOne, setScoreOne] = useState('');
  const [scoreTwo, setScoreTwo] = useState('');

  const load = useCallback(async () => {
    try {
      const [tournaments, tableResult] = await Promise.all([api.get('/api/tournaments'), api.get('/api/tables')]);
      const details = await Promise.all((tournaments.data || []).filter(Boolean).map((t: any) => api.get(`/api/tournaments/${t.id}`)));
      setMatches(details.flatMap((result: any) => (result.data.matches || []).filter(Boolean).map((match: any) => ({
        ...match,
        tournament: result.data,
        player1: result.data.entries?.find((entry: any) => entry.userId === match.player1Id)?.user,
        player2: result.data.entries?.find((entry: any) => entry.userId === match.player2Id)?.user,
      }))));
      setTables(tableResult.data);
    } catch { Alert.alert('Tournament Matches', 'Could not load tournament operations.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    socket?.on('match:started', load);
    socket?.on('match:completed', load);
    socket?.on('match:updated', load);
    return () => { socket?.off('match:started', load); socket?.off('match:completed', load); socket?.off('match:updated', load); };
  }, [socket, load]);

  const act = async (id: string, request: () => Promise<any>) => {
    if (busy) return;
    setBusy(id);
    try { await request(); await load(); }
    catch (error: any) { Alert.alert('Tournament Match', error.response?.data?.error || 'Action failed.'); }
    finally { setBusy(null); }
  };
  const openMatchSetup = (match: any) => {
    const scheduled = match.scheduledAt ? new Date(match.scheduledAt) : new Date();
    setScheduleDate(scheduled);
    setScheduleTime(scheduled);
    setSetupTableId(match.tableId || '');
    setScheduleMatch(match);
  };
  const submitSetup = async () => {
    if (!scheduleMatch) return;
    if (!setupTableId) return Alert.alert('Table Required', 'Assign a table before saving match setup.');
    const scheduledAt = new Date(scheduleDate);
    scheduledAt.setHours(scheduleTime.getHours(), scheduleTime.getMinutes(), 0, 0);
    if (Number.isNaN(scheduledAt.getTime())) return Alert.alert('Invalid Schedule', 'Select a valid match date and time.');
    await act(scheduleMatch.id, async () => {
      await api.patch(`/api/tournaments/matches/${scheduleMatch.id}/setup`, { scheduledAt: scheduledAt.toISOString(), tableId: setupTableId });
    });
    setScheduleMatch(null);
  };
  const submitScore = async () => {
    if (!scoreMatch) return;
    await act(scoreMatch.id, () => api.patch(`/api/tournaments/matches/${scoreMatch.id}/result`, { player1Score: Number(scoreOne), player2Score: Number(scoreTwo) }));
    setScoreMatch(null); setScoreOne(''); setScoreTwo('');
  };
  const groups = [
    { title: 'Pending', icon: 'time-outline', color: COLORS.warning, matches: matches.filter((match) => match.status === 'PENDING') },
    { title: 'LIVE', icon: 'radio-outline', color: COLORS.error, matches: matches.filter((match) => match.status === 'IN_PROGRESS') },
    { title: 'Completed', icon: 'checkmark-circle-outline', color: COLORS.success, matches: matches.filter((match) => match.status === 'COMPLETED') },
  ];

  if (loading) return <View style={s.center}><ActivityIndicator size="large" color={COLORS.primary} /></View>;
  return <View style={s.root}><View style={s.header}><Text style={s.title}>Tournament Matches</Text><Text style={s.subtitle}>Schedule, assign tables, and manage live results</Text></View><ScrollView contentContainerStyle={s.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={COLORS.primary} />}>
    {groups.map((group) => <View key={group.title} style={s.group}><View style={s.groupHeader}><Ionicons name={group.icon as any} size={18} color={group.color} /><Text style={[s.groupTitle, { color: group.color }]}>{group.title}</Text><Text style={s.groupCount}>{group.matches.length}</Text></View>{group.matches.length === 0 ? <Text style={s.empty}>No {group.title.toLowerCase()} matches</Text> : group.matches.map((match) => <MatchCard key={match.id} match={match} busy={busy === match.id} ready={!!match.scheduledAt && !!match.tableId} onSetup={() => openMatchSetup(match)} onStart={() => act(match.id, () => api.post(`/api/tournaments/matches/${match.id}/start`))} onScore={() => { setScoreMatch(match); setScoreOne(String(match.player1Score || '')); setScoreTwo(String(match.player2Score || '')); }} />)}</View>)}
  </ScrollView>
  <Modal visible={!!scheduleMatch} transparent animationType="fade" onRequestClose={() => setScheduleMatch(null)}><View style={s.overlay}><View style={s.dialog}><Text style={s.dialogTitle}>Match Setup</Text><Text style={s.dialogText}>{scheduleMatch?.tournament?.name} · {stageLabel(scheduleMatch)} · Race To {scheduleMatch?.tournament?.raceTo}</Text><Text style={s.fieldLabel}>Match Date</Text><TouchableOpacity style={s.pickerButton} onPress={() => setPickerMode('date')}><Ionicons name="calendar-outline" size={18} color={COLORS.primary} /><Text style={s.pickerText}>{scheduleDate.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })}</Text></TouchableOpacity><Text style={s.fieldLabel}>Match Time</Text><TouchableOpacity style={s.pickerButton} onPress={() => setPickerMode('time')}><Ionicons name="time-outline" size={18} color={COLORS.primary} /><Text style={s.pickerText}>{scheduleTime.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })}</Text></TouchableOpacity>{pickerMode && <DateTimePicker value={pickerMode === 'date' ? scheduleDate : scheduleTime} mode={pickerMode} display={Platform.OS === 'ios' ? 'inline' : 'default'} onChange={(_, value) => { if (Platform.OS !== 'ios') setPickerMode(null); if (value) pickerMode === 'date' ? setScheduleDate(value) : setScheduleTime(value); }} />}<Text style={s.fieldLabel}>Table</Text><ScrollView style={s.tableChoices} nestedScrollEnabled>{tables.map((table: any) => { const selectable = table.status === 'AVAILABLE' || table.id === scheduleMatch?.tableId; return <TouchableOpacity key={table.id} disabled={!selectable} onPress={() => setSetupTableId(table.id)} style={[s.tableChoice, setupTableId === table.id && s.tableChoiceActive, !selectable && s.tableChoiceUnavailable]}><Text style={s.tableChoiceText}>Table {table.tableNumber} · {table.type}</Text><Text style={s.tableChoiceMeta}>{table.status}</Text></TouchableOpacity>; })}</ScrollView><DialogActions busy={busy === scheduleMatch?.id} onCancel={() => setScheduleMatch(null)} onConfirm={submitSetup} confirm="Save Match Setup" /></View></View></Modal>
  <Modal visible={!!scoreMatch} transparent animationType="fade" onRequestClose={() => setScoreMatch(null)}><View style={s.overlay}><View style={s.dialog}><Text style={s.dialogTitle}>Submit Final Score</Text><Text style={s.dialogText}>Race To {scoreMatch?.tournament?.raceTo} · Enter the final scores.</Text><View style={s.scoreRow}><TextInput value={scoreOne} onChangeText={setScoreOne} keyboardType="numeric" placeholder="P1" placeholderTextColor={COLORS.textMuted} style={[s.input, s.scoreInput]} /><Text style={s.scoreDash}>–</Text><TextInput value={scoreTwo} onChangeText={setScoreTwo} keyboardType="numeric" placeholder="P2" placeholderTextColor={COLORS.textMuted} style={[s.input, s.scoreInput]} /></View><DialogActions busy={busy === scoreMatch?.id} onCancel={() => setScoreMatch(null)} onConfirm={submitScore} confirm="Submit Result" /></View></View></Modal>
  </View>;
}

function MatchCard({ match, busy, ready, onSetup, onStart, onScore }: any) {
  const live = match.status === 'IN_PROGRESS';
  return <View style={[s.card, live && s.liveCard]}><View style={s.cardTop}><View style={{ flex: 1 }}><Text style={s.tournamentName} numberOfLines={1}>{match.tournament.name}</Text><Text style={s.stage}>{stageLabel(match)}</Text></View><View style={[s.badge, { backgroundColor: (live ? COLORS.error : match.status === 'COMPLETED' ? COLORS.success : COLORS.warning) + '20' }]}><Text style={[s.badgeText, { color: live ? COLORS.error : match.status === 'COMPLETED' ? COLORS.success : COLORS.warning }]}>{live ? 'LIVE' : match.status === 'COMPLETED' ? 'COMPLETED' : ready ? 'READY' : 'SETUP NEEDED'}</Text></View></View><View style={s.players}><Text style={s.player} numberOfLines={1}>{playerName(match.player1, match.player1Id)}</Text><Text style={s.vs}>VS</Text><Text style={[s.player, s.playerRight]} numberOfLines={1}>{playerName(match.player2, match.player2Id)}</Text></View><Text style={s.meta}>Race To {match.tournament.raceTo} · {match.table?.tableNumber ? `Table ${match.table.tableNumber}` : 'No table assigned'}</Text><Text style={s.meta}>{match.scheduledAt ? `Scheduled ${new Date(match.scheduledAt).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })}` : 'Schedule not selected'} · Score {match.player1Score}–{match.player2Score}</Text>{match.status === 'PENDING' && <View style={s.actions}><Action label={ready ? 'Edit Setup' : 'Set Up Match'} icon="calendar-outline" onPress={onSetup} disabled={busy} /><Action label="Start Match" icon="play-outline" onPress={onStart} disabled={busy || !ready} primary /></View>}{live && <TouchableOpacity style={s.resultBtn} onPress={onScore} disabled={busy}>{busy ? <ActivityIndicator color="#000" size="small" /> : <><Ionicons name="trophy-outline" size={16} color="#000" /><Text style={s.resultText}>Submit Final Score</Text></>}</TouchableOpacity>}</View>;
}

function Action({ label, icon, onPress, disabled, primary }: any) { return <TouchableOpacity style={[s.actionBtn, primary && s.actionPrimary, disabled && s.disabled]} onPress={onPress} disabled={disabled}><Ionicons name={icon} size={15} color={primary ? '#000' : COLORS.textPrimary} /><Text style={[s.actionText, primary && s.actionPrimaryText]}>{label}</Text></TouchableOpacity>; }
function DialogActions({ busy, onCancel, onConfirm, confirm }: any) { return <View style={s.dialogActions}><TouchableOpacity style={s.cancelBtn} onPress={onCancel} disabled={busy}><Text style={s.cancelText}>Cancel</Text></TouchableOpacity><TouchableOpacity style={s.confirmBtn} onPress={onConfirm} disabled={busy}>{busy ? <ActivityIndicator color="#000" size="small" /> : <Text style={s.confirmText}>{confirm}</Text>}</TouchableOpacity></View>; }

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background }, center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background }, header: { paddingTop: 58, paddingHorizontal: 20, paddingBottom: 16, backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.surfaceBorder }, title: { color: COLORS.textPrimary, fontSize: 22, fontWeight: '800' }, subtitle: { color: COLORS.textSecondary, fontSize: 13, marginTop: 3 }, content: { padding: 16, gap: 18 }, group: { gap: 9 }, groupHeader: { flexDirection: 'row', alignItems: 'center', gap: 7 }, groupTitle: { fontSize: 15, fontWeight: '800' }, groupCount: { color: COLORS.textMuted, fontSize: 12, fontWeight: '700' }, empty: { color: COLORS.textMuted, fontSize: 13, paddingVertical: 5 }, card: { backgroundColor: COLORS.surface, borderRadius: 14, padding: 14, gap: 9, borderWidth: 1, borderColor: COLORS.surfaceBorder }, liveCard: { borderColor: COLORS.error }, cardTop: { flexDirection: 'row', gap: 10 }, tournamentName: { color: COLORS.textPrimary, fontSize: 15, fontWeight: '800' }, stage: { color: COLORS.textMuted, fontSize: 11, marginTop: 2 }, badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 7, alignSelf: 'flex-start' }, badgeText: { fontSize: 10, fontWeight: '900' }, players: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: COLORS.surfaceLight, borderRadius: 10, padding: 10 }, player: { flex: 1, color: COLORS.textPrimary, fontSize: 14, fontWeight: '700' }, playerRight: { textAlign: 'right' }, vs: { color: COLORS.textMuted, fontSize: 11, fontWeight: '900' }, meta: { color: COLORS.textSecondary, fontSize: 12 }, actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 2 }, actionBtn: { minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, borderRadius: 9, borderWidth: 1, borderColor: COLORS.surfaceBorder, backgroundColor: COLORS.surfaceLight }, actionPrimary: { backgroundColor: COLORS.primary, borderColor: COLORS.primary }, actionText: { color: COLORS.textPrimary, fontSize: 12, fontWeight: '700' }, actionPrimaryText: { color: '#000' }, resultBtn: { minHeight: 42, borderRadius: 10, backgroundColor: COLORS.primary, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 7 }, resultText: { color: '#000', fontSize: 13, fontWeight: '800' }, disabled: { opacity: 0.55 }, overlay: { flex: 1, backgroundColor: '#000000AA', justifyContent: 'center', alignItems: 'center', padding: 24 }, dialog: { width: '100%', backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.surfaceBorder, borderRadius: 18, padding: 20, gap: 12 }, dialogTitle: { color: COLORS.textPrimary, fontSize: 18, fontWeight: '800' }, dialogText: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 19 }, fieldLabel: { color: COLORS.textSecondary, fontWeight: '800', fontSize: 12, marginTop: 2 }, pickerButton: { minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: COLORS.surfaceBorder, borderRadius: 10, backgroundColor: COLORS.surfaceLight, paddingHorizontal: 12 }, pickerText: { color: COLORS.textPrimary, fontSize: 14, fontWeight: '700' }, tableChoices: { maxHeight: 150 }, tableChoice: { flexDirection: 'row', justifyContent: 'space-between', padding: 12, borderWidth: 1, borderColor: COLORS.surfaceBorder, borderRadius: 10, marginBottom: 7, backgroundColor: COLORS.surfaceLight }, tableChoiceActive: { borderColor: COLORS.primary, backgroundColor: COLORS.primary + '18' }, tableChoiceUnavailable: { opacity: 0.45 }, tableChoiceText: { color: COLORS.textPrimary, fontSize: 13, fontWeight: '700' }, tableChoiceMeta: { color: COLORS.textMuted, fontSize: 11, fontWeight: '800' }, input: { minHeight: 46, color: COLORS.textPrimary, backgroundColor: COLORS.surfaceLight, borderWidth: 1, borderColor: COLORS.surfaceBorder, borderRadius: 10, paddingHorizontal: 12, fontSize: 14 }, scoreRow: { flexDirection: 'row', alignItems: 'center', gap: 8 }, scoreInput: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '800' }, scoreDash: { color: COLORS.textMuted, fontSize: 18, fontWeight: '800' }, dialogActions: { flexDirection: 'row', gap: 10, marginTop: 4 }, cancelBtn: { flex: 1, minHeight: 44, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.surfaceLight, borderRadius: 10 }, cancelText: { color: COLORS.textPrimary, fontWeight: '700' }, confirmBtn: { flex: 1, minHeight: 44, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.primary, borderRadius: 10 }, confirmText: { color: '#000', fontWeight: '800' },
});
