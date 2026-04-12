import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  RefreshControl, ActivityIndicator, Alert, Modal, TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../context/AuthContext';
import { COLORS } from '../../constants';

const FORMATS = [
  { key: 'SINGLE_ELIMINATION', label: 'Single Elimination', desc: 'Lose once and you\'re out' },
  { key: 'DOUBLE_ELIMINATION', label: 'Double Elimination', desc: 'Two losses to be eliminated' },
  { key: 'ROUND_ROBIN', label: 'Round Robin', desc: 'Everyone plays everyone' },
];

export default function TournamentManagementScreen() {
  const [tournaments, setTournaments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [createModal, setCreateModal] = useState(false);
  const [selectedT, setSelectedT] = useState<any>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [form, setForm] = useState({
    name: '', format: 'SINGLE_ELIMINATION', maxPlayers: '8',
    entryFee: '0', prizePool: '0', description: '',
    startDate: new Date(Date.now() + 86400000).toISOString().slice(0, 16),
  });

  const fetchTournaments = useCallback(async () => {
    try {
      const res = await api.get('/api/tournaments');
      setTournaments(res.data);
    } catch { }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { fetchTournaments(); }, []);

  const openTournament = async (t: any) => {
    try {
      const res = await api.get(`/api/tournaments/${t.id}`);
      setSelectedT(res.data);
    } catch { Alert.alert('Error', 'Failed to load tournament'); }
  };

  const createTournament = async () => {
    if (!form.name.trim()) return Alert.alert('Error', 'Tournament name is required');
    setActionLoading(true);
    try {
      await api.post('/api/tournaments', {
        name: form.name.trim(),
        format: form.format,
        maxPlayers: parseInt(form.maxPlayers),
        entryFee: parseFloat(form.entryFee) || 0,
        prizePool: parseFloat(form.prizePool) || 0,
        description: form.description,
        startDate: new Date(form.startDate).toISOString(),
      });
      fetchTournaments();
      setCreateModal(false);
      Alert.alert('✅ Created', `${form.name} has been created`);
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.error || 'Failed to create');
    } finally { setActionLoading(false); }
  };

  const generateBrackets = async () => {
    if (!selectedT) return;
    if ((selectedT.entries?.length || 0) < 2) return Alert.alert('Error', 'Need at least 2 players to generate brackets');
    Alert.alert('Generate Brackets', `Generate brackets for ${selectedT.entries?.length} players?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Generate', onPress: async () => {
          setActionLoading(true);
          try {
            await api.post(`/api/tournaments/${selectedT.id}/brackets`);
            const res = await api.get(`/api/tournaments/${selectedT.id}`);
            setSelectedT(res.data);
            fetchTournaments();
            Alert.alert('✅ Brackets Generated!');
          } catch (err: any) {
            Alert.alert('Error', err.response?.data?.error || 'Failed');
          } finally { setActionLoading(false); }
        }
      }
    ]);
  };

  const reportResult = async (matchId: string, winnerId: string, p1Score: number, p2Score: number) => {
    setActionLoading(true);
    try {
      await api.patch(`/api/tournaments/matches/${matchId}/result`, { winnerId, player1Score: p1Score, player2Score: p2Score });
      const res = await api.get(`/api/tournaments/${selectedT.id}`);
      setSelectedT(res.data);
      fetchTournaments();
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.error || 'Failed to report result');
    } finally { setActionLoading(false); }
  };

  const STATUS_COLORS: Record<string, string> = {
    UPCOMING: COLORS.info, REGISTRATION_OPEN: COLORS.success,
    IN_PROGRESS: COLORS.gold, COMPLETED: COLORS.textMuted, CANCELLED: COLORS.error,
  };

  if (loading) return <View style={s.center}><ActivityIndicator size="large" color={COLORS.primary} /></View>;

  return (
    <View style={s.container}>
      <View style={s.header}>
        <Text style={s.title}>🏆 Tournaments</Text>
        <TouchableOpacity style={s.createBtn} onPress={() => setCreateModal(true)}>
          <Ionicons name="add" size={18} color="#000" />
          <Text style={s.createBtnTxt}>Create</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={s.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchTournaments(); }} tintColor={COLORS.primary} />}>
        {tournaments.length === 0 && (
          <View style={s.empty}><Text style={s.emptyTxt}>No tournaments yet. Create one!</Text></View>
        )}
        {tournaments.map((t: any) => (
          <TouchableOpacity key={t.id} style={s.card} onPress={() => openTournament(t)} activeOpacity={0.8}>
            <View style={s.cardTop}>
              <View style={s.cardInfo}>
                <Text style={s.cardName}>{t.name}</Text>
                <Text style={s.cardFormat}>{t.format.replace(/_/g, ' ')} · Max {t.maxPlayers}</Text>
              </View>
              <View style={[s.statusBadge, { backgroundColor: STATUS_COLORS[t.status] + '25' }]}>
                <Text style={[s.statusTxt, { color: STATUS_COLORS[t.status] }]}>{t.status.replace(/_/g, ' ')}</Text>
              </View>
            </View>
            <View style={s.cardMeta}>
              <Text style={s.cardMetaTxt}>
                👥 {t._count?.entries || 0}/{t.maxPlayers} · 📅 {new Date(t.startDate).toLocaleDateString('en-PH')}
                {t.prizePool > 0 ? ` · 🏆 ₱${t.prizePool}` : ''}
                {t.entryFee > 0 ? ` · ₱${t.entryFee} entry` : ' · Free'}
              </Text>
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Create Tournament Modal */}
      <Modal visible={createModal} animationType="slide">
        <View style={s.modal}>
          <View style={s.modalHeader}>
            <TouchableOpacity onPress={() => setCreateModal(false)}><Ionicons name="close" size={24} color={COLORS.textPrimary} /></TouchableOpacity>
            <Text style={s.modalTitle}>Create Tournament</Text>
            <View style={{ width: 24 }} />
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.modalContent}>
            <Field label="Tournament Name" value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} placeholder="e.g. Saturday Night Showdown" />

            <Text style={s.fieldLabel}>Format</Text>
            {FORMATS.map(fmt => (
              <TouchableOpacity key={fmt.key} style={[s.fmtBtn, form.format === fmt.key && s.fmtBtnActive]} onPress={() => setForm(f => ({ ...f, format: fmt.key }))}>
                <Text style={[s.fmtLabel, form.format === fmt.key && s.fmtLabelActive]}>{fmt.label}</Text>
                <Text style={s.fmtDesc}>{fmt.desc}</Text>
              </TouchableOpacity>
            ))}

            <View style={s.row}>
              <View style={{ flex: 1 }}><Field label="Max Players" value={form.maxPlayers} onChange={v => setForm(f => ({ ...f, maxPlayers: v }))} keyboardType="numeric" /></View>
              <View style={{ flex: 1 }}><Field label="Entry Fee (₱)" value={form.entryFee} onChange={v => setForm(f => ({ ...f, entryFee: v }))} keyboardType="decimal-pad" /></View>
            </View>
            <Field label="Prize Pool (₱)" value={form.prizePool} onChange={v => setForm(f => ({ ...f, prizePool: v }))} keyboardType="decimal-pad" />
            <Field label="Start Date" value={form.startDate} onChange={v => setForm(f => ({ ...f, startDate: v }))} placeholder="YYYY-MM-DDTHH:MM" />
            <Field label="Description (optional)" value={form.description} onChange={v => setForm(f => ({ ...f, description: v }))} placeholder="Tournament details..." multiline />

            <TouchableOpacity style={[s.submitBtn, actionLoading && s.submitBtnDis]} onPress={createTournament} disabled={actionLoading}>
              {actionLoading ? <ActivityIndicator color="#000" /> : <Text style={s.submitTxt}>Create Tournament</Text>}
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>

      {/* Tournament Detail Modal */}
      <Modal visible={!!selectedT} animationType="slide">
        <View style={s.modal}>
          <View style={s.modalHeader}>
            <TouchableOpacity onPress={() => setSelectedT(null)}><Ionicons name="arrow-back" size={24} color={COLORS.textPrimary} /></TouchableOpacity>
            <Text style={s.modalTitle} numberOfLines={1}>{selectedT?.name}</Text>
            <View style={{ width: 24 }} />
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.modalContent}>
            {selectedT && (
              <>
                {/* Info */}
                <View style={s.infoCard}>
                  <View style={[s.statusBadge, { backgroundColor: STATUS_COLORS[selectedT.status] + '25', alignSelf: 'flex-start' }]}>
                    <Text style={[s.statusTxt, { color: STATUS_COLORS[selectedT.status] }]}>{selectedT.status.replace(/_/g, ' ')}</Text>
                  </View>
                  <Text style={s.infoFormat}>{selectedT.format.replace(/_/g, ' ')} · {selectedT.entries?.length || 0}/{selectedT.maxPlayers} players</Text>
                  {selectedT.description && <Text style={s.infoDesc}>{selectedT.description}</Text>}
                </View>

                {/* Generate Brackets Button */}
                {(selectedT.status === 'REGISTRATION_OPEN' || selectedT.status === 'UPCOMING') && (selectedT.entries?.length || 0) >= 2 && (
                  <TouchableOpacity style={s.generateBtn} onPress={generateBrackets} disabled={actionLoading}>
                    {actionLoading ? <ActivityIndicator color="#000" /> : (
                      <><Ionicons name="git-branch-outline" size={18} color="#000" /><Text style={s.generateTxt}>Generate Brackets ({selectedT.entries?.length} players)</Text></>
                    )}
                  </TouchableOpacity>
                )}

                {/* Players */}
                <Text style={s.sectionTitle}>Players ({selectedT.entries?.length || 0})</Text>
                {selectedT.entries?.map((entry: any, i: number) => (
                  <View key={entry.id} style={s.playerRow}>
                    <Text style={s.playerIdx}>#{i + 1}</Text>
                    <Text style={s.playerName}>{entry.user?.gamifiedProfile?.displayName || `${entry.user?.firstName} ${entry.user?.lastName}`}</Text>
                    <Text style={s.playerRank}>{entry.user?.gamifiedProfile?.rank || 'Rookie'}</Text>
                  </View>
                ))}

                {/* Matches */}
                {selectedT.matches?.length > 0 && (
                  <>
                    <Text style={s.sectionTitle}>Matches</Text>
                    {[...new Set(selectedT.matches.map((m: any) => m.round))].map((round: any) => (
                      <View key={round} style={s.roundSection}>
                        <Text style={s.roundTitle}>Round {round}</Text>
                        {selectedT.matches.filter((m: any) => m.round === round).map((match: any) => {
                          const p1 = selectedT.entries?.find((e: any) => e.userId === match.player1Id);
                          const p2 = selectedT.entries?.find((e: any) => e.userId === match.player2Id);
                          const p1Name = p1?.user?.gamifiedProfile?.displayName || p1?.user?.firstName || 'TBD';
                          const p2Name = p2?.user?.gamifiedProfile?.displayName || p2?.user?.firstName || 'TBD';

                          return (
                            <View key={match.id} style={[s.matchCard, match.status === 'IN_PROGRESS' && { borderColor: COLORS.gold }]}>
                              <View style={s.matchRow}>
                                <Text style={[s.matchPlayer, match.winnerId === match.player1Id && s.matchWinner]}>{p1Name}</Text>
                                <Text style={s.matchVS}>vs</Text>
                                <Text style={[s.matchPlayer, s.matchPlayerR, match.winnerId === match.player2Id && s.matchWinner]}>{p2Name}</Text>
                              </View>

                              {match.status === 'COMPLETED' ? (
                                <Text style={s.matchResult}>
                                  {match.player1Score} – {match.player2Score} · Winner: {match.winnerId === match.player1Id ? p1Name : p2Name}
                                </Text>
                              ) : match.status === 'BYE' ? (
                                <Text style={s.matchBye}>BYE — Auto advance</Text>
                              ) : match.status === 'PENDING' && p1 && p2 ? (
                                <View style={s.matchActions}>
                                  <TouchableOpacity style={s.winBtn} onPress={() => {
                                    Alert.alert('Report Result', `Who won?`, [
                                      { text: 'Cancel', style: 'cancel' },
                                      { text: p1Name, onPress: () => reportResult(match.id, match.player1Id, 1, 0) },
                                      { text: p2Name, onPress: () => reportResult(match.id, match.player2Id, 0, 1) },
                                    ]);
                                  }}>
                                    <Ionicons name="trophy-outline" size={14} color={COLORS.gold} />
                                    <Text style={s.winBtnTxt}>Report Winner</Text>
                                  </TouchableOpacity>
                                </View>
                              ) : null}
                            </View>
                          );
                        })}
                      </View>
                    ))}
                  </>
                )}
              </>
            )}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const Field = ({ label, value, onChange, placeholder, keyboardType, multiline }: any) => (
  <View style={s.fieldGroup}>
    <Text style={s.fieldLabel}>{label}</Text>
    <TextInput
      style={[s.fieldInput, multiline && { height: 80, textAlignVertical: 'top' }]}
      value={value} onChangeText={onChange} placeholder={placeholder}
      placeholderTextColor={COLORS.textMuted} keyboardType={keyboardType || 'default'}
      multiline={multiline} autoCapitalize="none"
    />
  </View>
);

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
  cardMeta: {},
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
  fmtBtn: { backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, gap: 4, borderWidth: 1, borderColor: COLORS.surfaceBorder },
  fmtBtnActive: { borderColor: COLORS.primary, backgroundColor: COLORS.primary + '10' },
  fmtLabel: { fontSize: 14, fontWeight: '700', color: COLORS.textMuted },
  fmtLabelActive: { color: COLORS.primary },
  fmtDesc: { fontSize: 12, color: COLORS.textMuted },
  submitBtn: { backgroundColor: COLORS.primary, borderRadius: 14, height: 52, justifyContent: 'center', alignItems: 'center', marginTop: 8 },
  submitBtnDis: { opacity: 0.5 },
  submitTxt: { color: '#000', fontWeight: '800', fontSize: 16 },
  infoCard: { backgroundColor: COLORS.surface, borderRadius: 14, padding: 16, gap: 8, borderWidth: 1, borderColor: COLORS.surfaceBorder },
  infoFormat: { fontSize: 15, fontWeight: '700', color: COLORS.textPrimary },
  infoDesc: { fontSize: 13, color: COLORS.textSecondary },
  generateBtn: { backgroundColor: COLORS.primary, borderRadius: 14, height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  generateTxt: { color: '#000', fontWeight: '800', fontSize: 15 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: COLORS.textPrimary },
  playerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: COLORS.surface, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: COLORS.surfaceBorder },
  playerIdx: { fontSize: 13, color: COLORS.textMuted, width: 24 },
  playerName: { flex: 1, fontSize: 14, fontWeight: '600', color: COLORS.textPrimary },
  playerRank: { fontSize: 11, color: COLORS.textMuted },
  roundSection: { gap: 8 },
  roundTitle: { fontSize: 13, fontWeight: '700', color: COLORS.textMuted },
  matchCard: { backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, gap: 8, borderWidth: 1, borderColor: COLORS.surfaceBorder },
  matchRow: { flexDirection: 'row', alignItems: 'center' },
  matchPlayer: { flex: 1, fontSize: 14, fontWeight: '600', color: COLORS.textPrimary },
  matchPlayerR: { textAlign: 'right' },
  matchWinner: { color: COLORS.gold, fontWeight: '800' },
  matchVS: { fontSize: 11, color: COLORS.textMuted, paddingHorizontal: 10 },
  matchResult: { fontSize: 12, color: COLORS.textSecondary, textAlign: 'center' },
  matchBye: { fontSize: 12, color: COLORS.textMuted, textAlign: 'center', fontStyle: 'italic' },
  matchActions: { alignItems: 'center' },
  winBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: COLORS.gold + '20', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: COLORS.gold },
  winBtnTxt: { color: COLORS.gold, fontWeight: '700', fontSize: 13 },
});
