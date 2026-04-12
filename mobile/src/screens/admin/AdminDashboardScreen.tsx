import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  RefreshControl, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../context/AuthContext';
import { useAuth } from '../../context/AuthContext';
import { COLORS, RANK_CONFIG } from '../../constants';

export default function AdminDashboardScreen() {
  const { user } = useAuth();
  const [data, setData] = useState<any>(null);
  const [sales, setSales] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [dashRes, salesRes] = await Promise.all([
        api.get('/api/analytics/dashboard'),
        api.get('/api/analytics/sales?days=7'),
      ]);
      setData(dashRes.data);
      setSales(salesRes.data);
    } catch (err) { console.error(err); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { fetchData(); }, []);

  if (loading) return <View style={s.center}><ActivityIndicator size="large" color={COLORS.primary} /></View>;

  const summary = data?.summary || {};
  const maxRevenue = Math.max(...(sales?.dailySales?.map((d: any) => d.revenue) || [1]));

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchData(); }} tintColor={COLORS.primary} />}>

      {/* Header */}
      <View style={s.header}>
        <Text style={s.greeting}>Admin Dashboard</Text>
        <Text style={s.date}>{new Date().toLocaleDateString('en-PH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</Text>
      </View>

      {/* KPI Cards */}
      <View style={s.kpiGrid}>
        <KPICard icon="cash-outline" label="Today's Revenue" value={`₱${(summary.todayRevenue || 0).toFixed(0)}`} color={COLORS.success} sub={`${summary.todaySessions || 0} sessions + ${summary.todayOrders || 0} orders`} />
        <KPICard icon="people-outline" label="Total Members" value={summary.totalMembers || 0} color={COLORS.info} sub="Registered accounts" />
        <KPICard icon="grid-outline" label="Active Tables" value={summary.activeSessionsCount || 0} color={COLORS.error} sub="Currently playing" />
        <KPICard icon="time-outline" label="Queue" value={summary.queueCount || 0} color={COLORS.warning} sub="Currently waiting" />
      </View>

      {/* 7-Day Revenue Chart (bar chart) */}
      <View style={s.card}>
        <Text style={s.cardTitle}>7-Day Revenue</Text>
        <Text style={s.cardSub}>Total: ₱{(sales?.totalRevenue || 0).toFixed(0)} · {sales?.totalOrders || 0} POS orders</Text>
        <View style={s.barChart}>
          {(sales?.dailySales || []).map((day: any) => {
            const pct = maxRevenue > 0 ? (day.revenue / maxRevenue) : 0;
            const dayLabel = new Date(day.date).toLocaleDateString('en-PH', { weekday: 'short' });
            return (
              <View key={day.date} style={s.barItem}>
                <Text style={s.barAmt}>₱{day.revenue > 999 ? `${(day.revenue/1000).toFixed(1)}k` : day.revenue.toFixed(0)}</Text>
                <View style={s.barTrack}>
                  <View style={[s.barFill, { height: `${Math.max(4, pct * 100)}%` }]} />
                </View>
                <Text style={s.barDay}>{dayLabel}</Text>
              </View>
            );
          })}
        </View>
      </View>

      {/* Category Breakdown */}
      {sales?.categoryBreakdown?.length > 0 && (
        <View style={s.card}>
          <Text style={s.cardTitle}>POS by Category</Text>
          {sales.categoryBreakdown.map((cat: any) => {
            const pct = sales.totalRevenue > 0 ? cat.revenue / (sales?.dailySales?.reduce((s: number, d: any) => s + d.revenue, 0) || 1) : 0;
            return (
              <View key={cat.category} style={s.catRow}>
                <Text style={s.catName}>{cat.category.replace(/_/g, ' ')}</Text>
                <View style={s.catBar}>
                  <View style={[s.catBarFill, { width: `${Math.max(2, pct * 100)}%` }]} />
                </View>
                <Text style={s.catAmt}>₱{cat.revenue.toFixed(0)}</Text>
              </View>
            );
          })}
        </View>
      )}

      {/* Table Status */}
      <View style={s.card}>
        <Text style={s.cardTitle}>Table Status</Text>
        <View style={s.tableGrid}>
          {(data?.tableStatuses || []).map((table: any) => {
            const activeSession = table.sessions?.[0];
            const dur = activeSession ? Math.floor((Date.now() - new Date(activeSession.startTime).getTime()) / 60000) : 0;
            return (
              <View key={table.id} style={[s.tableCell, {
                borderColor: table.status === 'AVAILABLE' ? COLORS.success + '60' : table.status === 'OCCUPIED' ? COLORS.error + '60' : COLORS.textMuted + '40'
              }]}>
                <Text style={s.tableCellNum}>{table.type === 'VIP' ? '👑' : '🎱'} T{table.tableNumber}</Text>
                <View style={[s.tableDot, {
                  backgroundColor: table.status === 'AVAILABLE' ? COLORS.success : table.status === 'OCCUPIED' ? COLORS.error : COLORS.textMuted
                }]} />
                {activeSession && <Text style={s.tableDur}>{dur}m</Text>}
                {(table.queue?.length || 0) > 0 && <Text style={s.tableQ}>{table.queue.length}q</Text>}
              </View>
            );
          })}
        </View>
      </View>

      {/* Top Players */}
      <View style={s.card}>
        <Text style={s.cardTitle}>🏆 Top Players</Text>
        {(data?.topPlayers || []).map((gp: any, i: number) => {
          const rankCfg = RANK_CONFIG[gp.rank as keyof typeof RANK_CONFIG] || RANK_CONFIG.Rookie;
          return (
            <View key={gp.id} style={s.playerRow}>
              <Text style={s.playerRank}>#{i + 1}</Text>
              <View style={[s.playerAvatar, { backgroundColor: rankCfg.color + '20' }]}>
                <Text>{rankCfg.icon}</Text>
              </View>
              <View style={s.playerInfo}>
                <Text style={s.playerName}>{gp.displayName || `${gp.user?.firstName}`}</Text>
                <Text style={s.playerStats}>{gp.totalWins}W · {gp.totalGames}G · {gp.rank}</Text>
              </View>
              <Text style={[s.playerScore, { color: rankCfg.color }]}>{gp.totalWins} wins</Text>
            </View>
          );
        })}
        {(data?.topPlayers?.length || 0) === 0 && <Text style={s.emptyTxt}>No player data yet</Text>}
      </View>

      {/* Low Stock */}
      {(data?.lowStockProducts?.length || 0) > 0 && (
        <View style={[s.card, s.alertCard]}>
          <Text style={s.cardTitle}>⚠️ Low Stock Alert</Text>
          {data.lowStockProducts.map((p: any) => (
            <View key={p.id} style={s.lowStockRow}>
              <Text style={s.lowStockName}>{p.name}</Text>
              <Text style={s.lowStockCount}>{p.stock} left</Text>
            </View>
          ))}
        </View>
      )}

      {/* Recent Transactions */}
      <View style={s.card}>
        <Text style={s.cardTitle}>Recent Transactions</Text>
        {(data?.recentTransactions || []).map((tx: any) => (
          <View key={tx.id} style={s.txRow}>
            <View style={[s.txIcon, { backgroundColor: tx.type === 'TOPUP' ? COLORS.success + '20' : COLORS.error + '20' }]}>
              <Ionicons name={tx.type === 'TOPUP' ? 'add' : 'remove'} size={14} color={tx.type === 'TOPUP' ? COLORS.success : COLORS.error} />
            </View>
            <View style={s.txInfo}>
              <Text style={s.txUser}>{tx.user?.firstName} {tx.user?.lastName}</Text>
              <Text style={s.txDesc}>{tx.description}</Text>
            </View>
            <Text style={[s.txAmt, { color: tx.type === 'TOPUP' ? COLORS.success : COLORS.error }]}>
              {tx.type === 'TOPUP' ? '+' : '-'}{tx.amount.toFixed(0)}
            </Text>
          </View>
        ))}
        {(data?.recentTransactions?.length || 0) === 0 && <Text style={s.emptyTxt}>No recent transactions</Text>}
      </View>
    </ScrollView>
  );
}

