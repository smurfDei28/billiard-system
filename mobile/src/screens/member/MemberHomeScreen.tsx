import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet,
  TouchableOpacity, RefreshControl, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../context/AuthContext';
import { COLORS, RANK_CONFIG, MEMBERSHIP_PLANS } from '../../constants';

export default function MemberHomeScreen({ navigation }: any) {
  const { user, refreshUser } = useAuth();
  const [membership, setMembership] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [tables, setTables] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [profileRes, notifRes, tablesRes] = await Promise.all([
        api.get('/api/auth/me'),
        api.get('/api/notifications'),
        api.get('/api/tables'),
      ]);
      setMembership(profileRes.data.membership);
      setProfile(profileRes.data.gamifiedProfile);
      setNotifications(notifRes.data.filter((n: any) => !n.isRead).slice(0, 3));
      setTables(tablesRes.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, []);

  const onRefresh = () => { setRefreshing(true); fetchData(); };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  const rank = profile?.rank || 'Rookie';
  const rankConfig = RANK_CONFIG[rank as keyof typeof RANK_CONFIG] || RANK_CONFIG.Rookie;
  const plan = membership?.plan || 'BASIC';
  const planConfig = MEMBERSHIP_PLANS[plan as keyof typeof MEMBERSHIP_PLANS];
  const xpToNext = (profile?.level || 1) * 100;
  const xpProgress = ((profile?.xp || 0) % 100) / 100;
  const availableTables = tables.filter((t: any) => t.status === 'AVAILABLE').length;
  const unreadCount = notifications.length;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
    >
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Good {getTimeOfDay()},</Text>
          <Text style={styles.name}>{user?.firstName} {user?.lastName}</Text>
        </View>
        <TouchableOpacity style={styles.notifBtn}>
          <Ionicons name="notifications-outline" size={22} color={COLORS.textPrimary} />
          {unreadCount > 0 && (
            <View style={styles.notifBadge}>
              <Text style={styles.notifBadgeText}>{unreadCount}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {/* Gamified Profile Card */}
      <View style={[styles.profileCard, { borderColor: rankConfig.color + '60' }]}>
        <View style={styles.profileTop}>
          <View style={[styles.avatar, { backgroundColor: rankConfig.color + '20', borderColor: rankConfig.color }]}>
            <Text style={styles.avatarText}>{rankConfig.icon}</Text>
          </View>
          <View style={styles.profileInfo}>
            <Text style={styles.displayName}>{profile?.displayName || `${user?.firstName}`}</Text>
            <View style={[styles.rankBadge, { backgroundColor: rankConfig.color + '20' }]}>
              <Text style={[styles.rankText, { color: rankConfig.color }]}>{rank}</Text>
            </View>
            <Text style={styles.levelText}>Level {profile?.level || 1}</Text>
          </View>
          <View style={styles.profileStats}>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{profile?.totalWins || 0}</Text>
              <Text style={styles.statLabel}>Wins</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{profile?.totalGames || 0}</Text>
              <Text style={styles.statLabel}>Games</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{profile?.winStreak || 0}</Text>
              <Text style={styles.statLabel}>Streak</Text>
            </View>
          </View>
        </View>

        {/* XP Bar */}
        <View style={styles.xpSection}>
          <View style={styles.xpRow}>
            <Text style={styles.xpLabel}>XP Progress</Text>
            <Text style={styles.xpValue}>{profile?.xp || 0} / {xpToNext} XP</Text>
          </View>
          <View style={styles.xpBar}>
            <View style={[styles.xpFill, { width: `${xpProgress * 100}%`, backgroundColor: rankConfig.color }]} />
          </View>
        </View>
      </View>

      {/* Credits Card */}
      <View style={styles.creditsCard}>
        <View style={styles.creditsLeft}>
          <Ionicons name="wallet-outline" size={24} color={COLORS.primary} />
          <View>
            <Text style={styles.creditsLabel}>Available Credits</Text>
            <Text style={styles.creditsValue}>{membership?.creditBalance?.toFixed(0) || 0}</Text>
            <Text style={styles.creditsSubLabel}>≈ {Math.floor((membership?.creditBalance || 0) / 60)}h {Math.round((membership?.creditBalance || 0) % 60)}m playtime</Text>
          </View>
        </View>
        <View style={[styles.planBadge, { backgroundColor: planConfig?.color + '20' }]}>
          <Text style={styles.planIcon}>{planConfig?.icon}</Text>
          <Text style={[styles.planLabel, { color: planConfig?.color }]}>{planConfig?.label}</Text>
        </View>
      </View>

      {/* Table Status */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Table Availability</Text>
        <Text style={styles.sectionSub}>{availableTables} of {tables.length} available</Text>
      </View>

      <ScrollView keyboardShouldPersistTaps="handled" horizontal showsHorizontalScrollIndicator={false} style={styles.tablesScroll}>
        {tables.map((table: any) => (
          <View
            key={table.id}
            style={[
              styles.tableCard,
              table.status === 'AVAILABLE' && styles.tableAvailable,
              table.status === 'OCCUPIED' && styles.tableOccupied,
              table.status === 'MAINTENANCE' && styles.tableMaintenance,
            ]}
          >
            <Text style={styles.tableNumber}>Table {table.tableNumber}</Text>
            <Text style={styles.tableType}>{table.type === 'VIP' ? '👑 VIP' : '🎱 Standard'}</Text>
            <View style={[styles.tableStatusDot, {
              backgroundColor: table.status === 'AVAILABLE' ? COLORS.success :
                table.status === 'OCCUPIED' ? COLORS.error : COLORS.warning
            }]} />
            <Text style={styles.tableStatusText}>{table.status}</Text>
            <Text style={styles.tableRate}>₱{table.ratePerHour}/hr</Text>
            {table.queue?.length > 0 && (
              <Text style={styles.tableQueue}>{table.queue.length} waiting</Text>
            )}
          </View>
        ))}
      </ScrollView>

      {/* Quick Actions */}
      <Text style={styles.sectionTitle}>Quick Actions</Text>
      <View style={styles.quickActions}>
        <QuickAction icon="trophy-outline" label="Tournaments" color={COLORS.gold} onPress={() => {}} />
        <QuickAction icon="time-outline" label="Join Queue" color={COLORS.primary} onPress={() => {}} />
        <QuickAction icon="star-outline" label="My Loyalty" color={COLORS.rankElite} onPress={() => {}} />
        <QuickAction icon="person-outline" label="Profile" color={COLORS.info} onPress={() => {}} />
      </View>

      {/* Notifications */}
      {notifications.length > 0 && (
        <>
          <Text style={[styles.sectionTitle, { marginTop: 8 }]}>Recent Notifications</Text>
          {notifications.map((n: any) => (
            <View key={n.id} style={styles.notifCard}>
              <Text style={styles.notifTitle}>{n.title}</Text>
              <Text style={styles.notifMsg}>{n.message}</Text>
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}

const QuickAction = ({ icon, label, color, onPress }: any) => (
  <TouchableOpacity style={[styles.quickAction, { borderColor: color + '40' }]} onPress={onPress}>
    <Ionicons name={icon} size={24} color={color} />
    <Text style={[styles.quickActionLabel, { color }]}>{label}</Text>
  </TouchableOpacity>
);

const getTimeOfDay = () => {
  const h = new Date().getHours();
  if (h < 12) return 'morning';
  if (h < 18) return 'afternoon';
  return 'evening';
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: 20, paddingTop: 60, paddingBottom: 32 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 },
  greeting: { fontSize: 14, color: COLORS.textSecondary },
  name: { fontSize: 22, fontWeight: '800', color: COLORS.textPrimary },
  notifBtn: { position: 'relative', padding: 4 },
  notifBadge: {
    position: 'absolute', top: 0, right: 0,
    backgroundColor: COLORS.error, borderRadius: 8,
    width: 16, height: 16, justifyContent: 'center', alignItems: 'center',
  },
  notifBadgeText: { fontSize: 10, color: '#fff', fontWeight: '700' },
  profileCard: {
    backgroundColor: COLORS.surface, borderRadius: 16,
    padding: 16, marginBottom: 16,
    borderWidth: 1,
  },
  profileTop: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  avatar: {
    width: 56, height: 56, borderRadius: 28,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 2,
  },
  avatarText: { fontSize: 24 },
  profileInfo: { flex: 1, gap: 4 },
  displayName: { fontSize: 16, fontWeight: '700', color: COLORS.textPrimary },
  rankBadge: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  rankText: { fontSize: 11, fontWeight: '700' },
  levelText: { fontSize: 12, color: COLORS.textMuted },
  profileStats: { flexDirection: 'row', gap: 12 },
  statItem: { alignItems: 'center' },
  statValue: { fontSize: 16, fontWeight: '800', color: COLORS.textPrimary },
  statLabel: { fontSize: 10, color: COLORS.textMuted },
  xpSection: { gap: 6 },
  xpRow: { flexDirection: 'row', justifyContent: 'space-between' },
  xpLabel: { fontSize: 12, color: COLORS.textMuted },
  xpValue: { fontSize: 12, color: COLORS.textSecondary },
  xpBar: { height: 6, backgroundColor: COLORS.surfaceLight, borderRadius: 3, overflow: 'hidden' },
  xpFill: { height: '100%', borderRadius: 3 },
  creditsCard: {
    backgroundColor: COLORS.surface, borderRadius: 16,
    padding: 16, marginBottom: 20,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderWidth: 1, borderColor: COLORS.primary + '30',
  },
  creditsLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  creditsLabel: { fontSize: 12, color: COLORS.textMuted },
  creditsValue: { fontSize: 28, fontWeight: '800', color: COLORS.primary },
  creditsSubLabel: { fontSize: 11, color: COLORS.textMuted },
  planBadge: { alignItems: 'center', padding: 8, borderRadius: 10, gap: 2 },
  planIcon: { fontSize: 18 },
  planLabel: { fontSize: 10, fontWeight: '700' },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: COLORS.textPrimary, marginBottom: 12 },
  sectionSub: { fontSize: 12, color: COLORS.textMuted },
  tablesScroll: { marginHorizontal: -20, paddingHorizontal: 20, marginBottom: 20 },
  tableCard: {
    backgroundColor: COLORS.surface, borderRadius: 12,
    padding: 14, marginRight: 10, width: 130,
    borderWidth: 1, borderColor: COLORS.surfaceBorder,
    alignItems: 'center', gap: 4,
  },
  tableAvailable: { borderColor: COLORS.success + '60' },
  tableOccupied: { borderColor: COLORS.error + '60' },
  tableMaintenance: { borderColor: COLORS.warning + '60' },
  tableNumber: { fontSize: 15, fontWeight: '700', color: COLORS.textPrimary },
  tableType: { fontSize: 11, color: COLORS.textSecondary },
  tableStatusDot: { width: 8, height: 8, borderRadius: 4 },
  tableStatusText: { fontSize: 11, color: COLORS.textMuted },
  tableRate: { fontSize: 12, color: COLORS.primary, fontWeight: '600' },
  tableQueue: { fontSize: 10, color: COLORS.warning },
  quickActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 },
  quickAction: {
    flex: 1, minWidth: '45%',
    backgroundColor: COLORS.surface,
    borderRadius: 12, padding: 16,
    alignItems: 'center', gap: 8,
    borderWidth: 1,
  },
  quickActionLabel: { fontSize: 12, fontWeight: '600' },
  notifCard: {
    backgroundColor: COLORS.surface, borderRadius: 12,
    padding: 14, marginBottom: 8,
    borderWidth: 1, borderColor: COLORS.surfaceBorder,
  },
  notifTitle: { fontSize: 14, fontWeight: '700', color: COLORS.textPrimary, marginBottom: 2 },
  notifMsg: { fontSize: 12, color: COLORS.textSecondary },
});
