import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  RefreshControl, ActivityIndicator, Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth, api } from '../../context/AuthContext';
import { COLORS, RANK_CONFIG, MEMBERSHIP_PLANS } from '../../constants';

const BADGES: Record<string, { icon: string; label: string }> = {
  first_win:    { icon: '🏆', label: 'First Win' },
  ten_games:    { icon: '🎱', label: '10 Games' },
  fifty_games:  { icon: '⚡', label: '50 Games' },
  streak_5:     { icon: '🔥', label: '5 Win Streak' },
  loyal_20h:    { icon: '⏱️', label: '20 Hours' },
  tournament_w: { icon: '👑', label: 'Tournament Win' },
  birthday:     { icon: '🎂', label: 'Birthday' },
};

export default function ProfileScreen() {
  const { user, logout } = useAuth();
  const [data, setData] = useState<any>(null);
  const [loyalty, setLoyalty] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [logoutModal, setLogoutModal] = useState(false);
  const [tab, setTab] = useState<'stats' | 'loyalty' | 'history'>('stats');

  const fetchData = useCallback(async () => {
    try {
      const [profileRes, txRes] = await Promise.all([
        api.get('/api/auth/me'),
        api.get('/api/credits/history'),
      ]);
      setData(profileRes.data);
      setTransactions(txRes.data || []);
      // Loyalty from membership totalHoursPlayed
    } catch (err) { console.error(err); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { fetchData(); }, []);

  if (loading) return <View style={s.center}><ActivityIndicator size="large" color={COLORS.primary} /></View>;

  const profile = data?.gamifiedProfile;
  const membership = data?.membership;
  const rank = profile?.rank || 'Rookie';
  const rankCfg = RANK_CONFIG[rank as keyof typeof RANK_CONFIG] || RANK_CONFIG.Rookie;
  const plan = membership?.plan || 'BASIC';
  const planCfg = MEMBERSHIP_PLANS[plan as keyof typeof MEMBERSHIP_PLANS];
  const winRate = profile?.totalGames > 0 ? Math.round((profile.totalWins / profile.totalGames) * 100) : 0;
  const xpToNext = (profile?.level || 1) * 100;
  const xpPct = ((profile?.xp || 0) % 100) / 100;
  const hoursPlayed = (membership?.totalHoursPlayed || 0).toFixed(1);
  const hoursProgress = ((membership?.totalHoursPlayed || 0) % 20) / 20;
  const hoursToNext = (20 - ((membership?.totalHoursPlayed || 0) % 20)).toFixed(1);

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchData(); }} tintColor={COLORS.primary} />}>

      {/* Hero */}
      <View style={[s.heroCard, { borderColor: rankCfg.color + '60' }]}>
        <View style={s.heroTop}>
          <View style={[s.avatar, { backgroundColor: rankCfg.color + '20', borderColor: rankCfg.color }]}>
            <Text style={s.avatarEmoji}>{rankCfg.icon}</Text>
          </View>
          <View style={s.heroInfo}>
            <Text style={s.displayName}>{profile?.displayName || user?.firstName}</Text>
            <Text style={s.realName}>{user?.firstName} {user?.lastName}</Text>
            <Text style={s.email}>{user?.email}</Text>
            <View style={s.badges}>
              <View style={[s.badge, { backgroundColor: rankCfg.color + '25' }]}>
                <Text style={[s.badgeText, { color: rankCfg.color }]}>{rankCfg.icon} {rank}</Text>
              </View>
              <View style={[s.badge, { backgroundColor: (planCfg?.color || COLORS.primary) + '25' }]}>
                <Text style={[s.badgeText, { color: planCfg?.color || COLORS.primary }]}>{planCfg?.icon} {planCfg?.label}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* XP Bar */}
        <View style={s.xpSection}>
          <View style={s.xpRow}>
            <Text style={s.xpLevel}>Level {profile?.level || 1}</Text>
            <Text style={s.xpCount}>{profile?.xp || 0} / {xpToNext} XP</Text>
          </View>
          <View style={s.xpBar}><View style={[s.xpFill, { width: `${xpPct * 100}%`, backgroundColor: rankCfg.color }]} /></View>
        </View>

        {/* Credits row */}
        <View style={s.creditsRow}>
          {[
            { icon: 'wallet', color: COLORS.primary, val: (membership?.creditBalance || 0).toFixed(0), lbl: 'Credits' },
            { icon: 'time', color: COLORS.info, val: `${hoursPlayed}h`, lbl: 'Played' },
            { icon: 'trophy', color: COLORS.gold, val: `${hoursToNext}h`, lbl: 'To Free Hour' },
          ].map((item, i) => (
            <React.Fragment key={i}>
              {i > 0 && <View style={s.divider} />}
              <View style={s.creditCell}>
                <Ionicons name={item.icon as any} size={16} color={item.color} />
                <Text style={s.creditVal}>{item.val}</Text>
                <Text style={s.creditLbl}>{item.lbl}</Text>
              </View>
            </React.Fragment>
          ))}
        </View>
      </View>

      {/* Tabs */}
      <View style={s.tabs}>
        {(['stats', 'loyalty', 'history'] as const).map(t => (
          <TouchableOpacity key={t} style={[s.tab, tab === t && s.tabActive]} onPress={() => setTab(t)}>
            <Text style={[s.tabTxt, tab === t && s.tabTxtActive]}>
              {t === 'stats' ? '📊 Stats' : t === 'loyalty' ? '🎁 Loyalty' : '📋 History'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* STATS */}
      {tab === 'stats' && (
        <View style={s.section}>
          <View style={s.statsGrid}>
            {[
              { label: 'Wins', value: profile?.totalWins || 0, color: COLORS.success, icon: 'trophy-outline' },
              { label: 'Losses', value: profile?.totalLosses || 0, color: COLORS.error, icon: 'close-circle-outline' },
              { label: 'Games', value: profile?.totalGames || 0, color: COLORS.info, icon: 'game-controller-outline' },
              { label: 'Streak', value: profile?.winStreak || 0, color: COLORS.rankElite, icon: 'flame-outline' },
              { label: 'Best', value: profile?.bestStreak || 0, color: COLORS.gold, icon: 'star-outline' },
              { label: 'Win %', value: `${winRate}%`, color: COLORS.primary, icon: 'analytics-outline' },
            ].map(stat => (
              <View key={stat.label} style={[s.statCard, { borderColor: stat.color + '35' }]}>
                <Ionicons name={stat.icon as any} size={20} color={stat.color} />
                <Text style={[s.statVal, { color: stat.color }]}>{stat.value}</Text>
                <Text style={s.statLbl}>{stat.label}</Text>
              </View>
            ))}
          </View>

          <Text style={s.sectionTitle}>Badges ({profile?.badges?.length || 0})</Text>
          {(profile?.badges?.length || 0) > 0 ? (
            <View style={s.badgeGrid}>
              {profile.badges.map((b: string) => (
                <View key={b} style={s.badgeCard}>
                  <Text style={s.badgeCardIcon}>{BADGES[b]?.icon || '🎖️'}</Text>
                  <Text style={s.badgeCardLbl}>{BADGES[b]?.label || b}</Text>
                </View>
              ))}
            </View>
          ) : (
            <View style={s.empty}><Text style={s.emptyTxt}>Play more games to earn badges!</Text></View>
          )}

          <Text style={s.sectionTitle}>Rank Progression</Text>
          <View style={s.rankRow}>
            {Object.entries(RANK_CONFIG).map(([r, cfg]) => (
              <View key={r} style={[s.rankStep, r === rank && { borderColor: cfg.color, backgroundColor: cfg.color + '15' }]}>
                <Text style={s.rankStepIcon}>{cfg.icon}</Text>
                <Text style={[s.rankStepName, { color: r === rank ? cfg.color : COLORS.textMuted }]}>{r}</Text>
                <Text style={s.rankStepReq}>{cfg.minWins}+</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* LOYALTY */}
      {tab === 'loyalty' && (
        <View style={s.section}>
          <View style={s.milestoneCard}>
            <Text style={s.milestoneTitle}>Next Milestone — {Math.ceil((membership?.totalHoursPlayed || 0) / 20) * 20} hours</Text>
            <View style={s.milestoneBar}><View style={[s.milestoneBarFill, { width: `${Math.min(100, hoursProgress * 100)}%` }]} /></View>
            <Text style={s.milestoneHint}>🎁 Play {hoursToNext} more hours → 1 FREE hour (60 credits)</Text>
          </View>

          <Text style={s.sectionTitle}>Ways to Earn</Text>
          {[
            { icon: '⏱️', t: 'Play 20 Hours', d: 'Earn 60 free credits (1 hour)' },
            { icon: '🎂', t: 'Birthday Bonus', d: 'Free 1 hour on your birthday' },
            { icon: '🏆', t: 'Tournament Win', d: 'Bonus XP and credits' },
            { icon: '🔥', t: 'Win Streak Bonus', d: 'Consecutive wins unlock rewards' },
          ].map(item => (
            <View key={item.t} style={s.ruleCard}>
              <Text style={s.ruleIcon}>{item.icon}</Text>
              <View><Text style={s.ruleTitle}>{item.t}</Text><Text style={s.ruleDesc}>{item.d}</Text></View>
            </View>
          ))}
        </View>
      )}

      {/* HISTORY */}
      {tab === 'history' && (
        <View style={s.section}>
          {transactions.length === 0 ? (
            <View style={s.empty}><Text style={s.emptyTxt}>No transactions yet</Text></View>
          ) : transactions.map((tx: any) => {
            const isCredit = ['TOPUP', 'LOYALTY_REWARD'].includes(tx.type);
            return (
              <View key={tx.id} style={s.txRow}>
                <View style={[s.txIcon, { backgroundColor: (isCredit ? COLORS.success : COLORS.error) + '20' }]}>
                  <Ionicons name={isCredit ? 'add' : 'remove'} size={16} color={isCredit ? COLORS.success : COLORS.error} />
                </View>
                <View style={s.txInfo}>
                  <Text style={s.txDesc}>{tx.description}</Text>
                  <Text style={s.txDate}>{new Date(tx.createdAt).toLocaleString('en-PH')}</Text>
                </View>
                <Text style={[s.txAmt, { color: isCredit ? COLORS.success : COLORS.error }]}>
                  {isCredit ? '+' : '-'}{tx.amount.toFixed(0)} cr
                </Text>
              </View>
            );
          })}
        </View>
      )}

      <TouchableOpacity style={s.logoutBtn} onPress={() => setLogoutModal(true)}>
        <Ionicons name="log-out-outline" size={18} color={COLORS.error} />
        <Text style={s.logoutTxt}>Sign Out</Text>
      </TouchableOpacity>

      <Modal visible={logoutModal} transparent animationType="fade">
        <View style={s.overlay}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>Sign Out?</Text>
            <Text style={s.modalMsg}>You'll need to sign in again to access your account.</Text>
            <View style={s.modalBtns}>
              <TouchableOpacity style={s.cancelBtn} onPress={() => setLogoutModal(false)}>
                <Text style={s.cancelTxt}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.confirmBtn} onPress={logout}>
                <Text style={s.confirmTxt}>Sign Out</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: 20, paddingTop: 60, paddingBottom: 40, gap: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background },
  heroCard: { backgroundColor: COLORS.surface, borderRadius: 20, padding: 18, borderWidth: 1, gap: 14 },
  heroTop: { flexDirection: 'row', gap: 14 },
  avatar: { width: 70, height: 70, borderRadius: 35, justifyContent: 'center', alignItems: 'center', borderWidth: 2 },
  avatarEmoji: { fontSize: 30 },
  heroInfo: { flex: 1, gap: 3 },
  displayName: { fontSize: 18, fontWeight: '800', color: COLORS.textPrimary },
  realName: { fontSize: 13, color: COLORS.textSecondary },
  email: { fontSize: 11, color: COLORS.textMuted },
  badges: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 4 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  xpSection: { gap: 6 },
  xpRow: { flexDirection: 'row', justifyContent: 'space-between' },
  xpLevel: { fontSize: 13, fontWeight: '700', color: COLORS.textPrimary },
  xpCount: { fontSize: 12, color: COLORS.textSecondary },
  xpBar: { height: 8, backgroundColor: COLORS.surfaceLight, borderRadius: 4, overflow: 'hidden' },
  xpFill: { height: '100%', borderRadius: 4 },
  creditsRow: { flexDirection: 'row', backgroundColor: COLORS.surfaceLight, borderRadius: 12, padding: 14 },
  divider: { width: 1, backgroundColor: COLORS.surfaceBorder },
  creditCell: { flex: 1, alignItems: 'center', gap: 3 },
  creditVal: { fontSize: 17, fontWeight: '800', color: COLORS.textPrimary },
  creditLbl: { fontSize: 10, color: COLORS.textMuted },
  tabs: { flexDirection: 'row', backgroundColor: COLORS.surface, borderRadius: 12, padding: 4 },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 8 },
  tabActive: { backgroundColor: COLORS.primary },
  tabTxt: { fontSize: 12, fontWeight: '600', color: COLORS.textMuted },
  tabTxtActive: { color: '#000' },
  section: { gap: 10 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statCard: { flex: 1, minWidth: '30%', backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, alignItems: 'center', gap: 6, borderWidth: 1 },
  statVal: { fontSize: 22, fontWeight: '800' },
  statLbl: { fontSize: 10, color: COLORS.textMuted },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: COLORS.textPrimary, marginTop: 4 },
  badgeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  badgeCard: { width: '22%', backgroundColor: COLORS.surface, borderRadius: 10, padding: 10, alignItems: 'center', gap: 4, borderWidth: 1, borderColor: COLORS.gold + '40' },
  badgeCardIcon: { fontSize: 22 },
  badgeCardLbl: { fontSize: 9, color: COLORS.textMuted, textAlign: 'center' },
  rankRow: { flexDirection: 'row', gap: 6 },
  rankStep: { flex: 1, backgroundColor: COLORS.surface, borderRadius: 10, padding: 8, alignItems: 'center', gap: 2, borderWidth: 1, borderColor: COLORS.surfaceBorder },
  rankStepIcon: { fontSize: 16 },
  rankStepName: { fontSize: 8, fontWeight: '700' },
  rankStepReq: { fontSize: 8, color: COLORS.textMuted },
  milestoneCard: { backgroundColor: COLORS.surface, borderRadius: 16, padding: 18, gap: 10, borderWidth: 1, borderColor: COLORS.primary + '40' },
  milestoneTitle: { fontSize: 14, fontWeight: '700', color: COLORS.textSecondary },
  milestoneBar: { height: 10, backgroundColor: COLORS.surfaceLight, borderRadius: 5, overflow: 'hidden' },
  milestoneBarFill: { height: '100%', backgroundColor: COLORS.primary, borderRadius: 5 },
  milestoneHint: { fontSize: 13, color: COLORS.textMuted },
  ruleCard: { flexDirection: 'row', gap: 12, backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: COLORS.surfaceBorder },
  ruleIcon: { fontSize: 24 },
  ruleTitle: { fontSize: 14, fontWeight: '700', color: COLORS.textPrimary },
  ruleDesc: { fontSize: 12, color: COLORS.textSecondary },
  txRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: COLORS.surfaceBorder },
  txIcon: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },
  txInfo: { flex: 1 },
  txDesc: { fontSize: 13, color: COLORS.textPrimary },
  txDate: { fontSize: 11, color: COLORS.textMuted },
  txAmt: { fontSize: 14, fontWeight: '800' },
  empty: { backgroundColor: COLORS.surface, borderRadius: 12, padding: 24, alignItems: 'center' },
  emptyTxt: { color: COLORS.textMuted },
  logoutBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 8, padding: 16, borderRadius: 12, borderWidth: 1, borderColor: COLORS.error + '40' },
  logoutTxt: { color: COLORS.error, fontWeight: '700' },
  overlay: { flex: 1, backgroundColor: '#000000AA', justifyContent: 'center', alignItems: 'center', padding: 32 },
  modalCard: { backgroundColor: COLORS.surface, borderRadius: 20, padding: 24, gap: 12, width: '100%' },
  modalTitle: { fontSize: 18, fontWeight: '800', color: COLORS.textPrimary },
  modalMsg: { fontSize: 14, color: COLORS.textSecondary },
  modalBtns: { flexDirection: 'row', gap: 10, marginTop: 8 },
  cancelBtn: { flex: 1, backgroundColor: COLORS.surfaceLight, borderRadius: 12, padding: 14, alignItems: 'center' },
  cancelTxt: { color: COLORS.textPrimary, fontWeight: '700' },
  confirmBtn: { flex: 1, backgroundColor: COLORS.error, borderRadius: 12, padding: 14, alignItems: 'center' },
  confirmTxt: { color: '#fff', fontWeight: '700' },
});
