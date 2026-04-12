import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  RefreshControl, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../context/AuthContext';
import { COLORS } from '../../constants';

export default function ReportsScreen() {
  const [period, setPeriod] = useState<7 | 14 | 30>(7);
  const [sales, setSales] = useState<any>(null);
  const [daily, setDaily] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [salesRes, dailyRes] = await Promise.all([
        api.get(`/api/analytics/sales?days=${period}`),
        api.get('/api/staff/daily-report'),
      ]);
      setSales(salesRes.data);
      setDaily(dailyRes.data);
    } catch (err) { console.error(err); }
    finally { setLoading(false); setRefreshing(false); }
  }, [period]);

  useEffect(() => { setLoading(true); fetchData(); }, [period]);

  if (loading) return <View style={s.center}><ActivityIndicator size="large" color={COLORS.primary} /></View>;

  const maxRev = Math.max(...(sales?.dailySales?.map((d: any) => d.revenue) || [1]), 1);

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchData(); }} tintColor={COLORS.primary} />}>

      <View style={s.header}>
        <Text style={s.title}>📊 Reports</Text>
        <Text style={s.subtitle}>Business analytics & insights</Text>
      </View>

      {/* Today's Summary */}
      <View style={s.todayCard}>
        <Text style={s.todayTitle}>Today — {new Date().toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric' })}</Text>
        <View style={s.todayGrid}>
          <TodayStat icon="cash-outline" label="Total Revenue" value={`₱${(daily?.totalRevenue || 0).toFixed(0)}`} color={COLORS.success} />
          <TodayStat icon="grid-outline" label="Table Revenue" value={`₱${(daily?.tableRevenue || 0).toFixed(0)}`} color={COLORS.primary} />
          <TodayStat icon="cart-outline" label="POS Revenue" value={`₱${(daily?.posRevenue || 0).toFixed(0)}`} color={COLORS.info} />
          <TodayStat icon="wallet-outline" label="Credits Sold" value={`₱${(daily?.creditsToppedup || 0).toFixed(0)}`} color={COLORS.gold} />
          <TodayStat icon="play-outline" label="Sessions" value={daily?.sessionsCount || 0} color={COLORS.rankShark} />
          <TodayStat icon="receipt-outline" label="POS Orders" value={daily?.ordersCount || 0} color={COLORS.rankElite} />
          <TodayStat icon="people-outline" label="New Members" value={daily?.newMembersCount || 0} color={COLORS.success} />
          <TodayStat icon="time-outline" label="Queue Today" value={daily?.queueEntries || 0} color={COLORS.warning} />
        </View>
      </View>

      {/* Top Sellers Today */}
      {daily?.topSellingItems?.length > 0 && (
        <View style={s.card}>
          <Text style={s.cardTitle}>🔥 Top Selling Today</Text>
          {daily.topSellingItems.map(([name, qty]: [string, number], i: number) => (
            <View key={name} style={s.topItem}>
              <Text style={s.topItemRank}>#{i + 1}</Text>
              <Text style={s.topItemName}>{name}</Text>
              <Text style={s.topItemQty}>{qty} sold</Text>
            </View>
          ))}
        </View>
      )}

      {/* Period Selector */}
      <View style={s.periodRow}>
        {([7, 14, 30] as const).map(p => (
          <TouchableOpacity key={p} style={[s.periodBtn, period === p && s.periodBtnActive]} onPress={() => setPeriod(p)}>
            <Text style={[s.periodTxt, period === p && s.periodTxtActive]}>{p} Days</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Revenue Chart */}
      <View style={s.card}>
        <Text style={s.cardTitle}>Revenue — Last {period} Days</Text>
        <Text style={s.cardSub}>Total: ₱{(sales?.totalRevenue || 0).toFixed(0)} · {sales?.totalOrders || 0} orders</Text>
        <View style={s.barChart}>
          {(sales?.dailySales || []).map((day: any, i: number) => {
            const pct = day.revenue / maxRev;
            const label = new Date(day.date).toLocaleDateString('en-PH', { month: 'numeric', day: 'numeric' });
            const isToday = day.date === new Date().toISOString().split('T')[0];
            return (
              <View key={day.date} style={s.barCol}>
                <Text style={s.barAmt}>{day.revenue > 0 ? `${day.revenue > 999 ? `${(day.revenue/1000).toFixed(1)}k` : day.revenue.toFixed(0)}` : ''}</Text>
                <View style={s.barTrack}>
                  <View style={[s.barFill, { height: `${Math.max(2, pct * 100)}%`, backgroundColor: isToday ? COLORS.primary : COLORS.primary + '70' }]} />
                </View>
                <Text style={[s.barLabel, isToday && { color: COLORS.primary, fontWeight: '800' }]}>{label}</Text>
              </View>
            );
          })}
        </View>
      </View>

      {/* Category Breakdown */}
      <View style={s.card}>
        <Text style={s.cardTitle}>Sales by Category</Text>
        {(sales?.categoryBreakdown || []).length === 0 ? (
          <Text style={s.emptyTxt}>No POS data for this period</Text>
        ) : (
          (sales?.categoryBreakdown || [])
            .sort((a: any, b: any) => b.revenue - a.revenue)
            .map((cat: any) => {
              const pct = sales.totalRevenue > 0 ? cat.revenue / (sales?.categoryBreakdown?.reduce((s: number, c: any) => s + c.revenue, 0) || 1) : 0;
              return (
                <View key={cat.category} style={s.catRow}>
                  <Text style={s.catName}>{cat.category.replace(/_/g, ' ')}</Text>
                  <View style={s.catBarTrack}>
                    <View style={[s.catBarFill, { width: `${Math.max(2, pct * 100)}%` }]} />
                  </View>
                  <View style={s.catRight}>
                    <Text style={s.catAmt}>₱{cat.revenue.toFixed(0)}</Text>
                    <Text style={s.catQty}>{cat.quantity} sold</Text>
                  </View>
                </View>
              );
            })
        )}
      </View>

      {/* Daily Breakdown Table */}
      <View style={s.card}>
        <Text style={s.cardTitle}>Daily Breakdown</Text>
        <View style={s.tableHead}>
          <Text style={[s.tableCell, s.tableHeadTxt]}>Date</Text>
          <Text style={[s.tableCell, s.tableHeadTxt, { textAlign: 'right' }]}>Revenue</Text>
          <Text style={[s.tableCell, s.tableHeadTxt, { textAlign: 'right' }]}>Orders</Text>
        </View>
        {(sales?.dailySales || []).slice().reverse().map((day: any) => {
          const isToday = day.date === new Date().toISOString().split('T')[0];
          return (
            <View key={day.date} style={[s.tableRow, isToday && s.tableRowToday]}>
              <Text style={[s.tableCell, isToday && { color: COLORS.primary, fontWeight: '700' }]}>
                {new Date(day.date).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', weekday: 'short' })}
                {isToday ? ' (Today)' : ''}
              </Text>
              <Text style={[s.tableCell, { textAlign: 'right', color: day.revenue > 0 ? COLORS.success : COLORS.textMuted, fontWeight: '700' }]}>
                ₱{day.revenue.toFixed(0)}
              </Text>
              <Text style={[s.tableCell, { textAlign: 'right', color: COLORS.textSecondary }]}>{day.orders}</Text>
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

const TodayStat = ({ icon, label, value, color }: any) => (
  <View style={[s.todayStat, { borderColor: color + '35' }]}>
    <Ionicons name={icon} size={18} color={color} />
    <Text style={[s.todayStatVal, { color }]}>{value}</Text>
    <Text style={s.todayStatLbl}>{label}</Text>
  </View>
);

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background },
  content: { paddingBottom: 40 },
  header: { paddingTop: 60, paddingHorizontal: 20, paddingBottom: 14, backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.surfaceBorder },
  title: { fontSize: 22, fontWeight: '800', color: COLORS.textPrimary },
  subtitle: { fontSize: 13, color: COLORS.textSecondary },
  todayCard: { margin: 16, backgroundColor: COLORS.surface, borderRadius: 18, padding: 16, gap: 14, borderWidth: 1, borderColor: COLORS.surfaceBorder },
  todayTitle: { fontSize: 14, fontWeight: '700', color: COLORS.textSecondary },
  todayGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  todayStat: { width: '47%', backgroundColor: COLORS.surfaceLight, borderRadius: 12, padding: 12, gap: 4, borderWidth: 1 },
  todayStatVal: { fontSize: 22, fontWeight: '900' },
  todayStatLbl: { fontSize: 10, color: COLORS.textMuted },
  card: { marginHorizontal: 16, marginBottom: 16, backgroundColor: COLORS.surface, borderRadius: 18, padding: 16, gap: 12, borderWidth: 1, borderColor: COLORS.surfaceBorder },
  cardTitle: { fontSize: 16, fontWeight: '800', color: COLORS.textPrimary },
  cardSub: { fontSize: 12, color: COLORS.textMuted, marginTop: -6 },
  topItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: COLORS.surfaceBorder },
  topItemRank: { fontSize: 14, fontWeight: '800', color: COLORS.textMuted, width: 28 },
  topItemName: { flex: 1, fontSize: 14, color: COLORS.textPrimary },
  topItemQty: { fontSize: 13, fontWeight: '700', color: COLORS.primary },
  periodRow: { flexDirection: 'row', gap: 8, marginHorizontal: 16, marginBottom: 16 },
  periodBtn: { flex: 1, backgroundColor: COLORS.surface, borderRadius: 10, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: COLORS.surfaceBorder },
  periodBtnActive: { backgroundColor: COLORS.primary + '20', borderColor: COLORS.primary },
  periodTxt: { fontSize: 13, fontWeight: '700', color: COLORS.textMuted },
  periodTxtActive: { color: COLORS.primary },
  barChart: { flexDirection: 'row', alignItems: 'flex-end', height: 140, gap: 3 },
  barCol: { flex: 1, alignItems: 'center', gap: 3, height: '100%', justifyContent: 'flex-end' },
  barAmt: { fontSize: 7, color: COLORS.textMuted, textAlign: 'center' },
  barTrack: { flex: 1, width: '100%', justifyContent: 'flex-end', maxHeight: 90 },
  barFill: { width: '100%', borderRadius: 3 },
  barLabel: { fontSize: 8, color: COLORS.textMuted },
  catRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  catName: { fontSize: 11, color: COLORS.textSecondary, width: 76 },
  catBarTrack: { flex: 1, height: 10, backgroundColor: COLORS.surfaceLight, borderRadius: 5, overflow: 'hidden' },
  catBarFill: { height: '100%', backgroundColor: COLORS.primary, borderRadius: 5 },
  catRight: { width: 64, alignItems: 'flex-end' },
  catAmt: { fontSize: 11, fontWeight: '700', color: COLORS.textPrimary },
  catQty: { fontSize: 9, color: COLORS.textMuted },
  tableHead: { flexDirection: 'row', paddingBottom: 8, borderBottomWidth: 2, borderBottomColor: COLORS.surfaceBorder },
  tableHeadTxt: { color: COLORS.textMuted, fontWeight: '700', fontSize: 11 },
  tableRow: { flexDirection: 'row', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: COLORS.surfaceBorder },
  tableRowToday: { backgroundColor: COLORS.primary + '08' },
  tableCell: { flex: 1, fontSize: 13, color: COLORS.textSecondary },
  emptyTxt: { fontSize: 13, color: COLORS.textMuted, textAlign: 'center', padding: 16 },
});
