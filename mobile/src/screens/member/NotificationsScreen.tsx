import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, RefreshControl, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../context/AuthContext';
import { COLORS } from '../../constants';

const NOTIF_ICONS: Record<string, { icon: string; color: string }> = {
  LOW_CREDIT:          { icon: 'warning-outline', color: COLORS.warning },
  TIME_ENDING:         { icon: 'time-outline', color: COLORS.warning },
  EXTENSION_AVAILABLE: { icon: 'add-circle-outline', color: COLORS.success },
  EXTENSION_BLOCKED:   { icon: 'close-circle-outline', color: COLORS.error },
  TOURNAMENT_INVITE:   { icon: 'trophy-outline', color: COLORS.gold },
  TOURNAMENT_MATCH:    { icon: 'game-controller-outline', color: COLORS.primary },
  LOYALTY_EARNED:      { icon: 'gift-outline', color: COLORS.success },
  BIRTHDAY_REWARD:     { icon: 'heart-outline', color: COLORS.rankElite },
  QUEUE_UPDATE:        { icon: 'time-outline', color: COLORS.info },
  EVENT_ANNOUNCEMENT:  { icon: 'megaphone-outline', color: COLORS.primary },
  SYSTEM:              { icon: 'information-circle-outline', color: COLORS.textMuted },
};

export default function NotificationsScreen() {
  const [notifications, setNotifications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchNotifs = useCallback(async () => {
    try {
      const res = await api.get('/api/notifications');
      setNotifications(res.data);
    } catch { }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { fetchNotifs(); }, []);

  const markRead = async (id: string) => {
    try {
      await api.patch(`/api/notifications/${id}/read`);
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
    } catch { }
  };

  const markAllRead = async () => {
    try {
      await api.patch('/api/notifications/read-all');
      setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
    } catch { }
  };

  const unreadCount = notifications.filter(n => !n.isRead).length;

  if (loading) return <View style={s.center}><ActivityIndicator size="large" color={COLORS.primary} /></View>;

  return (
    <View style={s.container}>
      <View style={s.header}>
        <Text style={s.title}>🔔 Notifications</Text>
        {unreadCount > 0 && (
          <TouchableOpacity onPress={markAllRead}>
            <Text style={s.markAll}>Mark all read</Text>
          </TouchableOpacity>
        )}
      </View>

      <ScrollView contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchNotifs(); }} tintColor={COLORS.primary} />}>
        {notifications.length === 0 ? (
          <View style={s.empty}>
            <Ionicons name="notifications-off-outline" size={48} color={COLORS.textMuted} />
            <Text style={s.emptyTxt}>No notifications yet</Text>
          </View>
        ) : notifications.map((n: any) => {
          const cfg = NOTIF_ICONS[n.type] || NOTIF_ICONS.SYSTEM;
          return (
            <TouchableOpacity key={n.id} style={[s.card, !n.isRead && s.cardUnread]} onPress={() => markRead(n.id)} activeOpacity={0.8}>
              <View style={[s.iconBox, { backgroundColor: cfg.color + '20' }]}>
                <Ionicons name={cfg.icon as any} size={20} color={cfg.color} />
              </View>
              <View style={s.cardInfo}>
                <Text style={[s.cardTitle, !n.isRead && s.cardTitleUnread]}>{n.title}</Text>
                <Text style={s.cardMsg}>{n.message}</Text>
                <Text style={s.cardTime}>{new Date(n.sentAt).toLocaleString('en-PH')}</Text>
              </View>
              {!n.isRead && <View style={s.unreadDot} />}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background },
  header: { paddingTop: 60, paddingHorizontal: 20, paddingBottom: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.surfaceBorder },
  title: { fontSize: 22, fontWeight: '800', color: COLORS.textPrimary },
  markAll: { fontSize: 13, color: COLORS.primary, fontWeight: '600' },
  content: { padding: 16, gap: 8 },
  card: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, backgroundColor: COLORS.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: COLORS.surfaceBorder },
  cardUnread: { borderColor: COLORS.primary + '50', backgroundColor: COLORS.primary + '08' },
  iconBox: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  cardInfo: { flex: 1, gap: 3 },
  cardTitle: { fontSize: 14, fontWeight: '600', color: COLORS.textSecondary },
  cardTitleUnread: { color: COLORS.textPrimary, fontWeight: '700' },
  cardMsg: { fontSize: 13, color: COLORS.textSecondary },
  cardTime: { fontSize: 11, color: COLORS.textMuted },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.primary, marginTop: 6 },
  empty: { padding: 60, alignItems: 'center', gap: 12 },
  emptyTxt: { color: COLORS.textMuted, fontSize: 15 },
});
