import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, RefreshControl, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../context/AuthContext';
import { COLORS } from '../../constants';

export default function CameraScoringScreen() {
  const [tables, setTables] = useState<any[]>([]);
  const [tableId, setTableId] = useState('');
  const [player1Name, setPlayer1Name] = useState('');
  const [player2Name, setPlayer2Name] = useState('');
  const [activeGame, setActiveGame] = useState<any>(null);
  const [readings, setReadings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [ending, setEnding] = useState(false);

  const loadTables = useCallback(async () => {
    try {
      const response = await api.get('/api/tables');
      const availableTables = Array.isArray(response.data) ? response.data : [];
      setTables(availableTables);
      setTableId(current => current || availableTables[0]?.id || '');
    } catch (error: any) {
      Alert.alert('Could not load tables', error.response?.data?.error || 'Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadLiveGame = useCallback(async (showError = false) => {
    if (!tableId) return;
    try {
      const response = await api.get(`/api/sensor/table/${tableId}/live`);
      setActiveGame(response.data?.activeGame || null);
      setReadings(Array.isArray(response.data?.readings) ? response.data.readings : []);
    } catch (error: any) {
      if (showError) Alert.alert('Could not load camera scoring', error.response?.data?.error || 'Please try again.');
    } finally {
      setRefreshing(false);
    }
  }, [tableId]);

  useEffect(() => { loadTables(); }, [loadTables]);
  useEffect(() => {
    loadLiveGame();
    const timer = setInterval(() => loadLiveGame(), 3000);
    return () => clearInterval(timer);
  }, [loadLiveGame]);

  const startGame = async () => {
    if (!tableId || !player1Name.trim() || !player2Name.trim()) {
      return Alert.alert('Missing details', 'Select a table and enter both player names.');
    }
    setStarting(true);
    try {
      const response = await api.post('/api/sensor/game/start', {
        tableId,
        player1Name: player1Name.trim(),
        player2Name: player2Name.trim(),
        gameType: '8-BALL',
      });
      setActiveGame(response.data);
      setReadings([]);
      Alert.alert('Camera scoring ready', 'Start the configured GPU camera bridge, then press Lock In. It will discover this active session automatically.');
    } catch (error: any) {
      Alert.alert('Could not start game', error.response?.data?.error || 'Please try again.');
    } finally {
      setStarting(false);
    }
  };

  const endGame = () => {
    if (!activeGame?.sessionId || ending) return;
    Alert.alert(
      'End camera game?',
      'This stops accepting new camera events for the current session.',
      [
        { text: 'Keep Playing', style: 'cancel' },
        {
          text: 'End Game',
          style: 'destructive',
          onPress: async () => {
            setEnding(true);
            try {
              await api.patch(`/api/sensor/game/${activeGame.sessionId}/end`, {});
              setActiveGame(null);
              setReadings([]);
            } catch (error: any) {
              Alert.alert('Could not end game', error.response?.data?.error || 'Please try again.');
            } finally {
              setEnding(false);
            }
          },
        },
      ],
    );
  };

  const balls = Array.isArray(activeGame?.ballsPotted) ? activeGame.ballsPotted : [];
  const count = (label: string) => balls.filter((ball: any) => ball?.ballColor === label).length;

  if (loading) return <View style={s.center}><ActivityIndicator size="large" color={COLORS.gold} /></View>;

  return (
    <ScrollView
      style={s.container}
      contentContainerStyle={s.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadLiveGame(true); }} tintColor={COLORS.gold} />}
    >
      <Text style={s.title}>Camera Scoring</Text>
      <Text style={s.subtitle}>Start a game, then connect the pool-scoring GUI using the identifiers below.</Text>

      <View style={s.card}>
        <Text style={s.cardTitle}>1. Select table</Text>
        <View style={s.tableGrid}>
          {tables.map(table => (
            <TouchableOpacity
              key={table.id}
              style={[s.tableButton, tableId === table.id && s.tableButtonActive]}
              onPress={() => setTableId(table.id)}
            >
              <Text style={[s.tableText, tableId === table.id && s.tableTextActive]}>{table.name || `Table ${table.number || ''}`}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={s.card}>
        <Text style={s.cardTitle}>2. Enter players</Text>
        <TextInput style={s.input} value={player1Name} onChangeText={setPlayer1Name} placeholder="Player 1" placeholderTextColor={COLORS.textMuted} />
        <TextInput style={s.input} value={player2Name} onChangeText={setPlayer2Name} placeholder="Player 2" placeholderTextColor={COLORS.textMuted} />
        <TouchableOpacity style={[s.startButton, starting && s.disabled]} onPress={startGame} disabled={starting}>
          {starting ? <ActivityIndicator color="#000" /> : <><Ionicons name="videocam-outline" size={18} color="#000" /><Text style={s.startText}>Start Camera Game</Text></>}
        </TouchableOpacity>
      </View>

      {activeGame && (
        <View style={s.card}>
          <View style={s.liveHeader}>
            <Text style={s.cardTitle}>3. Connect camera</Text>
            <Text style={s.liveBadge}>LIVE</Text>
          </View>
          <Text style={s.label}>Table ID</Text>
          <Text selectable style={s.identifier}>{activeGame.tableId}</Text>
          <Text style={s.label}>Session ID</Text>
          <Text selectable style={s.identifier}>{activeGame.sessionId}</Text>
          <Text style={s.help}>The camera computer is configured once for this table. It securely discovers this active session when its GPU GUI starts—no session ID or sensor key is entered in Gradio.</Text>

          <View style={s.counterRow}>
            {[
              ['Solid', count('solid')], ['Stripe', count('stripe')],
              ['Eight', count('eight')], ['Cue', count('cue')],
            ].map(([label, value]) => (
              <View key={String(label)} style={s.counter}>
                <Text style={s.counterValue}>{value}</Text>
                <Text style={s.counterLabel}>{label}</Text>
              </View>
            ))}
          </View>
          <Text style={s.accepted}>{balls.length} accepted event{balls.length === 1 ? '' : 's'} · {readings.length} recent reading{readings.length === 1 ? '' : 's'}</Text>
          <Text style={s.warning}>The camera identifies ball type and pocket only. Staff still confirms player scores and the winner because ownership and turns cannot be inferred safely from the video.</Text>
          <TouchableOpacity style={[s.endButton, ending && s.disabled]} onPress={endGame} disabled={ending}>
            {ending ? <ActivityIndicator color={COLORS.error} /> : <Text style={s.endText}>End Camera Game</Text>}
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: 18, paddingTop: 60, paddingBottom: 100, gap: 14 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.background },
  title: { color: COLORS.textPrimary, fontSize: 27, fontWeight: '900' },
  subtitle: { color: COLORS.textSecondary, lineHeight: 20 },
  card: { backgroundColor: COLORS.surface, borderRadius: 16, borderWidth: 1, borderColor: COLORS.surfaceBorder, padding: 16, gap: 10 },
  cardTitle: { color: COLORS.textPrimary, fontSize: 16, fontWeight: '800' },
  tableGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tableButton: { borderWidth: 1, borderColor: COLORS.surfaceBorder, backgroundColor: COLORS.surfaceLight, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9 },
  tableButtonActive: { borderColor: COLORS.gold, backgroundColor: COLORS.gold + '20' },
  tableText: { color: COLORS.textSecondary, fontWeight: '700' },
  tableTextActive: { color: COLORS.gold },
  input: { height: 46, borderRadius: 10, paddingHorizontal: 13, color: COLORS.textPrimary, backgroundColor: COLORS.surfaceLight, borderWidth: 1, borderColor: COLORS.surfaceBorder },
  startButton: { height: 48, borderRadius: 12, backgroundColor: COLORS.gold, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' },
  startText: { color: '#000', fontWeight: '900' },
  disabled: { opacity: 0.55 },
  liveHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  liveBadge: { color: COLORS.success, fontSize: 11, fontWeight: '900' },
  label: { color: COLORS.textMuted, fontSize: 11, textTransform: 'uppercase', marginTop: 3 },
  identifier: { color: COLORS.primary, fontSize: 12, fontWeight: '700', backgroundColor: COLORS.background, borderRadius: 8, padding: 10 },
  help: { color: COLORS.textSecondary, fontSize: 12, lineHeight: 18 },
  counterRow: { flexDirection: 'row', gap: 7 },
  counter: { flex: 1, minWidth: 0, alignItems: 'center', backgroundColor: COLORS.surfaceLight, borderRadius: 10, paddingVertical: 10 },
  counterValue: { color: COLORS.primary, fontSize: 20, fontWeight: '900' },
  counterLabel: { color: COLORS.textMuted, fontSize: 10 },
  accepted: { color: COLORS.textSecondary, textAlign: 'center', fontSize: 12 },
  warning: { color: COLORS.warning, fontSize: 11, lineHeight: 16 },
  endButton: { height: 44, borderRadius: 11, borderWidth: 1, borderColor: COLORS.error, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  endText: { color: COLORS.error, fontWeight: '800' },
});