const KPICard = ({ icon, label, value, color, sub }: any) => (
  <View style={[s.kpiCard, { borderColor: color + '40' }]}>
    <View style={[s.kpiIcon, { backgroundColor: color + '20' }]}>
      <Ionicons name={icon} size={22} color={color} />
    </View>
    <Text style={[s.kpiValue, { color }]}>{value}</Text>
    <Text style={s.kpiLabel}>{label}</Text>
    {sub && <Text style={s.kpiSub}>{sub}</Text>}
  </View>
);

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background },
  content: { padding: 20, paddingTop: 60, paddingBottom: 40, gap: 16 },
  header: { marginBottom: 4 },
  greeting: { fontSize: 26, fontWeight: '900', color: COLORS.textPrimary },
  date: { fontSize: 13, color: COLORS.textSecondary, marginTop: 2 },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  kpiCard: { flex: 1, minWidth: '47%', backgroundColor: COLORS.surface, borderRadius: 16, padding: 16, gap: 4, borderWidth: 1 },
  kpiIcon: { width: 40, height: 40, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginBottom: 4 },
  kpiValue: { fontSize: 26, fontWeight: '900' },
  kpiLabel: { fontSize: 12, fontWeight: '700', color: COLORS.textSecondary },
  kpiSub: { fontSize: 10, color: COLORS.textMuted },
  card: { backgroundColor: COLORS.surface, borderRadius: 16, padding: 16, gap: 12, borderWidth: 1, borderColor: COLORS.surfaceBorder },
  alertCard: { borderColor: COLORS.warning + '50' },
  cardTitle: { fontSize: 16, fontWeight: '800', color: COLORS.textPrimary },
  cardSub: { fontSize: 12, color: COLORS.textMuted, marginTop: -6 },
  barChart: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: 120 },
  barItem: { flex: 1, alignItems: 'center', gap: 4, height: '100%', justifyContent: 'flex-end' },
  barAmt: { fontSize: 8, color: COLORS.textMuted, textAlign: 'center' },
  barTrack: { flex: 1, width: '100%', justifyContent: 'flex-end', maxHeight: 80 },
  barFill: { width: '100%', backgroundColor: COLORS.primary, borderRadius: 4 },
  barDay: { fontSize: 9, color: COLORS.textMuted, fontWeight: '700' },
  catRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  catName: { fontSize: 11, color: COLORS.textSecondary, width: 80 },
  catBar: { flex: 1, height: 8, backgroundColor: COLORS.surfaceLight, borderRadius: 4, overflow: 'hidden' },
  catBarFill: { height: '100%', backgroundColor: COLORS.primary, borderRadius: 4 },
  catAmt: { fontSize: 11, fontWeight: '700', color: COLORS.textPrimary, width: 50, textAlign: 'right' },
  tableGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tableCell: { width: '18%', backgroundColor: COLORS.surfaceLight, borderRadius: 10, padding: 8, alignItems: 'center', gap: 3, borderWidth: 1 },
  tableCellNum: { fontSize: 10, fontWeight: '700', color: COLORS.textPrimary },
  tableDot: { width: 8, height: 8, borderRadius: 4 },
  tableDur: { fontSize: 9, color: COLORS.warning },
  tableQ: { fontSize: 9, color: COLORS.info },
  playerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  playerRank: { fontSize: 14, fontWeight: '800', color: COLORS.textMuted, width: 28 },
  playerAvatar: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },
  playerInfo: { flex: 1 },
  playerName: { fontSize: 14, fontWeight: '700', color: COLORS.textPrimary },
  playerStats: { fontSize: 11, color: COLORS.textMuted },
  playerScore: { fontSize: 14, fontWeight: '800' },
  lowStockRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: COLORS.surfaceBorder },
  lowStockName: { fontSize: 14, color: COLORS.textPrimary },
  lowStockCount: { fontSize: 14, fontWeight: '700', color: COLORS.warning },
  txRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  txIcon: { width: 32, height: 32, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  txInfo: { flex: 1 },
  txUser: { fontSize: 13, fontWeight: '700', color: COLORS.textPrimary },
  txDesc: { fontSize: 11, color: COLORS.textMuted },
  txAmt: { fontSize: 14, fontWeight: '800' },
  emptyTxt: { fontSize: 13, color: COLORS.textMuted, textAlign: 'center', paddingVertical: 8 },
});
